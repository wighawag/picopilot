import {describe, expect, it} from 'vitest';
import {Cart} from '../cart/index.js';
import {DONE_SENTINEL} from './adapter.js';
import {
	ACK,
	BLOCK_SIZE,
	BUTTON_BITS,
	BlockDecoder,
	buildDriveHarness,
	buildDriveScript,
	btnpEdges,
	DriveError,
	encodeScript,
	GENERIC_INPUT,
	OPCODE,
	parseButtons,
	parseInputScript,
	pressesToHeld,
	SHOT_BASENAME,
} from './drive.js';

/**
 * The `playtest` drive-transform is PURE (cart text + spec in, driven cart +
 * command blocks out), so every load-bearing verified fact (ADR-0011) is
 * unit-tested WITHOUT the paid PICO-8 binary: the btn/btnp shim, the callback
 * wrap, btnp-edge reconstruction, the fixed-size opcode/block codec, and the
 * opt-in srand. Live drive-and-capture is the manual/opt-in tier.
 */

const HEADER = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n';

/** A cart with a normal `_update`/`_draw` reading real buttons. */
const NORMAL_CART =
	`${HEADER}__lua__\n` +
	'x=64\n' +
	'function _update() if btnp(4) then x+=1 end end\n' +
	'function _draw() cls() circfill(x,64,4,8) end\n';

describe('btnpEdges (the btnp-edge reconstruction, ADR-0011)', () => {
	it('a single press = exactly one edge frame', () => {
		// held: off, on, off -> edge only on the 0->1 frame.
		expect(btnpEdges([0, 0b1, 0])).toEqual([0, 0b1, 0]);
	});

	it('a hold = one edge then held (no repeat)', () => {
		// held on for four frames -> edge on the first, then nothing.
		expect(btnpEdges([0b1, 0b1, 0b1, 0b1])).toEqual([0b1, 0, 0, 0]);
	});

	it('release + press = two edges', () => {
		// on, off, on -> edge on frame 0 and frame 2 (the re-press).
		expect(btnpEdges([0b1, 0, 0b1])).toEqual([0b1, 0, 0b1]);
	});

	it('tracks each button bit independently', () => {
		// O (bit4) held while Right (bit1) pulses: each has its own edge.
		const held = [0b10000, 0b10010, 0b10000, 0b10010];
		expect(btnpEdges(held)).toEqual([0b10000, 0b00010, 0, 0b00010]);
	});
});

describe('pressesToHeld (level-signal expansion)', () => {
	it('sets a bit for every frame in a press window', () => {
		const held = pressesToHeld([{from: 1, to: 3, bit: BUTTON_BITS.o}], 5);
		expect(held).toEqual([0, 0b10000, 0b10000, 0b10000, 0]);
	});

	it('ORs overlapping presses of different buttons', () => {
		const held = pressesToHeld(
			[
				{from: 0, to: 1, bit: BUTTON_BITS.o},
				{from: 1, to: 1, bit: BUTTON_BITS.right},
			],
			2,
		);
		expect(held).toEqual([0b10000, 0b10010]);
	});
});

describe('parseInputScript (the --input grammar)', () => {
	it('parses single-frame presses and hold windows', () => {
		expect(parseInputScript('3:4, 18-22:4, 20:1')).toEqual([
			{from: 3, to: 3, bit: 4},
			{from: 18, to: 22, bit: 4},
			{from: 20, to: 20, bit: 1},
		]);
	});

	it('rejects an out-of-range button bit (structured, not silent)', () => {
		expect(() => parseInputScript('3:9')).toThrowError(DriveError);
		try {
			parseInputScript('3:9');
		} catch (e) {
			expect((e as DriveError).code).toBe('playtest-input-invalid');
		}
	});

	it('rejects a malformed token', () => {
		expect(() => parseInputScript('press-start')).toThrowError(DriveError);
	});

	it('rejects a backwards hold window', () => {
		expect(() => parseInputScript('22-18:4')).toThrowError(DriveError);
	});
});

describe('parseButtons (the live-session input grammar, ADR-0011 US #6)', () => {
	it('parses button NAMES into a single held byte', () => {
		expect(parseButtons('right o')).toBe(
			(1 << BUTTON_BITS.right) | (1 << BUTTON_BITS.o),
		);
	});

	it('accepts single-letter aliases + commas + case', () => {
		expect(parseButtons('L, R')).toBe(
			(1 << BUTTON_BITS.left) | (1 << BUTTON_BITS.right),
		);
	});

	it('an empty spec is the byte 0 (release all)', () => {
		expect(parseButtons('')).toBe(0);
		expect(parseButtons('  ,  ')).toBe(0);
	});

	it('rejects an unknown button (structured, not silent)', () => {
		expect(() => parseButtons('jump')).toThrowError(DriveError);
		try {
			parseButtons('jump');
		} catch (e) {
			expect((e as DriveError).code).toBe('playtest-input-invalid');
		}
	});
});

describe('the drive shim ACK handshake (the resumable session waits on it)', () => {
	it('a STEP acks on COMPLETION (budget reaches 0), not at read time', () => {
		const {cartText} = buildDriveHarness(NORMAL_CART);
		// The STEP-DONE ack is printed when the budget hits 0 (frames advanced),
		// so the host learns the N frames ACTUALLY ran, never mid-step.
		expect(cartText).toContain(
			`if __drv_budget==0 then printh("${ACK.stepDone}")`,
		);
		// The STEP opcode branch itself does NOT printh a read-time step ack.
		expect(cartText).not.toContain(`__drv_budget=arg printh`);
	});

	it('INPUT/SHOT/PAUSE ack at read time (they complete their frame)', () => {
		const {cartText} = buildDriveHarness(NORMAL_CART);
		expect(cartText).toContain(`printh("${ACK.input}")`);
		expect(cartText).toContain(`printh("${ACK.shot}")`);
		expect(cartText).toContain(`printh("${ACK.pause}")`);
	});
});

describe('the opcode/block codec (fixed-size, ADR-0011)', () => {
	it('encodes each command into exactly BLOCK_SIZE bytes', () => {
		const blocks = encodeScript([
			{op: 'input', held: 0b10000},
			{op: 'step', frames: 3},
			{op: 'shot'},
			{op: 'quit'},
		]);
		expect(blocks.length).toBe(4 * BLOCK_SIZE);
		// input block: opcode, held, pad, pad
		expect([...blocks.slice(0, BLOCK_SIZE)]).toEqual([
			OPCODE.input,
			0b10000,
			0,
			0,
		]);
		// step block carries the frame count as its arg
		expect([...blocks.slice(BLOCK_SIZE, 2 * BLOCK_SIZE)]).toEqual([
			OPCODE.step,
			3,
			0,
			0,
		]);
	});

	it('a script decodes back to the exact commands', () => {
		const script = buildDriveScript({
			presses: [{from: 0, to: 0, bit: BUTTON_BITS.o}],
			frames: 2,
			shotFrames: [1],
		});
		const decoded = new BlockDecoder().push(encodeScript(script));
		expect(decoded).toEqual(script);
	});

	it('a block split across two reads still decodes exactly once', () => {
		// The load-bearing coalesce/split property: a block delivered in two
		// arbitrary-sized chunks yields exactly one command, no more, no less.
		const blocks = encodeScript([{op: 'step', frames: 7}, {op: 'shot'}]);
		const decoder = new BlockDecoder();
		// Split at byte 3 (mid-way through the first block) and again mid-second.
		expect(decoder.push(blocks.slice(0, 3))).toEqual([]); // partial: nothing yet
		const afterFirst = decoder.push(blocks.slice(3, 5)); // completes block 1, starts 2
		expect(afterFirst).toEqual([{op: 'step', frames: 7}]);
		const afterRest = decoder.push(blocks.slice(5));
		expect(afterRest).toEqual([{op: 'shot'}]);
	});
});

describe('buildDriveScript (the one-shot command sequence)', () => {
	it('interleaves INPUT/STEP and SHOT at the shot frames, then QUIT', () => {
		const script = buildDriveScript({
			presses: [{from: 0, to: 0, bit: BUTTON_BITS.o}],
			frames: 3,
			shotFrames: [2],
		});
		// It ends with a single QUIT.
		expect(script[script.length - 1]).toEqual({op: 'quit'});
		// Exactly one SHOT (at frame 2).
		expect(script.filter((c) => c.op === 'shot')).toHaveLength(1);
		// One STEP per frame (3 frames).
		expect(script.filter((c) => c.op === 'step')).toHaveLength(3);
	});

	it('re-sends INPUT only when the held level changes (compact stream)', () => {
		// Frame 0 press O, frames 1-2 nothing: INPUT changes 0b10000 -> 0 once each.
		const script = buildDriveScript({
			presses: [{from: 0, to: 0, bit: BUTTON_BITS.o}],
			frames: 3,
			shotFrames: [],
		});
		const inputs = script.filter((c) => c.op === 'input');
		expect(inputs).toEqual([
			{op: 'input', held: 0b10000},
			{op: 'input', held: 0},
		]);
	});
});

describe('buildDriveHarness (the throwaway driven cart, ADR-0011)', () => {
	it('prepends the btn/btnp shim reading serial(0x804)', () => {
		const {cartText} = buildDriveHarness(NORMAL_CART);
		expect(cartText).toContain('serial(0x804');
		expect(cartText).toContain('function btn(i,p)');
		expect(cartText).toContain('function btnp(i,p)');
		// btnp is an EDGE (held & ~prev), not the raw level.
		expect(cartText).toContain('__drv_prev');
	});

	it('wraps whichever ticked callback the cart defines (_update)', () => {
		const {cartText} = buildDriveHarness(NORMAL_CART);
		// Captures the cart's own _update as the ticked callback, then owns _update.
		expect(cartText).toContain('__drv_tick=_update');
		expect(cartText).toContain('function _update()');
	});

	it('wraps _update60 for a 60fps cart', () => {
		const cart = `${HEADER}__lua__\nfunction _update60() end\nfunction _draw() end\n`;
		const {cartText} = buildDriveHarness(cart);
		expect(cartText).toContain('__drv_tick=_update60');
	});

	it('is no-op-safe for a draw-only cart (no _update at all)', () => {
		const drawOnly = `${HEADER}__lua__\nfunction _draw() cls() print("hi") end\n`;
		const {cartText} = buildDriveHarness(drawOnly);
		// No ticked callback is captured, but the harness still installs _update
		// (so the drain/shot loop runs) and wraps _draw.
		expect(cartText).not.toContain('__drv_tick=');
		expect(cartText).toContain('function _update()');
		expect(cartText).toContain('__drv_draw=_draw');
		// The produced cart still parses.
		expect(() => Cart.parse(cartText)).not.toThrow();
	});

	it('encodes the given script into the exact fixed-size blocks', () => {
		const {blocks, script} = buildDriveHarness(NORMAL_CART, {
			presses: [{from: 0, to: 0, bit: BUTTON_BITS.o}],
			frames: 2,
			shotFrames: [1],
		});
		expect(blocks.length).toBe(script.length * BLOCK_SIZE);
		expect(new BlockDecoder().push(blocks)).toEqual(script);
	});

	it('injects srand(n) iff a seed is given (opt-in, never silent)', () => {
		expect(buildDriveHarness(NORMAL_CART, {seed: 42}).cartText).toContain(
			'srand(42)',
		);
		expect(buildDriveHarness(NORMAL_CART).cartText).not.toContain('srand(');
	});

	it('leaves the entry cart bytes UNTOUCHED (transforms a copy)', () => {
		const before = NORMAL_CART;
		buildDriveHarness(before, {seed: 1});
		expect(before).toBe(NORMAL_CART); // the input string is not mutated
		// And the entry's non-lua sections survive byte-for-byte.
		const original = Cart.parse(NORMAL_CART);
		const driven = Cart.parse(buildDriveHarness(NORMAL_CART).cartText);
		expect(driven.getSection('gfx')).toBe(original.getSection('gfx'));
	});

	it('freezes BOTH the ticked callback and _draw when paused (budget-gated)', () => {
		const {cartText} = buildDriveHarness(NORMAL_CART);
		// The ticked callback only advances while __drv_budget>0.
		expect(cartText).toContain('if __drv_budget>0 then');
		// _draw is gated so a paused frame is stable (not re-run every frame).
		expect(cartText).toContain('__drv_advanced');
	});

	it('names screenshots with the shot basename and prints the sentinel on quit', () => {
		const {cartText, shotBasename} = buildDriveHarness(NORMAL_CART);
		expect(shotBasename).toBe(SHOT_BASENAME);
		// The SHOT names a pending screenshot `<basename><n>` then screenshots it
		// AFTER the cart's draw (so the capture is the frame just rendered).
		expect(cartText).toContain(`"${SHOT_BASENAME}"..__drv_shot`);
		expect(cartText).toContain('extcmd("set_filename",__drv_pshot)');
		expect(cartText).toContain(`printh("${DONE_SENTINEL}")`);
	});

	it('uses the generic input default when no presses are given', () => {
		const {script} = buildDriveHarness(NORMAL_CART);
		// The generic default presses O to start (bit 4) at frame 3.
		const firstPress = script.find((c) => c.op === 'input' && c.held !== 0);
		expect(firstPress).toEqual({op: 'input', held: 1 << BUTTON_BITS.o});
		expect(GENERIC_INPUT[0]).toEqual({from: 3, to: 3, bit: BUTTON_BITS.o});
	});

	it('refuses an unparseable cart (structured, not a crash)', () => {
		try {
			buildDriveHarness('not a cart');
			throw new Error('expected a refusal');
		} catch (e) {
			expect((e as DriveError).code).toBe('playtest-cart-parse-error');
		}
	});
});
