/**
 * The `audio render` harness builder (ADR-0009 Part 3): the PURE, CI-testable
 * core that turns a user's cart + a chosen render TARGET into a THROWAWAY cart
 * whose `_update` plays the target, records it via `audio_rec`/`audio_end(1)`,
 * and prints the done-sentinel. This is the audio analogue of the `run`
 * screenshot harness (the `picopilot-debug` recipe): the author writes NO
 * playback code and still gets "render sfx 5 -> a WAV".
 *
 * Kept pure (cart-text in, cart-text + a record window out) so the harness
 * construction + the record-duration heuristic are unit-testable WITHOUT the
 * paid PICO-8 binary; only the actual capture needs a live A/V session (the
 * manual/opt-in tier, ADR-0009).
 */

import {Cart} from '../cart/index.js';
import {
	DONE_SENTINEL,
	PICO8_FRAMES_PER_SECOND,
	PICO8_TICKS_PER_SECOND,
	RECORD_WAV_BASENAME,
} from './adapter.js';
import {SFX_ROW_LENGTH} from '../audio/sfx.js';

/**
 * A render target: a single SFX slot, a single music PATTERN, or the whole song
 * (pattern 0 onward). This mirrors the audio authoring vocabulary (`sfx from-mml`
 * writes a slot; `music from-patterns` writes an ordered pattern list), so an
 * author renders exactly what they composed.
 */
export type RenderTarget =
	| {readonly kind: 'sfx'; readonly index: number}
	| {readonly kind: 'pattern'; readonly index: number}
	| {readonly kind: 'song'};

/** The lowest/highest SFX slot a render target may name (finding: 64 slots). */
export const SFX_TARGET_MIN = 0;
export const SFX_TARGET_MAX = 63;

/** The lowest/highest music PATTERN a render target may name (finding: 64 patterns). */
export const PATTERN_TARGET_MIN = 0;
export const PATTERN_TARGET_MAX = 63;

/**
 * The default record window (seconds) for a target whose exact play length
 * cannot be derived cheaply (a music pattern / whole song: PICO-8 does not store
 * a per-pattern length, and following loops/flags statically is out of scope for
 * a render harness). A generous window that captures a typical loop; the author
 * overrides it with an explicit duration (ADR-0009: render is a real-time
 * recording, so a fixed window is honest, not a promise of exact length).
 */
export const DEFAULT_RECORD_SECONDS = 8;

/** A small tail margin (seconds) appended so the target's final note is not clipped. */
export const RECORD_TAIL_SECONDS = 0.5;

/**
 * A structured reason a render harness could not be built. Surfaced by the
 * command as incur's `error({code,...})` envelope; never a silent guess.
 */
export type HarnessErrorCode =
	/** The target named an SFX/pattern outside the valid 0..63 range. */
	| 'audio-render-target-out-of-range'
	/** The target SFX slot is empty (all-zero) in the cart: nothing to render. */
	| 'audio-render-target-empty'
	/** The cart could not be parsed (not a valid .p8). */
	| 'audio-render-cart-parse-error';

/** A structured harness-build failure (a target refusal, not a crash). */
export class HarnessError extends Error {
	readonly code: HarnessErrorCode;
	constructor(code: HarnessErrorCode, message: string) {
		super(message);
		this.name = 'HarnessError';
		this.code = code;
	}
}

/** An all-zero `__sfx__` row: the canonical "empty slot" (mirrors section.ts). */
const EMPTY_SFX_ROW = '0'.repeat(SFX_ROW_LENGTH);

/**
 * The decoded timing of one authored `__sfx__` row: its `speed` (ticks/row) and
 * the number of NON-EMPTY leading rows (its play length in rows). Both come from
 * the friendly text row (finding Part A): header bytes 2..3 = speed, then 32
 * five-nibble notes; a note is silent when its volume nibble is 0.
 */
interface SfxTiming {
	readonly speed: number;
	readonly rows: number;
}

/** Reads slot `index`'s row from a `__sfx__` body, or undefined if absent/empty. */
function sfxRow(
	sfxBody: string | undefined,
	index: number,
): string | undefined {
	if (sfxBody === undefined) return undefined;
	const rows = sfxBody.split(/\r?\n/).filter((l) => l.length > 0);
	const row = rows[index];
	if (
		row === undefined ||
		row.length !== SFX_ROW_LENGTH ||
		row === EMPTY_SFX_ROW
	) {
		return undefined;
	}
	return row;
}

/**
 * Decodes a `__sfx__` text row into its {@link SfxTiming}. `speed` is header
 * byte [2:4]; `rows` is the count of tracker rows up to and including the last
 * one with a non-zero volume nibble (a trailing silent tail does not extend the
 * audible length). Returns `rows = 0` for an all-silent row.
 */
export function decodeSfxTiming(row: string): SfxTiming {
	const speed = Number.parseInt(row.slice(2, 4), 16) || 1;
	let lastAudible = 0;
	for (let r = 0; r < 32; r++) {
		const noteStart = 8 + r * 5;
		// Note layout: PP (pitch, 2) W (waveform, 1) V (volume, 1) E (effect, 1).
		const vol = Number.parseInt(row.charAt(noteStart + 3), 16);
		if (!Number.isNaN(vol) && vol > 0) lastAudible = r + 1;
	}
	return {speed, rows: lastAudible};
}

/**
 * The record window (seconds) for a render target, given the cart. For an SFX
 * target the window is derived from that slot's speed + audible row count
 * (`rows * speed` ticks / {@link PICO8_TICKS_PER_SECOND}) plus a tail margin, so
 * the recording covers exactly the target's play length without guessing. For a
 * pattern / whole-song target the length is not cheaply derivable, so the
 * {@link DEFAULT_RECORD_SECONDS} window is used (overridable by the caller).
 *
 * An explicit `override` (the command's `--seconds`) always wins.
 */
export function recordSeconds(
	cart: Cart,
	target: RenderTarget,
	override?: number,
): number {
	if (override !== undefined) return override;
	if (target.kind === 'sfx') {
		const row = sfxRow(cart.getSection('sfx'), target.index);
		if (row !== undefined) {
			const {speed, rows} = decodeSfxTiming(row);
			const ticks = rows * speed;
			const seconds = ticks / PICO8_TICKS_PER_SECOND + RECORD_TAIL_SECONDS;
			// A degenerate (0-row) slot still records a short window rather than 0s.
			return Math.max(seconds, RECORD_TAIL_SECONDS + 0.5);
		}
	}
	return DEFAULT_RECORD_SECONDS;
}

/** The Lua expression that PLAYS the target once, at harness start. */
function playCall(target: RenderTarget): string {
	switch (target.kind) {
		case 'sfx':
			return `sfx(${target.index})`;
		case 'pattern':
			return `music(${target.index})`;
		case 'song':
			return 'music(0)';
	}
}

/** A one-line human description of the target (for the render result + help). */
export function describeTarget(target: RenderTarget): string {
	switch (target.kind) {
		case 'sfx':
			return `sfx ${target.index}`;
		case 'pattern':
			return `music pattern ${target.index}`;
		case 'song':
			return 'the whole song (music 0)';
	}
}

/** The result of building a render harness: the throwaway cart + its record window. */
export interface RenderHarness {
	/** The throwaway `.p8` cart text (same `__sfx__`/`__music__`, injected `__lua__`). */
	readonly cartText: string;
	/** The record window in seconds the adapter should let the capture run for. */
	readonly seconds: number;
	/** The number of `_update` frames the harness records for (= seconds * 30fps). */
	readonly frames: number;
	/** The base filename the harness passes to `extcmd("set_filename")`. */
	readonly wavBasename: string;
	/** A human description of what is being rendered (for the result envelope). */
	readonly description: string;
}

/**
 * Validates a render target against the cart's authored content, refusing an
 * out-of-range index or an empty SFX slot (nothing to render) with a structured
 * {@link HarnessError} rather than recording silence.
 */
function validateTarget(cart: Cart, target: RenderTarget): void {
	if (target.kind === 'sfx') {
		if (target.index < SFX_TARGET_MIN || target.index > SFX_TARGET_MAX) {
			throw new HarnessError(
				'audio-render-target-out-of-range',
				`SFX target ${target.index} is out of range ${SFX_TARGET_MIN}..${SFX_TARGET_MAX}.`,
			);
		}
		if (sfxRow(cart.getSection('sfx'), target.index) === undefined) {
			throw new HarnessError(
				'audio-render-target-empty',
				`SFX slot ${target.index} is empty in this cart, there is nothing to render. Author it first with \`sfx from-mml ${target.index} "<mml>"\`.`,
			);
		}
	} else if (target.kind === 'pattern') {
		if (
			target.index < PATTERN_TARGET_MIN ||
			target.index > PATTERN_TARGET_MAX
		) {
			throw new HarnessError(
				'audio-render-target-out-of-range',
				`music pattern target ${target.index} is out of range ${PATTERN_TARGET_MIN}..${PATTERN_TARGET_MAX}.`,
			);
		}
	}
}

/**
 * Builds the throwaway render harness (ADR-0009 Part 3). Takes the user's cart
 * text + a render TARGET (+ an optional record-window override) and produces a
 * new cart with the SAME authored `__sfx__`/`__music__` but a REPLACED `__lua__`
 * whose `_update`:
 *  - at frame 1: `extcmd("set_filename", <base>)`, `extcmd("audio_rec")`, plays
 *    the target (`sfx(N)` / `music(P)` / `music(0)`);
 *  - at frame `frames`: `extcmd("audio_end", 1)` (save to the current folder,
 *    which the adapter points at an isolated temp dir);
 *  - at frame `frames + 1`: `printh` the done-sentinel so the launcher kills
 *    PICO-8 promptly (a cart cannot self-quit, ADR-0006).
 *
 * @throws {HarnessError} an out-of-range/empty target or an unparseable cart.
 */
export function buildRenderHarness(
	cartText: string,
	target: RenderTarget,
	options: {seconds?: number; sentinel?: string; wavBasename?: string} = {},
): RenderHarness {
	let cart: Cart;
	try {
		cart = Cart.parse(cartText);
	} catch (e) {
		throw new HarnessError(
			'audio-render-cart-parse-error',
			`cart does not parse: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	validateTarget(cart, target);

	const seconds = recordSeconds(cart, target, options.seconds);
	const frames = Math.max(1, Math.round(seconds * PICO8_FRAMES_PER_SECOND));
	const sentinel = options.sentinel ?? DONE_SENTINEL;
	const wavBasename = options.wavBasename ?? RECORD_WAV_BASENAME;
	const play = playCall(target);

	// Replace __lua__ with the record harness; keep every OTHER section (crucially
	// __sfx__/__music__) byte-identical so the target plays exactly as authored.
	const lua = [
		'-- picopilot audio render harness (throwaway; ADR-0009).',
		'-- Real-time recording of playback, NOT an offline export.',
		't=0',
		'function _update()',
		' t+=1',
		` if t==1 then extcmd("set_filename","${wavBasename}") extcmd("audio_rec") ${play} end`,
		` if t==${frames} then extcmd("audio_end",1) end`,
		` if t==${frames + 1} then printh("${sentinel}") end`,
		'end',
		'function _draw() cls() print("rendering "..t,0,0,7) end',
		'',
	].join('\n');

	cart.setSection('lua', lua);

	return {
		cartText: cart.serialize(),
		seconds,
		frames,
		wavBasename,
		description: describeTarget(target),
	};
}

/**
 * Builds the `audio record <cart>` harness: unlike `render`, this captures the
 * cart's OWN playback, so it keeps the cart's `__lua__` and only APPENDS a
 * cooperative recorder tab that starts recording immediately and stops after the
 * window. The recorder runs as an extra code tab so it does not disturb the
 * cart's own `_update`/`_draw` (PICO-8 runs all tabs; the appended top-level code
 * arms the recorder and a hooked `_update` advances the timer).
 *
 * Because a general cart may define its own `_update`, the recorder wraps it: it
 * saves the cart's `_update` and installs one that ticks the record timer then
 * calls the original. This is the record analogue of the debug skill's "add
 * capture lines, run, revert" recipe, done on a THROWAWAY copy.
 *
 * @throws {HarnessError} an unparseable cart.
 */
export function buildRecordHarness(
	cartText: string,
	options: {seconds?: number; sentinel?: string; wavBasename?: string} = {},
): RenderHarness {
	let cart: Cart;
	try {
		cart = Cart.parse(cartText);
	} catch (e) {
		throw new HarnessError(
			'audio-render-cart-parse-error',
			`cart does not parse: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	const seconds = options.seconds ?? DEFAULT_RECORD_SECONDS;
	const frames = Math.max(1, Math.round(seconds * PICO8_FRAMES_PER_SECOND));
	const sentinel = options.sentinel ?? DONE_SENTINEL;
	const wavBasename = options.wavBasename ?? RECORD_WAV_BASENAME;

	const existing = cart.getSection('lua') ?? '';
	// Append the recorder AFTER the cart's own code. It wraps _update so it works
	// whether or not the cart defines one, and never edits the cart's own logic.
	const recorder = [
		'',
		'-->8',
		'-- picopilot audio record harness (throwaway; ADR-0009).',
		"-- Records the cart's own audio; real-time capture, NOT an offline export.",
		'__pp_rec_update=_update',
		'__pp_rec_t=0',
		'function _update()',
		' __pp_rec_t+=1',
		` if __pp_rec_t==1 then extcmd("set_filename","${wavBasename}") extcmd("audio_rec") end`,
		` if __pp_rec_t==${frames} then extcmd("audio_end",1) end`,
		` if __pp_rec_t==${frames + 1} then printh("${sentinel}") end`,
		' if __pp_rec_update then __pp_rec_update() end',
		'end',
		'',
	].join('\n');

	cart.setSection('lua', existing + recorder);

	return {
		cartText: cart.serialize(),
		seconds,
		frames,
		wavBasename,
		description: 'the running cart',
	};
}
