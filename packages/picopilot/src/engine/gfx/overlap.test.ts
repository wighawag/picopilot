import {describe, expect, it} from 'vitest';

import {GfxSheet} from '../cart/index.js';
import {decideOverlap, spriteHasData} from './overlap.js';

/** A GfxSheet whose sprite `n` is painted non-zero (data at risk in the shared bank). */
function sheetWithSpriteData(n: number): GfxSheet {
	const sheet = GfxSheet.fromBody(undefined);
	// A single non-zero pixel is enough to mean "the shared region holds data".
	sheet.setPixel(...spritePixel(n), 8);
	return sheet;
}

/** A pixel coordinate inside sprite `n` (its top-left corner). */
function spritePixel(n: number): [number, number] {
	const x0 = (n % 16) * 8;
	const y0 = Math.floor(n / 16) * 8;
	return [x0, y0];
}

describe('gfx overlap: spriteHasData reads the target sprite own __gfx__ pixels', () => {
	it('is false for an all-zero sprite', () => {
		const sheet = GfxSheet.fromBody(undefined);
		expect(spriteHasData(sheet, 200)).toBe(false);
	});
	it('is true once any pixel is non-zero', () => {
		const sheet = sheetWithSpriteData(200);
		expect(spriteHasData(sheet, 200)).toBe(true);
	});
});

describe('gfx overlap: decideOverlap branches (ADR-0004 smart-refuse)', () => {
	it('a base-bank sprite (0..127) is always allowed (no overlap possible)', () => {
		const sheet = sheetWithSpriteData(10);
		// Even with data present, a base-bank sprite aliases nothing.
		expect(decideOverlap(sheet, 10, false)).toEqual({kind: 'allowed'});
	});

	it('a shared-bank sprite with all-zero pixels is allowed-shared (empty)', () => {
		const sheet = GfxSheet.fromBody(undefined);
		expect(decideOverlap(sheet, 130, false)).toEqual({
			kind: 'allowed-shared',
			reason: 'empty',
		});
	});

	it('a shared-bank sprite with data + authorised is allowed-shared (authorised)', () => {
		const sheet = sheetWithSpriteData(130);
		expect(decideOverlap(sheet, 130, true)).toEqual({
			kind: 'allowed-shared',
			reason: 'authorised',
		});
	});

	it('a shared-bank sprite with data + NOT authorised is refused (the data-loss corner)', () => {
		const sheet = sheetWithSpriteData(130);
		const decision = decideOverlap(sheet, 130, false);
		expect(decision.kind).toBe('refused');
		if (decision.kind === 'refused') expect(decision.nonZeroPixels).toBe(1);
	});

	it('sprite 128 (first shared) and 255 (last) both alias the shared bank', () => {
		for (const n of [128, 255]) {
			const sheet = sheetWithSpriteData(n);
			expect(decideOverlap(sheet, n, false).kind).toBe('refused');
		}
		// 127 (last base) does NOT.
		const base = sheetWithSpriteData(127);
		expect(decideOverlap(base, 127, false).kind).toBe('allowed');
	});
});
