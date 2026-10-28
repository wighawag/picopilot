import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {Cart, CartParseError} from '../engine/cart/index.js';
import {labelHexFromPng, LabelError} from '../engine/gfx/index.js';
import {
	buildDriveHarness,
	DriveError,
	type DriveOptions,
	type Pico8DriveResult,
} from '../engine/pico8/index.js';
import {makeReadInclude} from './cart-includes.js';

/**
 * The remedy for both label-image errors (`label-wrong-size`,
 * `label-unsupported-png`): the screenshot `run`/`playtest` already wrote is a
 * valid label as-is, so point at that rather than at an external image tool.
 */
export const LABEL_FIX_CTA = {
	description:
		'Pass a picopilot screenshot directly; it is scaled for you (any 128*k square: 128x128, 256x256, 384x384, ...). No image tool needed:',
	commands: [
		{
			command: 'run <cart> --shot-dir shots',
			description:
				'Capture a frame (the cart calls extcmd("screen")), then pass shots/<name>.png to --label unchanged.',
		},
		{
			command: 'export <cart> <dest> --label shots/<name>.png',
			description:
				'Bake that screenshot in as the label splash (`serve --label` takes it the same way). playtest screenshots work too.',
		},
	],
};

/** Where the exported cart's `__label__` came from. */
export type LabelSource = 'cart' | 'image' | 'frame' | 'none';

/** A cart ready to hand to PICO-8's export, plus how to tidy up after it. */
export interface LabeledCart {
	readonly ok: true;
	/** The cart to export: the original, or a labeled throwaway copy. */
	readonly cartPath: string;
	/**
	 * Where the label comes from: the cart's own (`cart`), `--label` (`image`),
	 * `--label-frame` (`frame`), or nowhere (`none`, the cart stays labelless).
	 */
	readonly labelSource: LabelSource;
	/** Removes the throwaway copy (if one was made). Best-effort, idempotent. */
	readonly cleanup: () => void;
}

/** A label-preparation failure, shaped for incur's `error({...})`. */
export interface LabelCartFailure {
	readonly ok: false;
	readonly code: string;
	readonly message: string;
	readonly cta?: {
		description: string;
		commands: {command: string; description: string}[];
	};
}

/** The label flags `export` and `serve` share. */
export interface LabelOptions {
	/** `--label <png>`: an image (a run/playtest screenshot as-is, or 128x128). */
	readonly label?: string;
	/** `--label-frame <n>`: capture frame `n` of the running cart, no input. */
	readonly labelFrame?: number;
	/** The backstop for the `--label-frame` capture run. */
	readonly backstopMs: number;
}

/** The base filename the `--label-frame` capture names its screenshot. */
const LABEL_FRAME_BASENAME = 'label';

/**
 * The `--label` / `--label-frame` step shared by `export` and `serve` (ADR-0013,
 * ADR-0015, ADR-0016): give a labelless cart a `__label__` (the export splash)
 * without an interactive F7 capture.
 *
 *  - `--label <png>`: decode an image (a `run`/`playtest` screenshot as-is, any
 *    square integer multiple of 128x128, or any 128x128 PNG).
 *  - `--label-frame <n>`: RUN the cart headlessly through the playtest drive
 *    harness (ADR-0011) with NO input, advance `n` frames, screenshot that frame,
 *    and decode it. Needs PICO-8 (`drive`); an arbitrary cart does not have to
 *    cooperate, since the harness owns its frame loop.
 *
 * The two flags are mutually exclusive (`label-flags-conflict`). The user's cart
 * is NEVER mutated: a labeled copy is written NEXT TO it (same dir, so
 * `#include main.lua` still resolves) and the caller exports that, then calls
 * `cleanup()`. A cart that ALREADY has a label wins (the flags are a fallback,
 * not an override): it is returned untouched and nothing is run.
 *
 * @param drive the adapter's `drive`, only called for `--label-frame`.
 */
export async function prepareLabeledCart(
	cartPath: string,
	options: LabelOptions,
	drive: (options: DriveOptions) => Promise<Pico8DriveResult>,
): Promise<LabeledCart | LabelCartFailure> {
	const keep = (labelSource: LabelSource): LabeledCart => ({
		ok: true,
		cartPath,
		labelSource,
		cleanup: () => {},
	});

	if (options.label !== undefined && options.labelFrame !== undefined) {
		return {
			ok: false,
			code: 'label-flags-conflict',
			message:
				'pass either --label <png> (an image) or --label-frame <n> (capture a frame of the running cart), not both',
		};
	}

	// With no label flag the cart is only read to REPORT `labelSource`; anything
	// odd about it (unreadable, unparseable) is left for PICO-8 to judge, exactly
	// as before the label flags existed.
	const noFlag =
		options.label === undefined && options.labelFrame === undefined;
	let cart: Cart;
	try {
		cart = Cart.parse(readFileSync(cartPath, 'utf8'));
	} catch (e) {
		if (noFlag) return keep('none');
		if (e instanceof CartParseError) {
			return {
				ok: false,
				code: `cart-${e.code}`,
				message: `could not parse the cart to inject a label: ${e.message}`,
			};
		}
		throw e;
	}

	const existingLabel = cart.getSection('label');
	if (existingLabel !== undefined && existingLabel.trim() !== '') {
		return keep('cart');
	}

	let png: Uint8Array;
	let labelSource: LabelSource;
	if (options.label !== undefined) {
		const labelPath = isAbsolute(options.label)
			? options.label
			: resolve(process.cwd(), options.label);
		if (!existsSync(labelPath)) {
			return {
				ok: false,
				code: 'label-not-found',
				message: `no label image at ${labelPath}`,
			};
		}
		png = readFileSync(labelPath);
		labelSource = 'image';
	} else if (options.labelFrame !== undefined) {
		const captured = await captureFrame(
			cartPath,
			options.labelFrame,
			options.backstopMs,
			drive,
		);
		if (!captured.ok) return captured;
		png = captured.png;
		labelSource = 'frame';
	} else {
		return keep('none');
	}

	let hex: string;
	try {
		hex = labelHexFromPng(png);
	} catch (e) {
		if (e instanceof LabelError) {
			return {
				ok: false,
				code: `label-${e.code}`,
				message: e.message,
				cta: LABEL_FIX_CTA,
			};
		}
		throw e;
	}

	cart.setSection('label', hex);
	const copy = join(
		dirname(cartPath),
		`.picopilot-export-${process.pid}-${Date.now()}.p8`,
	);
	writeFileSync(copy, cart.serialize());
	return {
		ok: true,
		cartPath: copy,
		labelSource,
		cleanup: () => {
			try {
				rmSync(copy, {force: true});
			} catch {
				// A leftover dotfile is not fatal.
			}
		},
	};
}

/**
 * Runs the cart through the playtest drive harness with NO input for `frame + 1`
 * frames, screenshotting after frame `frame` (0 = the first drawn frame), and
 * returns that PNG. The driven cart and PICO-8's screenshot dir live in a temp
 * dir that is removed before returning.
 */
async function captureFrame(
	cartPath: string,
	frame: number,
	backstopMs: number,
	drive: (options: DriveOptions) => Promise<Pico8DriveResult>,
): Promise<{ok: true; png: Uint8Array} | LabelCartFailure> {
	let harness;
	try {
		harness = buildDriveHarness(readFileSync(cartPath, 'utf8'), {
			presses: [],
			frames: frame + 1,
			shotFrames: [frame],
			shotBasename: LABEL_FRAME_BASENAME,
			readInclude: makeReadInclude(cartPath),
		});
	} catch (e) {
		if (e instanceof DriveError) {
			return {ok: false, code: e.code, message: e.message};
		}
		throw e;
	}

	const shotDir = mkdtempSync(join(tmpdir(), 'picopilot-label-frame-'));
	try {
		const drivenCart = join(shotDir, 'driven.p8');
		writeFileSync(drivenCart, harness.cartText);
		const result = await drive({
			cartPath: drivenCart,
			shotDir,
			blocks: harness.blocks,
			backstopMs,
		});
		if (!result.ok) {
			return {
				ok: false,
				code: result.reason,
				message: `PICO-8 is not installed, so --label-frame cannot capture a frame. ${result.remedy} (needs: ${result.needs.join(', ')})`,
			};
		}
		const shot = result.value.screenshots[0];
		if (shot === undefined) {
			const {exitReason} = result.value;
			const tail = result.value.printh.trim().split('\n').slice(-5).join('\n');
			const commands = [
				{
					command: 'verify',
					description: 'Run the static gate (tokens + lint + integrity).',
				},
				{
					command: 'playtest start <cart>',
					description:
						'Reproduce the SAME no-input frame to look at it: start a paused session (nothing held), then step and shoot.',
				},
				{
					command: `playtest step <id> --frames ${frame + 1}`,
					description: `Advance to frame ${frame}, as --label-frame ${frame} does.`,
				},
				{
					command: 'playtest shot <id>',
					description:
						'Screenshot it; if it looks right, pass that PNG with --label <png> (then `playtest stop <id>`).',
				},
			];
			if (exitReason === 'timeout') {
				commands.push({
					command: `export <cart> --label-frame ${frame} --backstop-ms <more>`,
					description:
						'The capture hit the backstop (it runs about one frame per PICO-8 tick): allow more time, or pick an earlier frame.',
				});
			}
			return {
				ok: false,
				code: 'label-frame-not-captured',
				message: `the cart produced no frame ${frame} screenshot (exit: ${exitReason}).${tail === '' ? '' : ` Last output:\n${tail}`}`,
				cta: {
					description:
						'The cart did not reach that frame. Check it boots, or look at the frame first:',
					commands,
				},
			};
		}
		return {ok: true, png: readFileSync(shot)};
	} finally {
		rmSync(shotDir, {recursive: true, force: true});
	}
}
