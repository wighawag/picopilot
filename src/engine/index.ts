/**
 * The picopilot engine layer: pure codecs and external-tool adapters, kept
 * separate from the incur command layer (`src/commands/`) so commands stay thin
 * and the engine stays independently testable.
 *
 * Planned modules (added by later tasks, one per seam):
 *
 * - `engine/gfx`     — TS codec: `__gfx__` hex ↔ char grid, and hex → PNG.
 * - `engine/audio`   — TS codec: picopilot-MML → `__sfx__`, patterns → `__music__`.
 * - `engine/shrinko` — adapter shelling out to the external `shrinko8` tool
 *                      (token count, lint, minify, p8↔lua, spritesheet PNG).
 * - `engine/pico8`   — headless run + capture + export (needs the PICO-8 binary).
 *
 * This barrel intentionally has no exports yet; it exists so the layout is
 * established and later tasks re-export from here without restructuring.
 */
export {}
