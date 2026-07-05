import {describe, expect, it} from 'vitest';

import {Cart} from '../cart/index.js';
import {mergeSfxRow} from './section.js';
import {mmlToSfxRow, SFX_ROW_LENGTH} from './sfx.js';

/** A minimal valid cart, optionally with an existing __sfx__ body + other sections. */
function cart(opts?: {sfx?: string; withGfx?: boolean}): Cart {
	let text =
		'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';
	if (opts?.withGfx) text += '__gfx__\n0000\n';
	if (opts?.sfx !== undefined) text += `__sfx__\n${opts.sfx}`;
	return Cart.parse(text);
}

const ROW = mmlToSfxRow('s8 @1 v6 c d e').row;
const EMPTY = '0'.repeat(SFX_ROW_LENGTH);

describe('mergeSfxRow: writes the target slot', () => {
	it('creates the __sfx__ section when absent and writes slot 0', () => {
		const c = cart();
		mergeSfxRow(c, 0, ROW);
		const body = c.getSection('sfx');
		expect(body).toBe(`${ROW}\n`);
	});

	it('pads intermediate slots with empty rows to reach a higher slot', () => {
		const c = cart();
		mergeSfxRow(c, 2, ROW);
		const lines = c.getSection('sfx')!.trimEnd().split('\n');
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe(EMPTY);
		expect(lines[1]).toBe(EMPTY);
		expect(lines[2]).toBe(ROW);
	});

	it('trims trailing empty rows (PICO-8 canonical form)', () => {
		// Author slot 0, then a slot-3 write, then clear slot 3 back to empty:
		const c = cart();
		mergeSfxRow(c, 0, ROW);
		mergeSfxRow(c, 3, ROW);
		expect(c.getSection('sfx')!.trimEnd().split('\n')).toHaveLength(4);
		mergeSfxRow(c, 3, EMPTY);
		// Slot 3 empty again -> trailing empties trimmed back to just slot 0.
		expect(c.getSection('sfx')).toBe(`${ROW}\n`);
	});
});

describe('mergeSfxRow: leaves every OTHER slot byte-identical', () => {
	it('replaces only the target slot, preserving siblings', () => {
		const rowA = mmlToSfxRow('@2 c').row;
		const rowB = mmlToSfxRow('@5 g').row;
		const c = cart({sfx: `${rowA}\n${EMPTY}\n${rowB}\n`});
		const newRow = mmlToSfxRow('@7 e').row;
		mergeSfxRow(c, 1, newRow);
		const lines = c.getSection('sfx')!.trimEnd().split('\n');
		expect(lines[0]).toBe(rowA); // untouched
		expect(lines[1]).toBe(newRow); // replaced
		expect(lines[2]).toBe(rowB); // untouched
	});
});

describe('mergeSfxRow: leaves every OTHER section byte-identical', () => {
	it('only __sfx__ changes; header + lua + gfx are preserved', () => {
		const c = cart({withGfx: true});
		const before = c.serialize();
		mergeSfxRow(c, 0, ROW);
		const after = c.serialize();
		// Everything up to __sfx__ is byte-identical.
		const cut = before.indexOf('__gfx__');
		expect(after.slice(0, before.length - (before.length - cut))).toBe(
			before.slice(0, cut),
		);
		expect(after).toContain('print("hi")');
		expect(after).toContain('__gfx__\n0000\n');
	});
});

describe('mergeSfxRow: input validation', () => {
	it('rejects an out-of-range slot', () => {
		expect(() => mergeSfxRow(cart(), 64, ROW)).toThrow(RangeError);
		expect(() => mergeSfxRow(cart(), -1, ROW)).toThrow(RangeError);
	});

	it('rejects a malformed row', () => {
		expect(() => mergeSfxRow(cart(), 0, 'abc')).toThrow(RangeError);
	});
});
