/**
 * The picopilot cart model: parse a text-format `.p8` into a typed, section-level
 * model, read/modify individual sections, address the `__gfx__`/`__map__` hex as
 * pixel/tile regions, and serialize back byte-identically.
 *
 * This is the load-bearing seam every cart-touching command (init, gfx, tokens,
 * verify) reads and writes through. See `cart.ts` for the round-trip-identity
 * contract; `gfx.ts` / `map.ts` for the addressable regions (and the 0x1000
 * overlap the smart-refuse depends on).
 */
export { Cart, CART_SECTION_NAMES, type CartSectionName } from './cart.js'
export { CartParseError, type CartParseErrorCode, CartRangeError } from './errors.js'
export {
  GfxSheet,
  GFX_HEIGHT,
  GFX_WIDTH,
  mapRowsForSprite,
  SPRITE_SIZE,
  SPRITES_PER_ROW,
  spriteAliasesMap,
  spriteOrigin,
} from './gfx.js'
export { MapData, MAP_ROWS, MAP_WIDTH } from './map.js'
