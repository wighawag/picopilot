/**
 * The `__label__` builder: turn a 128x128 image (or a PICO-8 screenshot, an
 * integer upscale of one) into the hex a `.p8` cart's
 * label section holds, so `picopilot export --label <png>` can give a labelless
 * cart a loading splash WITHOUT an interactive PICO-8 (F7) capture.
 *
 * A PICO-8 label is a 128x128 grid of palette indices (0..15), serialised as 128
 * rows of 128 hex nibbles. This module decodes a PNG to RGB (via Node's stdlib
 * `zlib` inflate, no npm dependency), maps each pixel to the NEAREST PICO-8
 * palette colour, and emits that hex. It is the inverse direction of the
 * palette-accurate PNG RENDER in `render.ts`/`png.ts` (which goes indices -> RGB).
 *
 * It accepts what a caller realistically hands it: a PICO-8 screenshot exactly as
 * `picopilot run`/`playtest` captured it (384x384 8-bit RGB by default; any
 * square integer multiple of 128 is sampled back down), or a 128x128 image from
 * any tool, including palette-indexed (1/2/4/8-bit, the form image tools write
 * when shrinking a screenshot) and greyscale PNGs. Interlaced PNGs, sizes that
 * are not a square multiple of 128, and malformed files are rejected, loud, with
 * a structured {@link LabelError}.
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

/** Samples per pixel for each PNG colour type we decode. */
const CHANNELS: Readonly<Record<number, number>> = {
	0: 1, // greyscale
	2: 3, // RGB
	3: 1, // palette index
	4: 2, // greyscale + alpha
	6: 4, // RGBA
};

/** The bit depths the PNG spec allows per colour type. */
const ALLOWED_DEPTHS: Readonly<Record<number, readonly number[]>> = {
	0: [1, 2, 4, 8, 16],
	2: [8, 16],
	3: [1, 2, 4, 8],
	4: [8, 16],
	6: [8, 16],
};

/**
 * Decodes a non-interlaced PNG of any standard colour type and bit depth to
 * RGBA: truecolour (2) and truecolour+alpha (6) at 8/16 bits, palette-indexed (3)
 * at 1/2/4/8 bits via its PLTE chunk, and greyscale (0) / greyscale+alpha (4).
 * Uses `node:zlib` inflate for the IDAT stream and applies the five PNG scanline
 * filters. `checkSize` runs on the IHDR dimensions before any pixel work. 16-bit samples keep their high byte (a label is quantised to 16
 * colours anyway). Interlaced (Adam7) PNGs are rejected: PICO-8 never writes them.
 * Throws {@link LabelError} for anything outside this set.
 */
function decodePng(
	bytes: Uint8Array,
	checkSize: (width: number, height: number) => void = () => {},
): DecodedPng {
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
	let palette: Uint8Array | undefined;
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
		} else if (type === 'PLTE') {
			palette = bytes.subarray(dataStart, dataEnd);
		} else if (type === 'IDAT') {
			idat.push(bytes.subarray(dataStart, dataEnd));
		} else if (type === 'IEND') {
			break;
		}
		off = dataEnd + 4; // skip the 4-byte CRC
	}

	const channels = CHANNELS[colourType];
	if (
		channels === undefined ||
		!ALLOWED_DEPTHS[colourType]!.includes(bitDepth) ||
		interlace !== 0
	) {
		throw new LabelError(
			'unsupported-png',
			`unsupported PNG: need a non-interlaced greyscale, RGB, RGBA or palette-indexed image (got bitDepth=${bitDepth}, colourType=${colourType}, interlace=${interlace})`,
		);
	}
	if (colourType === 3 && (palette === undefined || palette.length < 3)) {
		throw new LabelError(
			'unsupported-png',
			'palette-indexed PNG has no PLTE chunk',
		);
	}

	// Reject a wrong-sized image from its header alone, before inflating and
	// decoding pixels we would throw away.
	checkSize(width, height);

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

	const bitsPerPixel = channels * bitDepth;
	const stride = Math.ceil((width * bitsPerPixel) / 8);
	// Filter byte distance: bytes per complete pixel, at least 1 (sub-byte depths).
	const bpp = Math.max(1, bitsPerPixel >> 3);
	if (raw.length < height * (stride + 1)) {
		throw new LabelError(
			'truncated-png',
			`PNG image data too short for ${width}x${height}`,
		);
	}

	// Reads sample `i` (0-based within the scanline) scaled to 0..255.
	const maxSample = (1 << Math.min(bitDepth, 8)) - 1;
	const sampleAt = (line: Uint8Array, i: number): number => {
		if (bitDepth === 16) return line[i * 2]!;
		if (bitDepth === 8) return line[i]!;
		const bit = i * bitDepth;
		const v = (line[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & maxSample;
		return v;
	};
	// Palette indices must stay raw; greyscale samples are scaled to 0..255.
	const scaleGrey = (v: number): number =>
		bitDepth >= 8 ? v : Math.round((v * 255) / maxSample);

	const rgba = new Uint8Array(width * height * 4);
	let prev = new Uint8Array(stride);
	let line = new Uint8Array(stride);
	let src = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[src++]!;
		for (let x = 0; x < stride; x++) {
			const rawByte = raw[src++]!;
			const a = x >= bpp ? line[x - bpp]! : 0; // left
			const b = prev[x]!; // up
			const c = x >= bpp ? prev[x - bpp]! : 0; // up-left
			let val: number;
			switch (filter) {
				case 0:
					val = rawByte;
					break; // None
				case 1:
					val = rawByte + a;
					break; // Sub
				case 2:
					val = rawByte + b;
					break; // Up
				case 3:
					val = rawByte + ((a + b) >> 1);
					break; // Average
				case 4:
					val = rawByte + paeth(a, b, c);
					break; // Paeth
				default:
					throw new LabelError(
						'unsupported-png',
						`unsupported PNG scanline filter ${filter}`,
					);
			}
			line[x] = val & 0xff;
		}
		// Expand this decoded scanline into RGBA.
		for (let x = 0; x < width; x++) {
			const s = x * channels;
			const d = (y * width + x) * 4;
			if (colourType === 3) {
				const p = sampleAt(line, s) * 3;
				if (p + 2 >= palette!.length) {
					throw new LabelError(
						'unsupported-png',
						`palette index ${p / 3} is outside the PLTE chunk`,
					);
				}
				rgba[d] = palette![p]!;
				rgba[d + 1] = palette![p + 1]!;
				rgba[d + 2] = palette![p + 2]!;
				rgba[d + 3] = 255;
			} else if (colourType === 0 || colourType === 4) {
				const g = scaleGrey(sampleAt(line, s));
				rgba[d] = g;
				rgba[d + 1] = g;
				rgba[d + 2] = g;
				rgba[d + 3] = colourType === 4 ? sampleAt(line, s + 1) : 255;
			} else {
				rgba[d] = sampleAt(line, s);
				rgba[d + 1] = sampleAt(line, s + 1);
				rgba[d + 2] = sampleAt(line, s + 2);
				rgba[d + 3] = colourType === 6 ? sampleAt(line, s + 3) : 255;
			}
		}
		[prev, line] = [line, prev];
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
 * The integer scale of a PICO-8-shaped screenshot: `k` when the image is exactly
 * `(128*k)x(128*k)` (128x128 is `k = 1`), else `undefined`. PICO-8's
 * `extcmd("screen")` writes a pixel-exact upscale (3x by default, 384x384; the
 * factor follows its `screenshot_scale` config), so any square integer multiple
 * is a screenshot we can sample straight back down.
 */
function labelScale(width: number, height: number): number | undefined {
	if (width !== height || width < LABEL_SIZE || width % LABEL_SIZE !== 0) {
		return undefined;
	}
	return width / LABEL_SIZE;
}

/**
 * Builds the `__label__` hex body (128 rows of 128 nibbles, newline-joined, with
 * a trailing newline) from a PNG. Each pixel is mapped to its nearest PICO-8
 * palette colour. The PNG must be 128x128 ({@link LABEL_SIZE}) or an exact square
 * integer multiple of it (256x256, 384x384, ...: a PICO-8 screenshot), which is
 * downscaled by nearest-neighbour sampling (the centre of each `k x k` block).
 * Any other size is a {@link LabelError} (`wrong-size`) so a mis-sized image
 * fails loud instead of being silently cropped or stretched.
 */
export function labelHexFromPng(pngBytes: Uint8Array): string {
	const {width, height, rgba} = decodePng(pngBytes, (w, h) => {
		if (labelScale(w, h) === undefined) {
			throw new LabelError(
				'wrong-size',
				`label image must be ${LABEL_SIZE}x${LABEL_SIZE} or an exact multiple of it (256x256, 384x384, 512x512, ...), got ${w}x${h}`,
			);
		}
	});
	const scale = labelScale(width, height)!;
	const centre = scale >> 1;
	const rows: string[] = [];
	for (let y = 0; y < LABEL_SIZE; y++) {
		let row = '';
		const sy = y * scale + centre;
		for (let x = 0; x < LABEL_SIZE; x++) {
			const d = (sy * width + x * scale + centre) * 4;
			row += HEX[nearestPaletteIndex(rgba[d]!, rgba[d + 1]!, rgba[d + 2]!)];
		}
		rows.push(row);
	}
	return `${rows.join('\n')}\n`;
}
