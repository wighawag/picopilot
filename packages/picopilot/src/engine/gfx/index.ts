/**
 * `engine/gfx` — the shrinko-free char-grid codec (`__gfx__` nibbles ↔ char
 * grid) plus the gfx/map overlap smart-refuse decision.
 *
 * This module OWNS the char-grid representation (the "SVG for pixels" EDIT
 * surface), the overlap safety logic, and the palette-accurate PNG render (the
 * JUDGE surface). The `gfx show`/`gfx set`/`gfx render` commands are thin wiring
 * over it. It is separable from the cart model (it only speaks nibble grids,
 * strings, and RGB buffers) so it round-trips in isolation.
 */
export {
	GRID_SIZE,
	GfxGridError,
	gridToNibbles,
	nibblesToGrid,
	TRANSPARENT_CHAR,
} from './grid.js';
export {
	LABEL_SIZE,
	LabelError,
	labelHexFromPng,
	nearestPaletteIndex,
} from './label.js';
export {decideOverlap, type OverlapDecision, spriteHasData} from './overlap.js';
export {PICO8_PALETTE, type PaletteColor, paletteColor} from './palette.js';
export {encodePng, type RgbImage} from './png.js';
export {
	RENDER_TARGET_PX,
	renderSheetPng,
	renderSpritePng,
	SHEET_RENDER_SCALE,
	SPRITE_RENDER_SCALE,
	upscale,
} from './render.js';
