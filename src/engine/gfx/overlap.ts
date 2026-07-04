import { type GfxSheet, spriteAliasesMap } from '../cart/index.js'

/**
 * The gfx/map overlap smart-refuse decision (ADR-0004), computed purely from a
 * cart's CURRENT `__gfx__` pixels plus the authorisation flag.
 *
 * Why `__gfx__`, not `__map__` (the corrected seam): sprites 128..255 alias the
 * shared map region, but those shared bytes live in the `__gfx__` `0x1000` upper
 * bank, NOT in the text-format `.p8` `__map__` section (which stores only map
 * rows 0..31). So "the data at risk" when overwriting a shared-bank sprite IS
 * the sprite's OWN current `__gfx__` pixels. This module inspects those pixels
 * directly (via {@link GfxSheet}); it deliberately does NOT consult `__map__`.
 *
 * The single invariant: picopilot never SILENTLY overwrites existing
 * shared-region data that nothing authorised.
 */

/** Whether ANY pixel of sprite `n` is non-zero, i.e. the sprite already holds data. */
export function spriteHasData(sheet: GfxSheet, n: number): boolean {
  const grid = sheet.getSprite(n)
  for (const row of grid) {
    for (const px of row) if (px !== 0) return true
  }
  return false
}

/** The verdict of {@link decideOverlap}. */
export type OverlapDecision =
  | { kind: 'allowed' }
  | { kind: 'allowed-shared'; reason: 'authorised' | 'empty' }
  | { kind: 'refused'; nonZeroPixels: number }

/**
 * Decides whether a `gfx set` write to sprite `n` may proceed, given the cart's
 * current `__gfx__` and whether overlap is authorised.
 *
 * - sprite 0..127 (base bank, aliases nothing) → `allowed` (no overlap possible).
 * - sprite 128..255 whose current pixels are ALL-ZERO → `allowed-shared` (empty):
 *   the write proceeds; the caller notes the aliasing in its result.
 * - sprite 128..255 with non-zero pixels AND `authorised` → `allowed-shared`
 *   (authorised): the write proceeds and overwrites the shared data on purpose.
 * - sprite 128..255 with non-zero pixels AND NOT authorised → `refused`: the
 *   genuine data-loss corner. The caller REFUSES (structured + nonzero exit +
 *   bytes untouched).
 */
export function decideOverlap(sheet: GfxSheet, n: number, authorised: boolean): OverlapDecision {
  if (!spriteAliasesMap(n)) return { kind: 'allowed' }

  if (!spriteHasData(sheet, n)) return { kind: 'allowed-shared', reason: 'empty' }
  if (authorised) return { kind: 'allowed-shared', reason: 'authorised' }

  return { kind: 'refused', nonZeroPixels: countNonZeroPixels(sheet, n) }
}

function countNonZeroPixels(sheet: GfxSheet, n: number): number {
  let count = 0
  for (const row of sheet.getSprite(n)) {
    for (const px of row) if (px !== 0) count++
  }
  return count
}
