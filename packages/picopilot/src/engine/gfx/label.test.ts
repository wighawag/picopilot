import {describe, expect, it} from 'vitest';
import {
	LABEL_SIZE,
	LabelError,
	labelHexFromPng,
	nearestPaletteIndex,
} from './label.js';
import {PICO8_PALETTE} from './palette.js';
import {encodePng, type RgbImage} from './png.js';

/**
 * The label builder is exercised against PNGs produced by our OWN encoder
 * (`encodePng`, RGB truecolour, stored-deflate), so the decode + nearest-palette
 * round-trip is verified end-to-end with no external fixtures. Node's `zlib`
 * inflate reads our stored blocks fine (a standard zlib stream).
 */

/** Build a solid-colour 128x128 RGB PNG from a PICO-8 palette index. */
function solidLabelPng(paletteIndex: number): Uint8Array {
	const c = PICO8_PALETTE[paletteIndex]!;
	const rgb = new Uint8Array(LABEL_SIZE * LABEL_SIZE * 3);
	for (let i = 0; i < LABEL_SIZE * LABEL_SIZE; i++) {
		rgb[i * 3] = c.r;
		rgb[i * 3 + 1] = c.g;
		rgb[i * 3 + 2] = c.b;
	}
	return encodePng({width: LABEL_SIZE, height: LABEL_SIZE, rgb});
}

describe('nearestPaletteIndex', () => {
	it('maps each exact palette RGB back to its own index', () => {
		for (let i = 0; i < PICO8_PALETTE.length; i++) {
			const c = PICO8_PALETTE[i]!;
			expect(nearestPaletteIndex(c.r, c.g, c.b)).toBe(i);
		}
	});

	it('snaps a near colour to the closest palette entry (pure black -> 0)', () => {
		expect(nearestPaletteIndex(3, 2, 1)).toBe(0);
		// Near PICO-8 red (255,0,77) -> index 8.
		expect(nearestPaletteIndex(250, 5, 80)).toBe(8);
	});
});

describe('labelHexFromPng', () => {
	it('produces 128 rows of 128 nibbles with a trailing newline', () => {
		const hex = labelHexFromPng(solidLabelPng(1));
		const rows = hex.split('\n');
		// 128 rows + a trailing empty from the final newline.
		expect(rows.length).toBe(LABEL_SIZE + 1);
		expect(rows[LABEL_SIZE]).toBe('');
		for (let y = 0; y < LABEL_SIZE; y++) {
			expect(rows[y]!.length).toBe(LABEL_SIZE);
		}
	});

	it('maps a solid palette colour to that nibble everywhere (index 1 -> all "1")', () => {
		const hex = labelHexFromPng(solidLabelPng(1));
		const firstRow = hex.split('\n')[0]!;
		expect(firstRow).toBe('1'.repeat(LABEL_SIZE));
	});

	it('round-trips an arbitrary palette index (e.g. 10 -> "a")', () => {
		const hex = labelHexFromPng(solidLabelPng(10));
		expect(hex.split('\n')[0]!).toBe('a'.repeat(LABEL_SIZE));
	});

	it('preserves per-pixel colours (a two-colour split image)', () => {
		// Left half index 8 (red -> "8"), right half index 12 (blue -> "c").
		const left = PICO8_PALETTE[8]!;
		const right = PICO8_PALETTE[12]!;
		const rgb = new Uint8Array(LABEL_SIZE * LABEL_SIZE * 3);
		for (let y = 0; y < LABEL_SIZE; y++) {
			for (let x = 0; x < LABEL_SIZE; x++) {
				const c = x < LABEL_SIZE / 2 ? left : right;
				const d = (y * LABEL_SIZE + x) * 3;
				rgb[d] = c.r;
				rgb[d + 1] = c.g;
				rgb[d + 2] = c.b;
			}
		}
		const png = encodePng({width: LABEL_SIZE, height: LABEL_SIZE, rgb});
		const row = labelHexFromPng(png).split('\n')[0]!;
		expect(row.slice(0, LABEL_SIZE / 2)).toBe('8'.repeat(LABEL_SIZE / 2));
		expect(row.slice(LABEL_SIZE / 2)).toBe('c'.repeat(LABEL_SIZE / 2));
	});

	it('rejects a non-PNG with a structured LabelError', () => {
		expect(() => labelHexFromPng(new Uint8Array([1, 2, 3, 4]))).toThrowError(
			LabelError,
		);
	});

	it('rejects a wrong-size image (must be exactly 128x128)', () => {
		const rgb = new Uint8Array(64 * 64 * 3);
		const png = encodePng({width: 64, height: 64, rgb} as RgbImage);
		try {
			labelHexFromPng(png);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(LabelError);
			expect((e as LabelError).code).toBe('wrong-size');
		}
	});
});
