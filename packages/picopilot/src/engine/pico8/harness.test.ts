import {describe, expect, it} from 'vitest';
import {Cart} from '../cart/index.js';
import {mmlToSfxRow} from '../audio/sfx.js';
import {mergeSfxRow} from '../audio/section.js';
import {
	buildRecordHarness,
	buildRenderHarness,
	DEFAULT_RECORD_SECONDS,
	decodeSfxTiming,
	HarnessError,
	recordSeconds,
} from './harness.js';
import {DONE_SENTINEL} from './adapter.js';

/**
 * The `audio render`/`audio record` harness builder is PURE (cart-text in,
 * cart-text + record window out), so every path is unit-tested WITHOUT the paid
 * PICO-8 binary. Live capture is the manual/opt-in tier (ADR-0009).
 */

const HEADER = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n';

/** A cart with an authored SFX in slot `slot` (`mml`), and an existing __lua__. */
function cartWithSfx(slot: number, mml: string): string {
	const cart = Cart.parse(`${HEADER}__lua__\nfunction _update() end\n`);
	mergeSfxRow(cart, slot, mmlToSfxRow(mml).row);
	return cart.serialize();
}

describe('decodeSfxTiming', () => {
	it('reads speed + audible row count from a __sfx__ row', () => {
		// `s8` speed 8, four audible notes = 4 rows.
		const {row} = mmlToSfxRow('s8 @1 v6 c d e f');
		const timing = decodeSfxTiming(row);
		expect(timing.speed).toBe(8);
		expect(timing.rows).toBe(4);
	});

	it('does not count a trailing silent tail as audible rows', () => {
		const {row} = mmlToSfxRow('s16 @0 v5 c r r'); // one note then two rests
		expect(decodeSfxTiming(row).rows).toBe(1);
	});
});

describe('recordSeconds', () => {
	it('derives the window from an SFX target speed + rows (+ tail)', () => {
		// speed 16 x 4 rows = 64 ticks / 120 = 0.533s, + 0.5 tail ~= 1.03s.
		const cart = Cart.parse(cartWithSfx(3, 's16 @1 v6 c d e f'));
		const secs = recordSeconds(cart, {kind: 'sfx', index: 3});
		expect(secs).toBeCloseTo(64 / 120 + 0.5, 2);
	});

	it('uses the default window for a pattern/song target (length not derivable)', () => {
		const cart = Cart.parse(cartWithSfx(0, 's16 c'));
		expect(recordSeconds(cart, {kind: 'song'})).toBe(DEFAULT_RECORD_SECONDS);
		expect(recordSeconds(cart, {kind: 'pattern', index: 0})).toBe(
			DEFAULT_RECORD_SECONDS,
		);
	});

	it('an explicit override always wins', () => {
		const cart = Cart.parse(cartWithSfx(3, 's16 c d e f'));
		expect(recordSeconds(cart, {kind: 'sfx', index: 3}, 12)).toBe(12);
	});
});

describe('buildRenderHarness', () => {
	it('injects an audio_rec/target-play/audio_end/sentinel harness for an SFX target', () => {
		const h = buildRenderHarness(cartWithSfx(5, 's8 @3 v6 c e g'), {
			kind: 'sfx',
			index: 5,
		});
		expect(h.cartText).toContain('extcmd("audio_rec")');
		expect(h.cartText).toContain('sfx(5)'); // plays the chosen target
		expect(h.cartText).toContain('extcmd("audio_end",1)'); // save to current folder
		expect(h.cartText).toContain(`printh("${DONE_SENTINEL}")`);
		expect(h.description).toBe('sfx 5');
	});

	it('plays music(P) for a pattern target and music(0) for the whole song', () => {
		const cart = cartWithSfx(0, 's16 c');
		expect(
			buildRenderHarness(cart, {kind: 'pattern', index: 2}).cartText,
		).toContain('music(2)');
		expect(buildRenderHarness(cart, {kind: 'song'}).cartText).toContain(
			'music(0)',
		);
	});

	it('preserves the authored __sfx__ byte-for-byte (only __lua__ changes)', () => {
		const cartText = cartWithSfx(5, 's8 @3 v6 c e g');
		const original = Cart.parse(cartText);
		const rendered = Cart.parse(
			buildRenderHarness(cartText, {kind: 'sfx', index: 5}).cartText,
		);
		expect(rendered.getSection('sfx')).toBe(original.getSection('sfx'));
	});

	it('records for at least the target play window (frames = seconds * 30fps)', () => {
		const h = buildRenderHarness(cartWithSfx(3, 's16 @1 v6 c d e f'), {
			kind: 'sfx',
			index: 3,
		});
		expect(h.frames).toBe(Math.round(h.seconds * 30));
		expect(h.frames).toBeGreaterThan(0);
	});

	it('refuses an out-of-range SFX target (structured, not silent)', () => {
		expect(() =>
			buildRenderHarness(cartWithSfx(0, 's16 c'), {kind: 'sfx', index: 99}),
		).toThrowError(HarnessError);
		try {
			buildRenderHarness(cartWithSfx(0, 's16 c'), {kind: 'sfx', index: 99});
		} catch (e) {
			expect((e as HarnessError).code).toBe('audio-render-target-out-of-range');
		}
	});

	it('refuses an empty SFX slot (nothing to render)', () => {
		try {
			buildRenderHarness(cartWithSfx(0, 's16 c'), {kind: 'sfx', index: 7});
			throw new Error('expected a refusal');
		} catch (e) {
			expect(e).toBeInstanceOf(HarnessError);
			expect((e as HarnessError).code).toBe('audio-render-target-empty');
		}
	});

	it('refuses an unparseable cart (not a .p8)', () => {
		try {
			buildRenderHarness('not a cart', {kind: 'song'});
			throw new Error('expected a refusal');
		} catch (e) {
			expect((e as HarnessError).code).toBe('audio-render-cart-parse-error');
		}
	});

	it('honours a custom sentinel + basename', () => {
		const h = buildRenderHarness(
			cartWithSfx(0, 's16 c'),
			{kind: 'song'},
			{
				sentinel: '__DONE__',
				wavBasename: 'out',
			},
		);
		expect(h.cartText).toContain('printh("__DONE__")');
		expect(h.cartText).toContain('extcmd("set_filename","out")');
		expect(h.wavBasename).toBe('out');
	});
});

describe('buildRecordHarness', () => {
	it('keeps the cart own code + appends a cooperative recorder tab', () => {
		const cartText = `${HEADER}__lua__\nfunction _update() foo() end\n`;
		const h = buildRecordHarness(cartText);
		// The cart's own code survives (record captures its OWN playback).
		expect(h.cartText).toContain('function _update() foo() end');
		// The recorder is appended as a separate tab that wraps _update.
		expect(h.cartText).toContain('-->8');
		expect(h.cartText).toContain('__pp_rec_update=_update');
		expect(h.cartText).toContain('extcmd("audio_rec")');
		expect(h.cartText).toContain('extcmd("audio_end",1)');
		expect(h.cartText).toContain(`printh("${DONE_SENTINEL}")`);
		expect(h.description).toBe('the running cart');
	});

	it('uses the default record window when none is given', () => {
		const h = buildRecordHarness(`${HEADER}__lua__\n`);
		expect(h.seconds).toBe(DEFAULT_RECORD_SECONDS);
	});

	it('refuses an unparseable cart', () => {
		try {
			buildRecordHarness('garbage');
			throw new Error('expected a refusal');
		} catch (e) {
			expect((e as HarnessError).code).toBe('audio-render-cart-parse-error');
		}
	});
});
