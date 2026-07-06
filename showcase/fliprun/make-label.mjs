// Draws FLIPRUN's 128x128 label as a PNG for `picopilot export --label`.
//
// The cart was a headless jam build with no captured __label__, and PICO-8's
// HTML export needs one for the loading splash. Capturing a real one needs an
// interactive PICO-8 (F7); this instead DRAWS an on-theme label (floor/ceiling
// bands, the gravity runner, spikes, an orb, the FLIPRUN wordmark) in the game's
// palette and writes it as a 128x128 PNG that `export --label` bakes in.
//
// Run: node showcase/fliprun/make-label.mjs   (writes label.png next to this file)
// Then: picopilot export showcase/fliprun/main.p8 website/static/games/fliprun/ \
//         --label showcase/fliprun/label.png

import {writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	encodePng,
	PICO8_PALETTE,
} from '../../packages/picopilot/dist/engine/gfx/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'label.png');

const W = 128;
const H = 128;
// A 128x128 grid of PICO-8 colour indices, default dark-blue (the game's cls(1)).
const px = Array.from({length: H}, () => new Array(W).fill(1));

const set = (x, y, c) => {
	x |= 0;
	y |= 0;
	if (x >= 0 && x < W && y >= 0 && y < H) px[y][x] = c;
};
const rectfill = (x0, y0, x1, y1, c) => {
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
};
const circfill = (cx, cy, r, c) => {
	for (let y = -r; y <= r; y++)
		for (let x = -r; x <= r; x++)
			if (x * x + y * y <= r * r) set(cx + x, cy + y, c);
};

// parallax star dots
for (let i = 0; i < 40; i++) set((i * 23) % W, (i * 17) % 96, 5);

// floor & ceiling bands (dark-green with a light-grey edge line)
const FLR = 100;
const CEIL = 20;
rectfill(0, FLR, W - 1, H - 1, 3);
rectfill(0, FLR, W - 1, FLR, 11);
rectfill(0, 0, W - 1, CEIL, 3);
rectfill(0, CEIL, W - 1, CEIL, 11);

// spikes (red triangles, bright tip)
const drawSpike = (sx, base, dir) => {
	for (let k = 0; k <= 16; k++) {
		const w = 9 - ((k * 0.55) | 0);
		if (w < 0) continue;
		rectfill(sx - w, base + dir * k, sx + w, base + dir * k, 8);
	}
	set(sx, base + dir * 16, 10);
	set(sx, base + dir * 15, 10);
};
drawSpike(92, FLR, -1);
drawSpike(40, CEIL, 1);

// an orb (yellow, white pip)
circfill(66, FLR - 6, 3, 10);
set(66, FLR - 6, 7);

// the runner (pink = ceiling gravity, eyes up), with an arrow trail
const PX = 30;
const PY = 58;
circfill(PX, PY, 5, 14);
rectfill(PX - 4, PY - 5, PX + 4, PY + 5, 14);
set(PX + 1, PY - 2, 7);
set(PX - 2, PY - 2, 7);
set(PX - 8, PY, 6);
set(PX - 11, PY, 5);

// FLIPRUN wordmark, a compact 5x7 bitmap font drawn as 2x2 blocks
const FONT = {
	F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
	L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
	I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
	P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
	R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
	U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
	N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
	O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
	B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
	T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
	E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};
const textWidthSmall = (t) => t.length * 6 - 1;
const drawSmall = (t, x0, y0, c) => {
	let x = x0;
	for (const ch of t) {
		const g = FONT[ch];
		if (g)
			for (let ry = 0; ry < 7; ry++)
				for (let rx = 0; rx < 5; rx++) if (g[ry][rx] === '#') set(x + rx, y0 + ry, c);
		x += 6;
	}
};
const drawBig = (t, cx, y0, c, shadow) => {
	const wpx = t.length * 12 - 2;
	let x = cx - (wpx >> 1);
	for (const ch of t) {
		const g = FONT[ch];
		if (g)
			for (let ry = 0; ry < 7; ry++)
				for (let rx = 0; rx < 5; rx++)
					if (g[ry][rx] === '#') {
						const bx = x + rx * 2;
						const by = y0 + ry * 2;
						if (shadow !== undefined) rectfill(bx + 1, by + 1, bx + 2, by + 2, shadow);
						rectfill(bx, by, bx + 1, by + 1, c);
					}
		x += 12;
	}
};
drawBig('FLIPRUN', 64, 34, 12, 2);
const tag = 'ONEBUTTON';
drawSmall(tag, 64 - (textWidthSmall(tag) >> 1), 74, 6);

// encode indices -> RGB -> PNG using picopilot's own palette + encoder
const rgb = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++)
	for (let x = 0; x < W; x++) {
		const c = PICO8_PALETTE[px[y][x]];
		const d = (y * W + x) * 3;
		rgb[d] = c.r;
		rgb[d + 1] = c.g;
		rgb[d + 2] = c.b;
	}
writeFileSync(OUT, encodePng({width: W, height: H, rgb}));
console.log(`wrote ${OUT}`);
