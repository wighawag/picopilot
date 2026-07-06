/**
 * The `__label__` builder: turn a 128x128 image into the hex a `.p8` cart's
 * label section holds, so `picopilot export --label <png>` can give a labelless
 * cart a loading splash WITHOUT an interactive PICO-8 (F7) capture.
 *
 * A PICO-8 label is a 128x128 grid of palette indices (0..15), serialised as 128
 * rows of 128 hex nibbles. This module decodes a PNG to RGB (via Node's stdlib
 * `zlib` inflate, no npm dependency), maps each pixel to the NEAREST PICO-8
 * palette colour, and emits that hex. It is the inverse direction of the
 * palette-accurate PNG RENDER in `render.ts`/`png.ts` (which goes indices -> RGB).
 *
 * It intentionally supports only the PNG subset a caller realistically produces
 * for a 128x128 label: 8-bit, non-interlaced, colour types 2 (RGB) and 6 (RGBA),
 * and (via the palette map) 0/3 are rejected with a clear error rather than
 * guessed at. Anything else fails loud with a structured {@link LabelError}.
 */

import {inflateSync} from 'node:zlib';
import {PICO8_PALETTE} from './palette.js';

/** The fixed PICO-8 label dimensions: a 128x128 image. */
export const LABEL_SIZE = 128;

/** A structured label-build failure (bad PNG, wrong size, unsupported format). */
export class LabelError extends Error {
	constructor(
		readonly code:
			'not-a-png' | 'unsupported-png' | 'wrong-size' | 'truncated-png',
		message: string,
	) {
		super(message);
		this.name = 'LabelError';
	}
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface DecodedPng {
	readonly width: number;
	readonly height: number;
	/** Row-major RGBA, 4 bytes per pixel. */
	readonly rgba: Uint8Array;
}

/**
 * Decodes an 8-bit, non-interlaced PNG (colour type 2 RGB or 6 RGBA) to RGBA.
 * Uses `node:zlib` inflate for the IDAT stream and applies the five PNG scanline
 * filters. Throws {@link LabelError} for anything outside this subset.
 */
function decodePng(bytes: Uint8Array): DecodedPng {
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		if (bytes[i] !== PNG_SIGNATURE[i]) {
			throw new LabelError('not-a-png', 'not a PNG file (bad signature)');
		}
	}

	let off = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colourType = 0;
	let interlace = 0;
	const idat: Uint8Array[] = [];

	const readU32 = (p: number): number =>
		((bytes[p]! << 24) |
			(bytes[p + 1]! << 16) |
			(bytes[p + 2]! << 8) |
			bytes[p + 3]!) >>>
		0;

	while (off + 8 <= bytes.length) {
		const len = readU32(off);
		const type = String.fromCharCode(
			bytes[off + 4]!,
			bytes[off + 5]!,
			bytes[off + 6]!,
			bytes[off + 7]!,
		);
		const dataStart = off + 8;
		const dataEnd = dataStart + len;
		if (dataEnd + 4 > bytes.length) {
			throw new LabelError('truncated-png', 'PNG chunk runs past end of file');
		}
		if (type === 'IHDR') {
			width = readU32(dataStart);
			height = readU32(dataStart + 4);
			bitDepth = bytes[dataStart + 8]!;
			colourType = bytes[dataStart + 9]!;
			interlace = bytes[dataStart + 12]!;
		} else if (type === 'IDAT') {
			idat.push(bytes.subarray(dataStart, dataEnd));
		} else if (type === 'IEND') {
			break;
		}
		off = dataEnd + 4; // skip the 4-byte CRC
	}

	if (
		bitDepth !== 8 ||
		interlace !== 0 ||
		(colourType !== 2 && colourType !== 6)
	) {
		throw new LabelError(
			'unsupported-png',
			`unsupported PNG: need 8-bit non-interlaced RGB or RGBA (got bitDepth=${bitDepth}, colourType=${colourType}, interlace=${interlace})`,
		);
	}

	const channels = colourType === 6 ? 4 : 3;
	const compressed = Buffer.concat(idat.map((c) => Buffer.from(c)));
	let raw: Buffer;
	try {
		raw = inflateSync(compressed);
	} catch (e) {
		throw new LabelError(
			'truncated-png',
			`could not inflate PNG image data: ${(e as Error).message}`,
		);
	}

	const stride = width * channels;
	const rgba = new Uint8Array(width * height * 4);
	const prev = new Uint8Array(stride);
	let src = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[src++]!;
		const line = new Uint8Array(stride);
		for (let x = 0; x < stride; x++) {
			const rawByte = raw[src++]!;
			const a = x >= channels ? line[x - channels]! : 0; // left
			const b = prev[x]!; // up
			const c = x >= channels ? prev[x - channels]! : 0; // up-left
			let val = rawByte;
			switch (filter) {
				case 0:
					break; // None
				case 1:
					val = (rawByte + a) & 0xff;
					break; // Sub
				case 2:
					val = (rawByte + b) & 0xff;
					break; // Up
				case 3:
					val = (rawByte + ((a + b) >> 1)) & 0xff;
					break; // Average
				case 4:
					val = (rawByte + paeth(a, b, c)) & 0xff;
					break; // Paeth
				default:
					throw new LabelError(
						'unsupported-png',
						`unsupported PNG scanline filter ${filter}`,
					);
			}
			line[x] = val;
		}
		// Expand this decoded scanline into RGBA.
		for (let x = 0; x < width; x++) {
			const s = x * channels;
			const d = (y * width + x) * 4;
			rgba[d] = line[s]!;
			rgba[d + 1] = line[s + 1]!;
			rgba[d + 2] = line[s + 2]!;
			rgba[d + 3] = channels === 4 ? line[s + 3]! : 255;
		}
		prev.set(line);
	}

	return {width, height, rgba};
}

/** The PNG Paeth predictor. */
function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	if (pb <= pc) return b;
	return c;
}

/** The nearest PICO-8 palette index (by squared RGB distance) for an RGB triple. */
export function nearestPaletteIndex(r: number, g: number, b: number): number {
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < PICO8_PALETTE.length; i++) {
		const c = PICO8_PALETTE[i]!;
		const dr = r - c.r;
		const dg = g - c.g;
		const db = b - c.b;
		const dist = dr * dr + dg * dg + db * db;
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

const HEX = '0123456789abcdef';

/**
 * Builds the `__label__` hex body (128 rows of 128 nibbles, newline-joined, with
 * a trailing newline) from a 128x128 PNG. Each pixel is mapped to its nearest
 * PICO-8 palette colour. The PNG MUST be exactly 128x128 ({@link LABEL_SIZE});
 * anything else is a {@link LabelError} (`wrong-size`) so a mis-sized image fails
 * loud instead of being silently cropped or stretched.
 */
export function labelHexFromPng(pngBytes: Uint8Array): string {
	const {width, height, rgba} = decodePng(pngBytes);
	if (width !== LABEL_SIZE || height !== LABEL_SIZE) {
		throw new LabelError(
			'wrong-size',
			`label image must be ${LABEL_SIZE}x${LABEL_SIZE}, got ${width}x${height}`,
		);
	}
	const rows: string[] = [];
	for (let y = 0; y < LABEL_SIZE; y++) {
		let row = '';
		for (let x = 0; x < LABEL_SIZE; x++) {
			const d = (y * LABEL_SIZE + x) * 4;
			row += HEX[nearestPaletteIndex(rgba[d]!, rgba[d + 1]!, rgba[d + 2]!)];
		}
		rows.push(row);
	}
	return `${rows.join('\n')}\n`;
}
