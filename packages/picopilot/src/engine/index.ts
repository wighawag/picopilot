/**
 * The picopilot engine layer: pure codecs and external-tool adapters, kept
 * separate from the incur command layer (`src/commands/`) so commands stay thin
 * and the engine stays independently testable.
 *
 * Modules (one per seam; more added by later tasks):
 *
 * - `engine/cart`:    the `.p8` cart model: parse sections, addressable
 *                      gfx/map regions, byte-identical serialize (this seam).
 * - `engine/gfx`:     TS codec: `__gfx__` hex to/from char grid, and hex to PNG.
 * - `engine/audio`:   TS codec: picopilot-MML to `__sfx__`, patterns to `__music__`.
 * - `engine/shrinko`: adapter shelling out to the external `shrinko8` tool
 *                      (token count, lint, minify, p8/lua, spritesheet PNG).
 * - `engine/pico8`:   headless run + capture + export (needs the PICO-8 binary).
 *
 * Later tasks re-export from here without restructuring.
 */
export * from './cart/index.js';
export * from './shrinko/index.js';
