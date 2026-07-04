/**
 * `engine/gfx` — the shrinko-free char-grid codec (`__gfx__` nibbles ↔ char
 * grid) plus the gfx/map overlap smart-refuse decision.
 *
 * This module OWNS the char-grid representation (the "SVG for pixels" EDIT
 * surface) and the overlap safety logic; the `gfx show`/`gfx set` commands are
 * thin wiring over it, and the later `gfx render` task reuses the codec. It is
 * separable from the cart model (it only speaks nibble grids + strings) so it
 * round-trips in isolation.
 */
export {
  GRID_SIZE,
  GfxGridError,
  gridToNibbles,
  nibblesToGrid,
  TRANSPARENT_CHAR,
} from './grid.js'
export {
  decideOverlap,
  type OverlapDecision,
  spriteHasData,
} from './overlap.js'
