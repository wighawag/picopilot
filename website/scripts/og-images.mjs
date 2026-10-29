#!/usr/bin/env node
/**
 * Post-build step: write a link-preview image (`og.png`, 512x512) next to every
 * showcased game's `label.png` in `build/games/**`.
 *
 * PICO-8 labels are usually 128x128, too small for link previews (Facebook wants
 * at least 200px, X/Twitter 144px), so each is scaled up by an integer factor with
 * nearest-neighbour sampling (the smallest factor reaching 512px): the pixel art
 * stays crisp. Labels that are already 512 or larger are copied as-is. Zero dependencies (node:zlib only); the output
 * lives in build/, never in the source tree.
 */
import {readFile, writeFile, readdir, copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const TARGET = 512;
const buildGames = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../build/games',
);

function decodePng(buf) {
	let pos = 8;
	let width, height, bitDepth, colorType, interlace;
	let palette = null;
	const idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString('latin1', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		pos += 12 + len;
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === 'PLTE') palette = data;
		else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
	}
	if (bitDepth !== 8 || interlace !== 0) {
		throw new Error(
			`unsupported PNG (bit depth ${bitDepth}, interlace ${interlace})`,
		);
	}
	const bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colorType];
	if (!bpp) throw new Error(`unsupported PNG color type ${colorType}`);
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const stride = width * bpp;
	const rgb = Buffer.alloc(width * height * 3);
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = Buffer.from(
			raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
		);
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? line[x - bpp] : 0;
			const b = prev[x];
			const c = x >= bpp ? prev[x - bpp] : 0;
			let p = 0;
			if (filter === 1) p = a;
			else if (filter === 2) p = b;
			else if (filter === 3) p = (a + b) >> 1;
			else if (filter === 4) {
				const pa = Math.abs(b - c);
				const pb = Math.abs(a - c);
				const pc = Math.abs(a + b - 2 * c);
				p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			line[x] = (line[x] + p) & 255;
		}
		prev = line;
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 3;
			if (colorType === 3) {
				palette.copy(rgb, o, line[x] * 3, line[x] * 3 + 3);
			} else if (colorType === 0 || colorType === 4) {
				rgb[o] = rgb[o + 1] = rgb[o + 2] = line[x * bpp];
			} else {
				line.copy(rgb, o, x * bpp, x * bpp + 3);
			}
		}
	}
	return {width, height, rgb};
}

const crcTable = Array.from({length: 256}, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}
function encodePng(width, height, rgb) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const raw = Buffer.alloc(height * (width * 3 + 1));
	for (let y = 0; y < height; y++) {
		rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, {level: 9})),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function upscale({width, height, rgb}, k) {
	const w = width * k;
	const h = height * k;
	const out = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			rgb.copy(
				out,
				(y * w + x) * 3,
				(((y / k) | 0) * width + ((x / k) | 0)) * 3,
				(((y / k) | 0) * width + ((x / k) | 0)) * 3 + 3,
			);
		}
	}
	return {width: w, height: h, rgb: out};
}

async function* labels(dir) {
	for (const entry of await readdir(dir, {withFileTypes: true})) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) yield* labels(p);
		else if (entry.name === 'label.png') yield p;
	}
}

if (!existsSync(buildGames)) {
	console.log('[og] no build/games folder, nothing to do');
	process.exit(0);
}
let n = 0;
for await (const label of labels(buildGames)) {
	const out = join(dirname(label), 'og.png');
	const img = decodePng(await readFile(label));
	if (img.width >= TARGET) {
		await copyFile(label, out);
	} else {
		const k = Math.ceil(TARGET / img.width);
		const big = upscale(img, k);
		await writeFile(out, encodePng(big.width, big.height, big.rgb));
	}
	n++;
}
console.log(`[og] wrote ${n} preview image(s)`);
