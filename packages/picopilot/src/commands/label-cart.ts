import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {Cart, CartParseError} from '../engine/cart/index.js';
import {labelHexFromPng, LabelError} from '../engine/gfx/index.js';

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

/** A cart ready to hand to PICO-8's export, plus how to tidy up after it. */
export interface LabeledCart {
	readonly ok: true;
	/** The cart to export: the original, or a labeled throwaway copy. */
	readonly cartPath: string;
	/** Removes the throwaway copy (if one was made). Best-effort, idempotent. */
	readonly cleanup: () => void;
}

/** A label-preparation failure, shaped for incur's `error({...})`. */
export interface LabelCartFailure {
	readonly ok: false;
	readonly code: string;
	readonly message: string;
	readonly cta?: typeof LABEL_FIX_CTA;
}

/**
 * The `--label <png>` step shared by `export` and `serve` (ADR-0013, ADR-0015):
 * bake a PNG in as the cart's `__label__` so a labelless cart gets a splash
 * without an interactive F7 capture. The PNG may be a `run`/`playtest`
 * screenshot as-is (any square integer multiple of 128x128) or any 128x128
 * image.
 *
 * The user's cart is NEVER mutated: a labeled copy is written NEXT TO it (same
 * dir, so `#include main.lua` still resolves) and the caller exports that, then
 * calls `cleanup()`. A cart that ALREADY has a label wins (the flag is a
 * fallback, not an override): the original path is returned untouched. With no
 * `label` the original cart is returned as-is.
 */
export function prepareLabeledCart(
	cartPath: string,
	label: string | undefined,
): LabeledCart | LabelCartFailure {
	const untouched: LabeledCart = {ok: true, cartPath, cleanup: () => {}};
	if (label === undefined) return untouched;

	const labelPath = isAbsolute(label) ? label : resolve(process.cwd(), label);
	if (!existsSync(labelPath)) {
		return {
			ok: false,
			code: 'label-not-found',
			message: `no label image at ${labelPath}`,
		};
	}
	try {
		const cart = Cart.parse(readFileSync(cartPath, 'utf8'));
		const existingLabel = cart.getSection('label');
		if (existingLabel !== undefined && existingLabel.trim() !== '') {
			return untouched;
		}
		const hex = labelHexFromPng(readFileSync(labelPath));
		cart.setSection('label', hex);
		const copy = join(
			dirname(cartPath),
			`.picopilot-export-${process.pid}-${Date.now()}.p8`,
		);
		writeFileSync(copy, cart.serialize());
		return {
			ok: true,
			cartPath: copy,
			cleanup: () => {
				try {
					rmSync(copy, {force: true});
				} catch {
					// A leftover dotfile is not fatal.
				}
			},
		};
	} catch (e) {
		if (e instanceof LabelError) {
			return {
				ok: false,
				code: `label-${e.code}`,
				message: e.message,
				cta: LABEL_FIX_CTA,
			};
		}
		if (e instanceof CartParseError) {
			return {
				ok: false,
				code: `cart-${e.code}`,
				message: `could not parse the cart to inject a label: ${e.message}`,
			};
		}
		throw e;
	}
}
