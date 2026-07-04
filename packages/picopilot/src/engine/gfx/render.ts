import {
	GFX_HEIGHT,
	GFX_WIDTH,
	type GfxSheet,
	SPRITE_SIZE,
	spriteOrigin,
} from '../cart/index.js';
import {paletteColor} from './palette.js';
import {encodePng, type RgbImage} from './png.js';

/**
 * The `gfx render` JUDGE surface: turn a sprite (or the whole spritesheet) into a
 * nearest-neighbour-upscaled, palette-accurate PNG a multimodal agent can LOOK at.
 *
 * The char grid (`gfx show`/`gfx set`) is the exact EDIT surface, but an LLM reads
 * serialized hex poorly for gestalt/colour (the SVG parallel: models generate
 * structured visual source well but read it back poorly). So this renders the
 * ACTUAL pixels, upscaled enough to be viewable, with each colour index mapped to
 * its exact PICO-8 palette RGB (single source of truth: {@link paletteColor}).
 *
 * Upscale is NEAREST-NEIGHBOUR (each source pixel becomes a `scale`x`scale` block
 * of identical RGB) so the pixel-art stays crisp and the output bytes are
 * deterministic. The scale is chosen so the longer edge lands near ~256px:
 * - a single 8x8 sprite → scale 32 → 256x256 (see {@link SPRITE_RENDER_SCALE}).
 * - the 128x128 sheet    → scale 2  → 256x256 (see {@link SHEET_RENDER_SCALE}).
 */

/** Nearest-neighbour scale for a single 8x8 sprite: 8 * 32 = 256px. */
export const SPRITE_RENDER_SCALE = 32;

/** Nearest-neighbour scale for the 128x128 spritesheet: 128 * 2 = 256px. */
export const SHEET_RENDER_SCALE = 2;

/** The target viewable edge length both scales aim for (~256px). */
export const RENDER_TARGET_PX = 256;

/**
 * Renders one sprite (0..255) to a PNG buffer: its 8x8 pixels, each mapped to its
 * palette RGB, nearest-neighbour upscaled by {@link SPRITE_RENDER_SCALE}.
 */
export function renderSpritePng(sheet: GfxSheet, n: number): Uint8Array {
	const {x0, y0} = spriteOrigin(n);
	return encodePng(
		upscale(
			SPRITE_SIZE,
			SPRITE_SIZE,
			(x, y) => sheet.getPixel(x0 + x, y0 + y),
			SPRITE_RENDER_SCALE,
		),
	);
}

/**
 * Renders the whole 128x128 spritesheet to a PNG buffer: every pixel mapped to
 * its palette RGB, nearest-neighbour upscaled by {@link SHEET_RENDER_SCALE}.
 */
export function renderSheetPng(sheet: GfxSheet): Uint8Array {
	return encodePng(
		upscale(
			GFX_WIDTH,
			GFX_HEIGHT,
			(x, y) => sheet.getPixel(x, y),
			SHEET_RENDER_SCALE,
		),
	);
}

/**
 * Builds an upscaled {@link RgbImage} from a source of colour indices. Each
 * source pixel (`getIndex(x, y)`) is mapped to its palette RGB and painted as a
 * `scale`x`scale` block (nearest-neighbour), producing a `(srcW*scale)` x
 * `(srcH*scale)` RGB buffer.
 */
export function upscale(
	srcWidth: number,
	srcHeight: number,
	getIndex: (x: number, y: number) => number,
	scale: number,
): RgbImage {
	if (!Number.isInteger(scale) || scale < 1) {
		throw new RangeError(
			`upscale factor must be a positive integer, got ${scale}`,
		);
	}
	const width = srcWidth * scale;
	const height = srcHeight * scale;
	const rgb = new Uint8Array(width * height * 3);

	for (let sy = 0; sy < srcHeight; sy++) {
		for (let sx = 0; sx < srcWidth; sx++) {
			const {r, g, b} = paletteColor(getIndex(sx, sy));
			// Paint the scale x scale destination block for this source pixel.
			for (let dy = 0; dy < scale; dy++) {
				const y = sy * scale + dy;
				for (let dx = 0; dx < scale; dx++) {
					const x = sx * scale + dx;
					const off = (y * width + x) * 3;
					rgb[off] = r;
					rgb[off + 1] = g;
					rgb[off + 2] = b;
				}
			}
		}
	}
	return {width, height, rgb};
}
