/**
 * The `playtest` DRIVE-transform (ADR-0011): the PURE, CI-testable core that
 * turns an ARBITRARY cart's Lua + a driven-run SPEC into a THROWAWAY driven cart
 * whose input and frame loop the harness OWNS. This is the load-bearing seam of
 * `picopilot playtest`, kept pure (cart text + spec in -> cart text + encoded
 * command blocks out) so its correctness (the `btn`/`btnp` shim, the
 * `_update`/`_draw` wrap, btnp-edge reconstruction, the opcode/block codec, the
 * opt-in `srand`) is unit-tested WITHOUT the paid PICO-8 binary. Only the live
 * drive-and-capture needs a real session (the manual/opt-in tier, ADR-0011).
 *
 * The recipe is DECIDED + spike-verified (PICO-8 v0.2.7). This module IMPLEMENTS
 * it; it is not open design. The three load-bearing verified facts:
 *  1. Redefine the global `btn`/`btnp` to read a per-frame held-buttons byte
 *     from `serial(0x804)`, RECONSTRUCTING `btnp` EDGES from the held level (a
 *     single scripted press = exactly one `btnp` true frame, not held-repeat).
 *  2. The host<->cart transport is FIXED-SIZE command blocks (small unpadded
 *     writes to a live `-x` stdin coalesce/drop in the OS pipe buffer), drained
 *     ONE block per frame gated on the step-budget, with a `printh` ACK per
 *     completed command (the resumable session waits on the ACK; the one-shot
 *     ignores it).
 *  3. The harness OWNS the frame loop: it wraps `_update`/`_update60`/`_draw` so
 *     a STEP advances exactly N frames and a PAUSE (budget 0) FREEZES the game
 *     (its callbacks skipped -> all state held, incl. logic in `_draw`).
 *
 * The one-shot command sends the whole script up front and exits; the cart-side
 * machine here is identical to what the resumable session reuses (ADR-0011).
 */

import {Cart} from '../cart/index.js';
import {CartParseError} from '../cart/errors.js';
import {DONE_SENTINEL} from './adapter.js';

/**
 * A structured reason a drive harness could not be built (a target refusal, not
 * a crash). Surfaced by the command as incur's `error({code,...})` envelope.
 */
export type DriveErrorCode =
	/** The cart could not be parsed (not a valid .p8). */
	| 'playtest-cart-parse-error'
	/** The input script named an out-of-range button bit or frame. */
	| 'playtest-input-invalid';

/** A structured drive-harness-build failure. */
export class DriveError extends Error {
	readonly code: DriveErrorCode;
	constructor(code: DriveErrorCode, message: string) {
		super(message);
		this.name = 'DriveError';
		this.code = code;
	}
}

/**
 * The PICO-8 button bit order (the `btn(i)`/`btnp(i)` index), used by the
 * held-buttons byte the harness pipes over `serial(0x804)`: bit `i` set = button
 * `i` held this frame. Matches PICO-8's own `btn` indices (verified).
 */
export const BUTTON_BITS = {
	left: 0,
	right: 1,
	up: 2,
	down: 3,
	o: 4,
	x: 5,
} as const;

/** The valid button-bit range [0,5] a held-buttons byte can set. */
export const BUTTON_BIT_MIN = 0;
export const BUTTON_BIT_MAX = 5;

/** The accepted button NAMES (and their bits) the live `input` verb parses. */
export const BUTTON_NAMES: Readonly<Record<string, number>> = {
	left: BUTTON_BITS.left,
	right: BUTTON_BITS.right,
	up: BUTTON_BITS.up,
	down: BUTTON_BITS.down,
	o: BUTTON_BITS.o,
	x: BUTTON_BITS.x,
	// Common single-letter directional aliases.
	l: BUTTON_BITS.left,
	r: BUTTON_BITS.right,
	u: BUTTON_BITS.up,
	d: BUTTON_BITS.down,
};

/**
 * Parses a live-session `input` button spec into a single HELD-buttons byte: a
 * comma/space-separated list of button NAMES (`left right up down o x`, plus the
 * single-letter aliases `l r u d`), e.g. `"right o"` = hold Right + O this turn.
 * Case-insensitive; an empty spec is the byte 0 (release all). An unknown name is
 * a structured {@link DriveError} (`playtest-input-invalid`), never a silent skip.
 * This is the SESSION-facing input surface (per-turn held level); the one-shot's
 * {@link parseInputScript} is the frame-scripted surface. Both land on the same
 * held byte -> {@link btnpEdges} machine.
 */
export function parseButtons(spec: string): number {
	let held = 0;
	for (const raw of spec.split(/[\s,]+/)) {
		const name = raw.trim().toLowerCase();
		if (name.length === 0) continue;
		const bit = BUTTON_NAMES[name];
		if (bit === undefined) {
			throw new DriveError(
				'playtest-input-invalid',
				`unknown button "${raw}": use left/right/up/down/o/x (or l/r/u/d), space- or comma-separated`,
			);
		}
		held |= 1 << bit;
	}
	return held;
}

/**
 * The FIXED command-block size in bytes (ADR-0011). Load-bearing: small unpadded
 * writes to a live `pico8 -x` stdin coalesce/drop in the OS pipe buffer, so every
 * command is sent as a block of exactly this many bytes (opcode + arg + pad). The
 * cart reads exactly this many bytes per frame and buffers a partial block across
 * frames. 4 bytes comfortably clears the 1-2 byte coalesce window the spike hit.
 */
export const BLOCK_SIZE = 4;

/**
 * The tagged opcodes carried in a command block's first byte (ADR-0011). One
 * command per block; the cart drains one block per frame against the step budget.
 *  - STEP<n>:   advance exactly `n` frames (the arg byte), then pause.
 *  - INPUT<b>:  set the held-buttons byte to `b` (the arg byte) for the next STEP.
 *  - SHOT:      screenshot the current (frozen) frame.
 *  - PAUSE:     set the step budget to 0 (freeze; callbacks skipped).
 *  - QUIT:      print the done-sentinel so the launcher kills PICO-8.
 */
export const OPCODE = {
	step: 1,
	input: 2,
	shot: 3,
	pause: 4,
	quit: 5,
} as const;

export type OpcodeName = keyof typeof OPCODE;

/**
 * The cart-side ACK lines the drive shim `printh`s when a command COMPLETES
 * (ADR-0011: the resumable session WAITS for the ACK before sending the next
 * command; the one-shot ignores them and waits only for the QUIT sentinel). One
 * source of truth shared by the Lua shim (which prints them) and the host-side
 * {@link import('./session.js').DriveSession} (which waits on them), so the
 * handshake can never drift between the two ends.
 *
 * The load-bearing one is {@link ACK.stepDone}: a STEP's ACK fires when the frame
 * budget REACHES ZERO (the N frames have actually advanced), NOT when the STEP
 * block is merely read. That is what makes stepping deterministic, the host acts
 * on a SETTLED, known frame, never mid-step. INPUT/SHOT/PAUSE complete the frame
 * they are read (instantaneous), so they ACK at read time.
 */
export const ACK = {
	/** A STEP's frame budget has fully drained (the N frames advanced). */
	stepDone: '__PP_ACK_STEP_DONE__',
	/** The held-buttons byte was set (INPUT). */
	input: '__PP_ACK_INPUT__',
	/** A screenshot was queued for the current frame (SHOT). */
	shot: '__PP_ACK_SHOT__',
	/** The frame budget was forced to 0 (PAUSE). */
	pause: '__PP_ACK_PAUSE__',
} as const;

/** One command in a driven-run script (the pre-codec, human-facing form). */
export type DriveCommand =
	| {readonly op: 'step'; readonly frames: number}
	| {readonly op: 'input'; readonly held: number}
	| {readonly op: 'shot'}
	| {readonly op: 'pause'}
	| {readonly op: 'quit'};

/**
 * A single scripted button press/hold: press button `bit` on every frame in
 * `[from, to]` inclusive (a single-frame press is `from === to`). The parsed
 * form of the `--input "frame:bit,..."` spec, before it is expanded into the
 * per-frame held-buttons bytes and then INPUT/STEP command blocks.
 */
export interface ScriptedPress {
	readonly from: number;
	readonly to: number;
	readonly bit: number;
}

/**
 * Encodes one {@link DriveCommand} into a FIXED-SIZE ({@link BLOCK_SIZE}) block:
 * `[opcode, arg, 0, 0]`. `arg` carries the STEP frame count or the INPUT held
 * byte; SHOT/PAUSE/QUIT ignore it (0). Fixed size is the point (ADR-0011): the
 * cart always consumes exactly {@link BLOCK_SIZE} bytes per read.
 */
export function encodeCommand(cmd: DriveCommand): Uint8Array {
	const block = new Uint8Array(BLOCK_SIZE); // zero-padded by construction
	switch (cmd.op) {
		case 'step':
			block[0] = OPCODE.step;
			block[1] = cmd.frames & 0xff;
			break;
		case 'input':
			block[0] = OPCODE.input;
			block[1] = cmd.held & 0xff;
			break;
		case 'shot':
			block[0] = OPCODE.shot;
			break;
		case 'pause':
			block[0] = OPCODE.pause;
			break;
		case 'quit':
			block[0] = OPCODE.quit;
			break;
	}
	return block;
}

/** Encodes a whole command script into a single concatenated block stream. */
export function encodeScript(script: readonly DriveCommand[]): Uint8Array {
	const out = new Uint8Array(script.length * BLOCK_SIZE);
	script.forEach((cmd, i) => out.set(encodeCommand(cmd), i * BLOCK_SIZE));
	return out;
}

/**
 * A stateful block DECODER mirroring the cart-side shim: feed it raw byte chunks
 * (a live `-x` stdin delivers arbitrary-sized reads), it buffers partial blocks
 * across chunks and yields exactly one {@link DriveCommand} per completed
 * {@link BLOCK_SIZE}-byte block. This is the TS twin of the Lua decoder, so the
 * codec (including "a block split across two reads still decodes once") is
 * asserted in CI without the binary.
 */
export class BlockDecoder {
	private buffer: number[] = [];

	/** Feeds a chunk of bytes; returns the commands newly completed by it. */
	push(chunk: Uint8Array | readonly number[]): DriveCommand[] {
		for (const b of chunk) this.buffer.push(b & 0xff);
		const out: DriveCommand[] = [];
		while (this.buffer.length >= BLOCK_SIZE) {
			const block = this.buffer.splice(0, BLOCK_SIZE);
			out.push(decodeBlock(block));
		}
		return out;
	}
}

/** Decodes one {@link BLOCK_SIZE}-byte block into a {@link DriveCommand}. */
export function decodeBlock(block: readonly number[]): DriveCommand {
	const [op = 0, arg = 0] = block;
	switch (op) {
		case OPCODE.step:
			return {op: 'step', frames: arg};
		case OPCODE.input:
			return {op: 'input', held: arg};
		case OPCODE.shot:
			return {op: 'shot'};
		case OPCODE.pause:
			return {op: 'pause'};
		case OPCODE.quit:
			return {op: 'quit'};
		default:
			// An unknown opcode is a no-op step-0 (never a crash); the codec is total.
			return {op: 'step', frames: 0};
	}
}

/**
 * Reconstructs `btnp` EDGES from a per-frame HELD-buttons sequence (ADR-0011,
 * the load-bearing verified fact). Given the held byte for each frame, returns
 * the `btnp` byte for each frame: bit `i` is set only on the frame the button
 * TRANSITIONS 0 -> 1 (a rising edge), so a single scripted press triggers exactly
 * one `btnp` (menus/start/single-actions behave), a hold triggers one edge then
 * stays held (no repeat), and a release+press triggers two edges. This is a pure
 * mirror of the cart-side shim (`btnp = held & ~prev`), tested independently.
 */
export function btnpEdges(held: readonly number[]): number[] {
	let prev = 0;
	return held.map((cur) => {
		const edge = cur & ~prev & 0xff;
		prev = cur;
		return edge;
	});
}

/**
 * Expands scripted presses into a per-frame HELD-buttons byte array of length
 * `frames`: frame `f`'s byte has bit `p.bit` set for every press `p` whose
 * `[from,to]` window covers `f`. This is the level signal the harness pipes; the
 * cart reconstructs `btnp` edges from it (see {@link btnpEdges}).
 */
export function pressesToHeld(
	presses: readonly ScriptedPress[],
	frames: number,
): number[] {
	const held = new Array<number>(frames).fill(0);
	for (const p of presses) {
		for (let f = Math.max(0, p.from); f <= p.to && f < frames; f++) {
			held[f] = (held[f] ?? 0) | (1 << p.bit);
		}
	}
	return held;
}

/**
 * Parses an `--input` spec into scripted presses. The grammar is a comma list of
 * `frame:bit` (a single-frame press) or `from-to:bit` (a hold across the inclusive
 * window), e.g. `"3:4, 18-22:4, 20:1"` = press O at frame 3, hold O frames 18..22,
 * press right at frame 20. Whitespace around tokens is ignored. A malformed token
 * or an out-of-range bit is a structured {@link DriveError}, never a silent skip.
 */
export function parseInputScript(spec: string): ScriptedPress[] {
	const presses: ScriptedPress[] = [];
	for (const raw of spec.split(',')) {
		const tok = raw.trim();
		if (tok.length === 0) continue;
		const m = /^(\d+)(?:-(\d+))?:(\d+)$/.exec(tok);
		if (m === null) {
			throw new DriveError(
				'playtest-input-invalid',
				`bad input token "${tok}": expected "frame:bit" or "from-to:bit" (bit 0=L 1=R 2=U 3=D 4=O 5=X)`,
			);
		}
		const from = Number(m[1]);
		const to = m[2] !== undefined ? Number(m[2]) : from;
		const bit = Number(m[3]);
		if (bit < BUTTON_BIT_MIN || bit > BUTTON_BIT_MAX) {
			throw new DriveError(
				'playtest-input-invalid',
				`button bit ${bit} out of range ${BUTTON_BIT_MIN}..${BUTTON_BIT_MAX} in "${tok}" (0=L 1=R 2=U 3=D 4=O 5=X)`,
			);
		}
		if (to < from) {
			throw new DriveError(
				'playtest-input-invalid',
				`hold window end ${to} precedes start ${from} in "${tok}"`,
			);
		}
		presses.push({from, to, bit});
	}
	return presses;
}

/**
 * The GENERIC input default (ADR-0011, US #9): applied when `--input` is omitted.
 * Tuned to REACH play and stay there briefly for common one-button / runner /
 * flappy shapes: press O once to START, a few well-spaced single-frame O presses
 * (clean `btnp` edges) so a one-button game acts without dying instantly, a short
 * O HOLD for hold-to-thrust games, and a right-nudge for directional runners. It
 * is a best-effort default, NOT a universal driver; an unusual control scheme
 * should pass an explicit per-cart `--input` (documented in the command help).
 */
export const GENERIC_INPUT: readonly ScriptedPress[] = [
	{from: 3, to: 3, bit: BUTTON_BITS.o}, // press O to start
	{from: 16, to: 16, bit: BUTTON_BITS.o}, // a gentle action
	{from: 18, to: 22, bit: BUTTON_BITS.o}, // a short hold (thrust games)
	{from: 20, to: 20, bit: BUTTON_BITS.right}, // a right-nudge (runners)
	{from: 24, to: 24, bit: BUTTON_BITS.o},
	{from: 30, to: 30, bit: BUTTON_BITS.o},
];

/**
 * The default number of frames the generic/one-shot driver advances the cart, and
 * the shot points within it. Chosen (per the spike) to catch LIVE play soon after
 * the start press (before any death/retry churn) then a couple more spread out.
 */
export const DEFAULT_DRIVE_FRAMES = 40;
export const DEFAULT_SHOT_FRAMES: readonly number[] = [12, 22, 34];

/**
 * The driven-run SPEC the transform expands: either an explicit per-frame press
 * script (`presses`) or the {@link GENERIC_INPUT} default, plus the frames to
 * advance, the frames to screenshot at, and the opt-in `srand` seed.
 */
export interface DriveSpec {
	/** The scripted presses; defaults to {@link GENERIC_INPUT} when omitted. */
	readonly presses?: readonly ScriptedPress[];
	/** Total frames to advance the driven cart (defaults to {@link DEFAULT_DRIVE_FRAMES}). */
	readonly frames?: number;
	/** The frames to screenshot at (defaults to {@link DEFAULT_SHOT_FRAMES}). */
	readonly shotFrames?: readonly number[];
	/**
	 * The opt-in determinism seed (US #4, ADR-0011): iff given, the transform
	 * injects `srand(seed)` at cart start so an otherwise-random cart replays
	 * identically. NEVER injected silently (it changes game behaviour).
	 */
	readonly seed?: number;
	/** The done-sentinel the cart prints on QUIT (defaults to {@link DONE_SENTINEL}). */
	readonly sentinel?: string;
	/** The base filename the SHOT command names each screenshot (defaults to `play`). */
	readonly shotBasename?: string;
}

/** The default base filename SHOT names each screenshot (`play0.png`, ...). */
export const SHOT_BASENAME = 'play' as const;

/**
 * Builds the ONE-SHOT command SCRIPT from a spec: the full sequence of INPUT /
 * STEP / SHOT / QUIT blocks that drives the cart frame-by-frame. Each frame is an
 * INPUT (the held byte for that frame) followed by a single-frame STEP; SHOT
 * blocks are interleaved at the shot frames; a trailing QUIT ends the run. The
 * cart drains one block per frame, so the whole script is sent up front and the
 * cart replays it deterministically (ADR-0011: the one-shot sends everything and
 * exits; the block+ACK transport lets it queue without loss).
 */
export function buildDriveScript(spec: DriveSpec): DriveCommand[] {
	const presses = spec.presses ?? GENERIC_INPUT;
	const frames = spec.frames ?? DEFAULT_DRIVE_FRAMES;
	const shotFrames = new Set(spec.shotFrames ?? DEFAULT_SHOT_FRAMES);
	const held = pressesToHeld(presses, frames);

	const script: DriveCommand[] = [];
	let prevHeld = -1;
	for (let f = 0; f < frames; f++) {
		const h = held[f] ?? 0;
		// Only re-send INPUT when the held level CHANGES (the cart holds the last
		// value); this keeps the block stream compact without losing any edge.
		if (h !== prevHeld) {
			script.push({op: 'input', held: h});
			prevHeld = h;
		}
		script.push({op: 'step', frames: 1});
		if (shotFrames.has(f)) script.push({op: 'shot'});
	}
	script.push({op: 'quit'});
	return script;
}

/** The result of building a drive harness: the throwaway cart + its command blocks. */
export interface DriveHarness {
	/** The throwaway `.p8` cart text (the entry's cart is UNTOUCHED). */
	readonly cartText: string;
	/** The command script (pre-codec) the harness drives the cart with. */
	readonly script: readonly DriveCommand[];
	/** The encoded FIXED-SIZE command blocks to pipe to the cart's stdin. */
	readonly blocks: Uint8Array;
	/** The base filename SHOT names each screenshot (for the result envelope). */
	readonly shotBasename: string;
	/** The number of SHOT commands in the script (= expected screenshots). */
	readonly shotCount: number;
}

/**
 * Which frame callbacks the cart defines. `_update60` (60fps) takes precedence
 * over `_update` (30fps) in PICO-8; a cart may define only `_draw` (a draw-only
 * cart). The harness wraps whichever exist and is no-op-safe when one is missing.
 */
function definedCallbacks(lua: string): {
	update: boolean;
	update60: boolean;
	draw: boolean;
} {
	return {
		update: /function\s+_update\s*\(/.test(lua),
		update60: /function\s+_update60\s*\(/.test(lua),
		draw: /function\s+_draw\s*\(/.test(lua),
	};
}

/**
 * The DRIVE shim, prepended to a throwaway copy of the cart (ADR-0011). It:
 *  - redefines the global `btn`/`btnp` to read a per-frame held-buttons byte from
 *    a harness-owned variable, reconstructing `btnp` edges (`held & ~prev`);
 *  - decodes FIXED-SIZE ({@link BLOCK_SIZE}) command blocks from `serial(0x804)`,
 *    buffering partial blocks across frames, one block drained per frame;
 *  - owns the frame loop: a STEP advances exactly N frames (the budget); budget 0
 *    FREEZES the game (both `_update*` AND `_draw` skipped between shots, so
 *    logic-in-draw also freezes -> a stable framebuffer). A SHOT renders the
 *    current state once (via `_draw`) THEN screenshots it, so the capture always
 *    reflects the frame just drawn (never a stale/pre-draw framebuffer);
 *  - `printh`s an ACK when a command COMPLETES (INPUT/SHOT/PAUSE at read time; a
 *    STEP when its frame budget drains to 0, so a step ACK means the N frames
 *    actually ran, see {@link ACK}), which the resumable session waits on; the
 *    one-shot ignores the ACKs and waits only for the done-sentinel on QUIT.
 *
 * The shim wraps whichever of `_update`/`_update60`/`_draw` the cart defines by
 * capturing them AFTER the cart's code runs (in `_init`-time via a deferred
 * hook), so it is no-op-safe when a callback is missing.
 */
function driveShim(
	callbacks: {update: boolean; update60: boolean; draw: boolean},
	sentinel: string,
	shotBasename: string,
): string {
	// PICO-8 sets _update60 XOR _update; capture whichever exists as the ticked
	// callback. _draw is separate. We freeze BOTH when the budget is 0.
	return [
		'-- picopilot playtest drive shim (auto-injected; throwaway; ADR-0011).',
		'-- Redefines btn/btnp to a harness-piped held-buttons byte (serial 0x804),',
		'-- reconstructs btnp edges, and owns the frame loop (step/pause/shot/quit)',
		'-- over fixed-size command blocks. The entry cart is UNTOUCHED (copy).',
		'__drv_held=0 __drv_prev=0',
		'__drv_budget=0 __drv_buf="" __drv_shot=0 __drv_pshot=nil',
		`__drv_bs=${BLOCK_SIZE}`,
		`function btn(i,p) if i==nil then return __drv_held end return (__drv_held & (1<<i))!=0 end`,
		'function btnp(i,p) return (__drv_held & (1<<i))!=0 and (__drv_prev & (1<<i))==0 end',
		'-- Read exactly one fixed-size block per frame from stdin; buffer partials.',
		'function __drv_read_block()',
		' local n=serial(0x804,0x4300,__drv_bs)',
		' for j=0,n-1 do __drv_buf=__drv_buf..chr(peek(0x4300+j)) end',
		' if #__drv_buf<__drv_bs then return nil end',
		' local op=ord(__drv_buf,1) local arg=ord(__drv_buf,2)',
		' __drv_buf=sub(__drv_buf,__drv_bs+1)',
		' return op,arg',
		'end',
		'-- Drain one command block per frame, gated on the step budget.',
		'function __drv_poll()',
		' if __drv_budget>0 then return end',
		' local op,arg=__drv_read_block()',
		' if op==nil then return end',
		` if op==${OPCODE.input} then __drv_held=arg printh("${ACK.input}")`,
		// STEP does NOT ACK at read time; its ACK (`__drv_step_done`) fires when the
		// budget drains to 0 (below), so the host learns the N frames ACTUALLY ran.
		` elseif op==${OPCODE.step} then __drv_budget=arg`,
		` elseif op==${OPCODE.shot} then __drv_pshot="${shotBasename}"..__drv_shot __drv_shot+=1 printh("${ACK.shot}")`,
		` elseif op==${OPCODE.pause} then __drv_budget=0 printh("${ACK.pause}")`,
		` elseif op==${OPCODE.quit} then printh("${sentinel}")`,
		' end',
		'end',
		'-- Frame ownership: advance the ticked callback only while budget>0, and',
		'-- freeze _draw too so logic-in-draw holds. __drv_tick is set below.',
		'-- btnp edges are computed relative to the PREVIOUS TICK (not the previous',
		'-- host frame): INPUT and STEP arrive on separate frames, so __drv_prev is',
		'-- updated to the held level only AFTER a tick runs. A single scripted press',
		'-- (INPUT held then INPUT 0, each followed by a STEP) is thus one btnp edge.',
		'function __drv_step()',
		' __drv_poll()',
		' if __drv_budget>0 then',
		'  __drv_budget-=1',
		'  if __drv_tick then __drv_tick() end',
		'  __drv_prev=__drv_held',
		// A STEP completes (its ACK) the frame its budget reaches 0: the requested N
		// frames have now advanced, so the host acts on a settled frame (ADR-0011).
		` if __drv_budget==0 then printh("${ACK.stepDone}") end`,
		'  return true',
		' end',
		' return false',
		'end',
		'',
	].join('\n');
}

/**
 * The wrapper tab, appended AFTER the cart's code so the cart's callbacks are
 * already defined when we capture them. It saves the cart's own
 * `_update60`/`_update`/`_draw`, then installs harness-owned ones: the ticked
 * callback runs the drain/step (advancing the cart's real update only while the
 * budget allows), and `_draw` runs the cart's draw when a step advanced this
 * frame OR a SHOT is pending (so a paused game shows a STABLE frame yet a SHOT
 * always captures a freshly-drawn frame). A pending SHOT screenshots AFTER the
 * cart's draw, so the capture reflects the frame just rendered, never a stale
 * pre-draw framebuffer. No-op-safe when a callback is missing (draw-only carts).
 */
function wrapperTab(callbacks: {
	update: boolean;
	update60: boolean;
	draw: boolean;
}): string {
	const ticked = callbacks.update60
		? '_update60'
		: callbacks.update
			? '_update'
			: undefined;
	const lines: string[] = [
		'',
		'-->8',
		'-- picopilot playtest wrapper (auto-injected; throwaway; ADR-0011).',
		'-- Captures the cart callbacks AFTER its code ran, then OWNS the frame loop.',
	];
	// __drv_tick is the cart's real ticked callback (nil for a draw-only cart);
	// __drv_step advances it under the budget.
	if (ticked !== undefined) {
		lines.push(`__drv_tick=${ticked}`);
	}
	lines.push('__drv_draw=_draw', '__drv_advanced=false');
	// The harness-owned ticked callback: always defined so the drain runs even for
	// a draw-only cart. It advances the cart's real callback via __drv_step.
	lines.push(
		'function _update() __drv_advanced=__drv_step() end',
		// A cart that defined _update60 gets a 60fps loop; alias it.
		callbacks.update60
			? 'function _update60() __drv_advanced=__drv_step() end'
			: '',
		// _draw renders the cart's draw when a step advanced (live) OR a SHOT is
		// pending (render the frozen state for the capture). Between shots while
		// paused it is skipped, so logic-in-draw freezes and the last frame persists.
		// A pending SHOT screenshots AFTER the draw, so the PNG is the frame just
		// drawn, never a stale pre-draw framebuffer.
		'function _draw()',
		' if __drv_draw and (__drv_advanced or __drv_pshot!=nil) then __drv_draw() end',
		' if __drv_pshot!=nil then',
		'  extcmd("set_filename",__drv_pshot) extcmd("screen") __drv_pshot=nil',
		' end',
		'end',
		'',
	);
	return lines.filter((l) => l !== '').join('\n') + '\n';
}

/**
 * Builds the throwaway DRIVE harness (ADR-0011). Takes the user's cart text + a
 * {@link DriveSpec} and produces a new cart with the SAME `__gfx__`/`__sfx__`/...
 * and a `__lua__` that is: the drive shim, then the cart's own Lua (optionally
 * prefixed with `srand(seed)` iff `--seed` given), then the wrapper tab. The
 * entry's own cart bytes are NEVER mutated (we transform a parsed COPY).
 *
 * Returns the driven cart text plus the encoded command blocks the command pipes
 * to stdin. Kept pure so every path is unit-tested without the paid binary.
 *
 * @throws {DriveError} an unparseable cart.
 */
export function buildDriveHarness(
	cartText: string,
	spec: DriveSpec = {},
): DriveHarness {
	let cart: Cart;
	try {
		cart = Cart.parse(cartText);
	} catch (e) {
		if (e instanceof CartParseError) {
			throw new DriveError(
				'playtest-cart-parse-error',
				`cart does not parse: ${e.message}`,
			);
		}
		throw e;
	}

	const sentinel = spec.sentinel ?? DONE_SENTINEL;
	const shotBasename = spec.shotBasename ?? SHOT_BASENAME;
	const cartLua = cart.getSection('lua') ?? '';
	const callbacks = definedCallbacks(cartLua);

	// The opt-in srand: injected at the TOP of the cart's own code iff a seed is
	// given, never silently (it changes game behaviour). It runs before the cart's
	// _init/first frame, so rnd() is deterministic from the start.
	const seedLine = spec.seed !== undefined ? `srand(${spec.seed})\n` : '';

	const lua = [
		driveShim(callbacks, sentinel, shotBasename),
		seedLine + cartLua,
		wrapperTab(callbacks),
	].join('\n');

	cart.setSection('lua', lua);

	const script = buildDriveScript(spec);
	const blocks = encodeScript(script);
	const shotCount = script.filter((c) => c.op === 'shot').length;

	return {
		cartText: cart.serialize(),
		script,
		blocks,
		shotBasename,
		shotCount,
	};
}
