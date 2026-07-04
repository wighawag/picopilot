import {inflateSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';

import {encodePng, type RgbImage} from './png.js';

/**
 * Decodes the PNG structure enough to recover the raw RGB pixels, so the tests
 * assert against a REAL PNG round-trip (not the encoder's own internals). Uses
 * node's `zlib.inflateSync` as an INDEPENDENT decompressor: it must accept the
 * hand-rolled stored-block zlib stream, proving the file is standards-valid.
 */
function decodePng(bytes: Uint8Array): RgbImage {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < sig.length; i++) {
		expect(bytes[i]).toBe(sig[i]);
	}

	let off = 8;
	let width = 0;
	let height = 0;
	const idatParts: Uint8Array[] = [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	while (off < bytes.length) {
		const len = view.getUint32(off);
		const type = String.fromCharCode(
			bytes[off + 4]!,
			bytes[off + 5]!,
			bytes[off + 6]!,
			bytes[off + 7]!,
		);
		const data = bytes.subarray(off + 8, off + 8 + len);
		if (type === 'IHDR') {
			const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
			width = dv.getUint32(0);
			height = dv.getUint32(4);
			expect(data[8]).toBe(8); // bit depth
			expect(data[9]).toBe(2); // colour type RGB
		} else if (type === 'IDAT') {
			idatParts.push(data);
		}
		off += 12 + len; // length(4) + type(4) + data + crc(4)
		if (type === 'IEND') break;
	}

	const idat = Buffer.concat(idatParts.map((p) => Buffer.from(p)));
	const raw = new Uint8Array(inflateSync(idat));

	// Strip the per-scanline filter byte (all filter type 0 = None).
	const stride = width * 3;
	const rgb = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		expect(raw[y * (stride + 1)]).toBe(0); // filter None
		rgb.set(
			raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride),
			y * stride,
		);
	}
	return {width, height, rgb};
}

function pixelAt(
	img: RgbImage,
	x: number,
	y: number,
): [number, number, number] {
	const off = (y * img.width + x) * 3;
	return [img.rgb[off]!, img.rgb[off + 1]!, img.rgb[off + 2]!];
}

describe('png encoder', () => {
	it('encodes a 2x2 RGB image that a standard inflate decoder reads back exactly', () => {
		const rgb = Uint8Array.from([
			255, 0, 0, /* red   */ 0, 255, 0 /* green */, 0, 0, 255, /* blue  */ 255,
			255, 255 /* white */,
		]);
		const png = encodePng({width: 2, height: 2, rgb});
		const decoded = decodePng(png);
		expect(decoded.width).toBe(2);
		expect(decoded.height).toBe(2);
		expect(pixelAt(decoded, 0, 0)).toEqual([255, 0, 0]);
		expect(pixelAt(decoded, 1, 0)).toEqual([0, 255, 0]);
		expect(pixelAt(decoded, 0, 1)).toEqual([0, 0, 255]);
		expect(pixelAt(decoded, 1, 1)).toEqual([255, 255, 255]);
		expect(Array.from(decoded.rgb)).toEqual(Array.from(rgb));
	});

	it('is deterministic: the same input yields byte-identical output', () => {
		const rgb = Uint8Array.from([1, 2, 3, 4, 5, 6]);
		const a = encodePng({width: 2, height: 1, rgb});
		const b = encodePng({width: 2, height: 1, rgb});
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('handles a buffer larger than one stored block (>65535 bytes)', () => {
		// 200x200 RGB = 120000 bytes of pixels + filter bytes > 65535 → 2+ blocks.
		const width = 200;
		const height = 200;
		const rgb = new Uint8Array(width * height * 3);
		for (let i = 0; i < rgb.length; i++) rgb[i] = i % 256;
		const png = encodePng({width, height, rgb});
		const decoded = decodePng(png);
		expect(Array.from(decoded.rgb)).toEqual(Array.from(rgb));
	});

	it('rejects a mismatched buffer length', () => {
		expect(() =>
			encodePng({width: 2, height: 2, rgb: new Uint8Array(3)}),
		).toThrow();
	});
});
