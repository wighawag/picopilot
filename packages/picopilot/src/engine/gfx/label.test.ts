import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
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

/**
 * A test-only general PNG encoder (any colour type / bit depth incl. 16, optional
 * PLTE, any of the five scanline filters) so the decoder is exercised on formats
 * our production `encodePng` never emits: palette-indexed (what an image tool
 * writes when it shrinks a PICO-8 screenshot), greyscale, 16-bit, and the
 * previous-row filters. `samples` holds one value per channel per pixel,
 * row-major, already at `bitDepth` range. Written from the PNG spec
 * independently of the decoder: the filter distance is `ceil(bits/8)` per the
 * spec's wording, and the IDAT is zlib-compressed by Node.
 */
function encodeTestPng(opts: {
	width: number;
	height: number;
	colourType: 0 | 2 | 3 | 4 | 6;
	bitDepth: 1 | 2 | 4 | 8 | 16;
	samples: ArrayLike<number>;
	palette?: ReadonlyArray<{r: number; g: number; b: number}>;
	/** Scanline filter applied to every row: 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth. */
	filter?: 0 | 1 | 2 | 3 | 4;
}): Uint8Array {
	const {width, height, colourType, bitDepth, samples} = opts;
	const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colourType];
	const bitsPerPixel = channels * bitDepth;
	const stride = Math.ceil((width * bitsPerPixel) / 8);
	const bpp = Math.ceil(bitsPerPixel / 8);
	const filter = opts.filter ?? 0;
	const raw = new Uint8Array(height * (stride + 1));
	let prev = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const line = new Uint8Array(stride);
		for (let x = 0; x < width * channels; x++) {
			const v = samples[y * width * channels + x]!;
			if (bitDepth === 16) {
				line[x * 2] = v >> 8;
				line[x * 2 + 1] = v & 0xff;
				continue;
			}
			const bit = x * bitDepth;
			line[bit >> 3]! |= v << (8 - bitDepth - (bit & 7));
		}
		const row = y * (stride + 1);
		raw[row] = filter;
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? line[i - bpp]! : 0;
			const b = prev[i]!;
			const c = i >= bpp ? prev[i - bpp]! : 0;
			const predictor = [
				0,
				a,
				b,
				(a + b) >> 1,
				(() => {
					const p = a + b - c;
					const pa = Math.abs(p - a);
					const pb = Math.abs(p - b);
					const pc = Math.abs(p - c);
					return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
				})(),
			][filter]!;
			raw[row + 1 + i] = (line[i]! - predictor) & 0xff;
		}
		prev = line;
	}
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = bitDepth;
	ihdr[9] = colourType;
	const parts: Uint8Array[] = [
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		testChunk('IHDR', ihdr),
	];
	if (opts.palette) {
		const plte = new Uint8Array(opts.palette.length * 3);
		opts.palette.forEach((c, i) => plte.set([c.r, c.g, c.b], i * 3));
		parts.push(testChunk('PLTE', plte));
	}
	parts.push(testChunk('IDAT', deflateSync(raw)));
	parts.push(testChunk('IEND', new Uint8Array(0)));
	return Uint8Array.from(Buffer.concat(parts));
}

function testChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	let crc = 0xffffffff;
	for (const byte of out.subarray(4, 8 + data.length)) {
		crc ^= byte;
		for (let k = 0; k < 8; k++)
			crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
	return out;
}

/** The {@link LabelError} code `fn` throws (fails the test if it throws anything else or nothing). */
function labelErrorCode(fn: () => unknown): string {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(LabelError);
		return (e as LabelError).code;
	}
	return expect.unreachable('should have thrown a LabelError');
}

/** The palette index at label pixel (x, y) in a `__label__` hex body. */
function labelAt(hex: string, x: number, y: number): number {
	return parseInt(hex.split('\n')[y]![x]!, 16);
}

/** A 128x128 pattern of PICO-8 indices: index = (x + 3y) mod 16 (every colour, varied neighbours). */
const patternIndex = (x: number, y: number): number => (x + 3 * y) % 16;

/** Expected label hex for {@link patternIndex}. */
function patternHex(): string {
	const rows: string[] = [];
	for (let y = 0; y < LABEL_SIZE; y++) {
		let row = '';
		for (let x = 0; x < LABEL_SIZE; x++) row += patternIndex(x, y).toString(16);
		rows.push(row);
	}
	return `${rows.join('\n')}\n`;
}

/** An RGB PNG of {@link patternIndex} upscaled by an integer `scale` (a PICO-8 screenshot shape). */
function upscaledPatternPng(scale: number): Uint8Array {
	const size = LABEL_SIZE * scale;
	const rgb = new Uint8Array(size * size * 3);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const c =
				PICO8_PALETTE[
					patternIndex(Math.floor(x / scale), Math.floor(y / scale))
				]!;
			rgb.set([c.r, c.g, c.b], (y * size + x) * 3);
		}
	}
	return encodePng({width: size, height: size, rgb});
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

	it('rejects a wrong-size image (smaller than 128x128)', () => {
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

describe('labelHexFromPng: palette-indexed and greyscale PNGs', () => {
	it('decodes a 4-bit palette-indexed PNG (colour type 3, PLTE = PICO-8 palette)', () => {
		const samples = new Uint8Array(LABEL_SIZE * LABEL_SIZE);
		for (let y = 0; y < LABEL_SIZE; y++) {
			for (let x = 0; x < LABEL_SIZE; x++)
				samples[y * LABEL_SIZE + x] = patternIndex(x, y);
		}
		const png = encodeTestPng({
			width: LABEL_SIZE,
			height: LABEL_SIZE,
			colourType: 3,
			bitDepth: 4,
			samples,
			palette: PICO8_PALETTE,
		});
		expect(labelHexFromPng(png)).toBe(patternHex());
	});

	it('maps PLTE entries, not raw indices (a shuffled 4-bit palette, Sub-filtered rows)', () => {
		// PLTE slot i holds PICO-8 colour (15 - i): the decoder must look colours
		// up through PLTE rather than treating the stored index as a PICO-8 index.
		const reversed = [...PICO8_PALETTE].reverse();
		const samples = new Uint8Array(LABEL_SIZE * LABEL_SIZE);
		for (let y = 0; y < LABEL_SIZE; y++) {
			for (let x = 0; x < LABEL_SIZE; x++)
				samples[y * LABEL_SIZE + x] = 15 - patternIndex(x, y);
		}
		const png = encodeTestPng({
			width: LABEL_SIZE,
			height: LABEL_SIZE,
			colourType: 3,
			bitDepth: 4,
			samples,
			palette: reversed,
			filter: 1,
		});
		expect(labelHexFromPng(png)).toBe(patternHex());
	});

	it.each([1, 2, 8] as const)(
		'decodes a %i-bit palette-indexed PNG',
		(bitDepth) => {
			const colours = Math.min(16, 1 << bitDepth);
			const samples = new Uint8Array(LABEL_SIZE * LABEL_SIZE);
			for (let y = 0; y < LABEL_SIZE; y++) {
				for (let x = 0; x < LABEL_SIZE; x++)
					samples[y * LABEL_SIZE + x] = (x + y) % colours;
			}
			const png = encodeTestPng({
				width: LABEL_SIZE,
				height: LABEL_SIZE,
				colourType: 3,
				bitDepth,
				samples,
				palette: PICO8_PALETTE.slice(0, colours),
				filter: 1,
			});
			const hex = labelHexFromPng(png);
			for (const [x, y] of [
				[0, 0],
				[1, 0],
				[5, 9],
				[127, 127],
				[126, 3],
			] as const) {
				expect(labelAt(hex, x, y)).toBe((x + y) % colours);
			}
		},
	);

	it.each([
		[1, 2],
		[1, 3],
		[1, 4],
		[4, 2],
		[4, 3],
		[4, 4],
	] as const)(
		'decodes a %i-bit indexed PNG under previous-row filter %i (Up/Average/Paeth)',
		(bitDepth, filter) => {
			const colours = 1 << Math.min(bitDepth, 4);
			const samples = new Uint8Array(LABEL_SIZE * LABEL_SIZE);
			for (let y = 0; y < LABEL_SIZE; y++) {
				for (let x = 0; x < LABEL_SIZE; x++) {
					samples[y * LABEL_SIZE + x] = patternIndex(x, y) % colours;
				}
			}
			const png = encodeTestPng({
				width: LABEL_SIZE,
				height: LABEL_SIZE,
				colourType: 3,
				bitDepth,
				samples,
				palette: PICO8_PALETTE.slice(0, colours),
				filter,
			});
			const hex = labelHexFromPng(png);
			for (let y = 0; y < LABEL_SIZE; y += 7) {
				for (let x = 0; x < LABEL_SIZE; x += 5) {
					expect(labelAt(hex, x, y)).toBe(patternIndex(x, y) % colours);
				}
			}
		},
	);

	it('decodes a 16-bit RGB PNG (Paeth-filtered) by its high bytes', () => {
		const samples = new Uint16Array(LABEL_SIZE * LABEL_SIZE * 3);
		for (let y = 0; y < LABEL_SIZE; y++) {
			for (let x = 0; x < LABEL_SIZE; x++) {
				const c = PICO8_PALETTE[patternIndex(x, y)]!;
				const d = (y * LABEL_SIZE + x) * 3;
				// High byte = the colour; a noisy low byte must not matter.
				samples[d] = (c.r << 8) | (x & 0xff);
				samples[d + 1] = (c.g << 8) | (y & 0xff);
				samples[d + 2] = (c.b << 8) | 0x7f;
			}
		}
		const png = encodeTestPng({
			width: LABEL_SIZE,
			height: LABEL_SIZE,
			colourType: 2,
			bitDepth: 16,
			samples,
			filter: 4,
		});
		expect(labelHexFromPng(png)).toBe(patternHex());
	});

	it('scales 2-bit greyscale to 0..255 (0 -> black 0, 3 -> white 7)', () => {
		const samples = new Uint8Array(LABEL_SIZE * LABEL_SIZE);
		for (let i = 0; i < samples.length; i++) {
			samples[i] = i % LABEL_SIZE < 64 ? 0 : 3;
		}
		const hex = labelHexFromPng(
			encodeTestPng({
				width: LABEL_SIZE,
				height: LABEL_SIZE,
				colourType: 0,
				bitDepth: 2,
				samples,
				filter: 3,
			}),
		);
		expect(labelAt(hex, 5, 60)).toBe(0);
		expect(labelAt(hex, 120, 60)).toBe(7);
	});

	it('rejects a palette index past the end of PLTE as unsupported-png', () => {
		const samples = new Uint8Array(LABEL_SIZE * LABEL_SIZE).fill(5);
		const png = encodeTestPng({
			width: LABEL_SIZE,
			height: LABEL_SIZE,
			colourType: 3,
			bitDepth: 4,
			samples,
			palette: PICO8_PALETTE.slice(0, 2),
		});
		expect(labelErrorCode(() => labelHexFromPng(png))).toBe('unsupported-png');
	});

	it('rejects truncated image data as truncated-png', () => {
		// Image data for only the first 10 rows of a 128-row image.
		const raw = new Uint8Array(10 * (LABEL_SIZE * 3 + 1));
		const ihdr = new Uint8Array(13);
		new DataView(ihdr.buffer).setUint32(0, LABEL_SIZE);
		new DataView(ihdr.buffer).setUint32(4, LABEL_SIZE);
		ihdr[8] = 8;
		ihdr[9] = 2;
		const png = Uint8Array.from(
			Buffer.concat([
				Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				testChunk('IHDR', ihdr),
				testChunk('IDAT', deflateSync(raw)),
				testChunk('IEND', new Uint8Array(0)),
			]),
		);
		expect(labelErrorCode(() => labelHexFromPng(png))).toBe('truncated-png');
	});

	it('rejects an indexed PNG with no PLTE chunk', () => {
		const png = encodeTestPng({
			width: LABEL_SIZE,
			height: LABEL_SIZE,
			colourType: 3,
			bitDepth: 4,
			samples: new Uint8Array(LABEL_SIZE * LABEL_SIZE),
		});
		expect(labelErrorCode(() => labelHexFromPng(png))).toBe('unsupported-png');
	});

	it('decodes greyscale (colour type 0) and grey+alpha (type 4): black -> 0, white -> 7', () => {
		const size = LABEL_SIZE * LABEL_SIZE;
		const grey = new Uint8Array(size);
		for (let i = 0; i < size; i++) grey[i] = i % LABEL_SIZE < 64 ? 0 : 1;
		const g1 = labelHexFromPng(
			encodeTestPng({
				width: LABEL_SIZE,
				height: LABEL_SIZE,
				colourType: 0,
				bitDepth: 1,
				samples: grey,
			}),
		);
		expect(labelAt(g1, 0, 0)).toBe(0);
		expect(labelAt(g1, 127, 0)).toBe(7);

		const ga = new Uint8Array(size * 2);
		for (let i = 0; i < size; i++) {
			ga[i * 2] = i % LABEL_SIZE < 64 ? 0 : 255;
			ga[i * 2 + 1] = 255;
		}
		const g8 = labelHexFromPng(
			encodeTestPng({
				width: LABEL_SIZE,
				height: LABEL_SIZE,
				colourType: 4,
				bitDepth: 8,
				samples: ga,
				filter: 1,
			}),
		);
		expect(labelAt(g8, 10, 50)).toBe(0);
		expect(labelAt(g8, 100, 50)).toBe(7);
	});
});

describe('labelHexFromPng: integer-multiple screenshots are downscaled', () => {
	it('downscales a 384x384 (3x) image by nearest-neighbour to the exact 128x128 label', () => {
		const hex = labelHexFromPng(upscaledPatternPng(3));
		expect(labelAt(hex, 0, 0)).toBe(patternIndex(0, 0));
		expect(labelAt(hex, 1, 0)).toBe(patternIndex(1, 0));
		expect(labelAt(hex, 0, 1)).toBe(patternIndex(0, 1));
		expect(labelAt(hex, 64, 37)).toBe(patternIndex(64, 37));
		expect(labelAt(hex, 127, 127)).toBe(patternIndex(127, 127));
		expect(hex).toBe(patternHex());
	});

	it('samples the CENTRE of each 3x3 block (only pixel (1,1) carries the colour)', () => {
		const size = LABEL_SIZE * 3;
		const rgb = new Uint8Array(size * size * 3); // all black (index 0) ...
		for (let y = 0; y < LABEL_SIZE; y++) {
			for (let x = 0; x < LABEL_SIZE; x++) {
				// ... except each block's centre, which holds the pattern colour.
				const c = PICO8_PALETTE[patternIndex(x, y)]!;
				rgb.set([c.r, c.g, c.b], ((y * 3 + 1) * size + x * 3 + 1) * 3);
			}
		}
		const png = encodePng({width: size, height: size, rgb});
		expect(labelHexFromPng(png)).toBe(patternHex());
	});

	it.each([2, 4])('downscales a %ix multiple too', (scale) => {
		expect(labelHexFromPng(upscaledPatternPng(scale))).toBe(patternHex());
	});

	it('decodes a REAL PICO-8 0.2.7 `extcmd("screen")` capture (384x384) straight to a label', () => {
		// Captured via `picopilot run` from a cart that draws: cls(1); red (8) top-left
		// quadrant; blue (12) bottom-right quadrant; pset(0,127,7); pset(127,0,10).
		const png = readFileSync(
			new URL('./fixtures/pico8-screenshot-384.png', import.meta.url),
		);
		const hex = labelHexFromPng(png);
		expect(labelAt(hex, 10, 10)).toBe(8);
		expect(labelAt(hex, 63, 63)).toBe(8);
		expect(labelAt(hex, 64, 64)).toBe(12);
		expect(labelAt(hex, 100, 20)).toBe(1);
		expect(labelAt(hex, 20, 100)).toBe(1);
		expect(labelAt(hex, 0, 127)).toBe(7);
		expect(labelAt(hex, 127, 0)).toBe(10);
	});

	it('still rejects a 200x200 image (not an integer multiple), naming the accepted sizes', () => {
		const png = encodePng({
			width: 200,
			height: 200,
			rgb: new Uint8Array(200 * 200 * 3),
		});
		try {
			labelHexFromPng(png);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(LabelError);
			expect((e as LabelError).code).toBe('wrong-size');
			const msg = (e as LabelError).message;
			expect(msg).toContain('200x200');
			expect(msg).toContain('128x128');
			expect(msg).toContain('384x384');
		}
	});

	it('rejects a mis-sized image from its header alone, before decoding pixels', () => {
		// A 4000x4000 header with NO real image data: if the size were checked only
		// after decoding, this would surface as truncated-png instead.
		const ihdr = new Uint8Array(13);
		new DataView(ihdr.buffer).setUint32(0, 4000);
		new DataView(ihdr.buffer).setUint32(4, 4000);
		ihdr[8] = 8;
		ihdr[9] = 2;
		const png = Uint8Array.from(
			Buffer.concat([
				Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				testChunk('IHDR', ihdr),
				testChunk('IDAT', deflateSync(new Uint8Array(1))),
				testChunk('IEND', new Uint8Array(0)),
			]),
		);
		expect(labelErrorCode(() => labelHexFromPng(png))).toBe('wrong-size');
	});

	it('rejects a non-square multiple (256x384)', () => {
		const png = encodePng({
			width: 256,
			height: 384,
			rgb: new Uint8Array(256 * 384 * 3),
		});
		expect(() => labelHexFromPng(png)).toThrowError(/must be/);
	});
});
