import type { Cart } from './cart.js'
import { CartRangeError } from './errors.js'

/**
 * Addressable view over a cart's `__gfx__` section: the 128x128 spritesheet as a
 * grid of per-pixel colour nibbles (0..15), NOT an opaque hex string.
 *
 * The spritesheet holds 256 8x8 sprites laid out 16 per row: sprite `n` lives at
 * pixel column `(n % 16) * 8`, row `(n \ 16) * 8`. Sprites 0..127 are the base
 * bank; sprites 128..255 (`0x1000` in memory) alias `__map__` rows 32..63 (the
 * overlap the smart-refuse depends on); see {@link mapRowsForSprite}.
 *
 * Reads/writes go through the parsed grid; call {@link commit} to write the grid
 * back into the cart's `__gfx__` body (preserving its trailing-newline style).
 * If the section body is shorter than the full sheet (a partial/authored cart),
 * missing pixels read as 0 and short rows are padded to full width on commit.
 */
export const GFX_WIDTH = 128
export const GFX_HEIGHT = 128
export const SPRITE_SIZE = 8
export const SPRITES_PER_ROW = 16

export class GfxSheet {
  /** `pixels[y][x]` is the colour index 0..15 at pixel (x, y). */
  private readonly pixels: number[][]

  /** The newline that terminates each row line in the source body (`\n` default). */
  private readonly newline: string

  private constructor(pixels: number[][], newline: string) {
    this.pixels = pixels
    this.newline = newline
  }

  /**
   * Builds an addressable sheet from a cart's `__gfx__` body. A missing or empty
   * section yields an all-zero sheet, so the codec can still address any sprite.
   */
  static fromBody(body: string | undefined): GfxSheet {
    const newline = body !== undefined && /\r\n/.test(body) ? '\r\n' : '\n'
    const pixels: number[][] = []
    const lines = body === undefined ? [] : body.split(/\r?\n/)
    for (let y = 0; y < GFX_HEIGHT; y++) {
      const line = lines[y] ?? ''
      const row: number[] = []
      for (let x = 0; x < GFX_WIDTH; x++) {
        const ch = line[x]
        row.push(ch === undefined ? 0 : hexNibble(ch))
      }
      pixels.push(row)
    }
    return new GfxSheet(pixels, newline)
  }

  /** Reads the colour index (0..15) at pixel (x, y). */
  getPixel(x: number, y: number): number {
    this.assertPixel(x, y)
    return this.pixels[y]?.[x] ?? 0
  }

  /** Writes the colour index (0..15) at pixel (x, y). */
  setPixel(x: number, y: number, color: number): void {
    this.assertPixel(x, y)
    if (!Number.isInteger(color) || color < 0 || color > 15) {
      throw new CartRangeError(`colour ${color} out of range 0..15`)
    }
    const row = this.pixels[y]
    if (row !== undefined) row[x] = color
  }

  /**
   * Reads one 8x8 sprite (0..255) as an 8-row grid of colour indices, `grid[r][c]`.
   */
  getSprite(n: number): number[][] {
    const { x0, y0 } = spriteOrigin(n)
    const grid: number[][] = []
    for (let r = 0; r < SPRITE_SIZE; r++) {
      const row: number[] = []
      for (let c = 0; c < SPRITE_SIZE; c++) row.push(this.getPixel(x0 + c, y0 + r))
      grid.push(row)
    }
    return grid
  }

  /**
   * Writes one 8x8 sprite (0..255) from an 8-row grid of colour indices. The
   * grid must be 8x8; each cell 0..15.
   */
  setSprite(n: number, grid: number[][]): void {
    if (grid.length !== SPRITE_SIZE) {
      throw new CartRangeError(`sprite grid must have ${SPRITE_SIZE} rows, got ${grid.length}`)
    }
    const { x0, y0 } = spriteOrigin(n)
    for (let r = 0; r < SPRITE_SIZE; r++) {
      const gridRow = grid[r]
      if (gridRow === undefined || gridRow.length !== SPRITE_SIZE) {
        throw new CartRangeError(`sprite grid row ${r} must have ${SPRITE_SIZE} cells`)
      }
      for (let c = 0; c < SPRITE_SIZE; c++) this.setPixel(x0 + c, y0 + r, gridRow[c] ?? 0)
    }
  }

  /**
   * Serializes the grid back to a `__gfx__` body (128 lines of 128 hex nibbles),
   * using the source body's newline style and terminating the last line, so it
   * matches what PICO-8 writes.
   */
  toBody(): string {
    const lines: string[] = []
    for (let y = 0; y < GFX_HEIGHT; y++) {
      let line = ''
      for (let x = 0; x < GFX_WIDTH; x++) line += (this.pixels[y]?.[x] ?? 0).toString(16)
      lines.push(line)
    }
    return lines.join(this.newline) + this.newline
  }

  /** Writes the grid back into the cart's `__gfx__` section. */
  commit(cart: Cart): void {
    cart.setSection('gfx', this.toBody())
  }

  private assertPixel(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= GFX_WIDTH ||
      y >= GFX_HEIGHT
    ) {
      throw new CartRangeError(`pixel (${x}, ${y}) out of range 0..${GFX_WIDTH - 1}`)
    }
  }
}

/** The top-left pixel origin of sprite `n` (0..255) in the 128x128 sheet. */
export function spriteOrigin(n: number): { x0: number; y0: number } {
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    throw new CartRangeError(`sprite ${n} out of range 0..255`)
  }
  return {
    x0: (n % SPRITES_PER_ROW) * SPRITE_SIZE,
    y0: Math.floor(n / SPRITES_PER_ROW) * SPRITE_SIZE,
  }
}

/**
 * Whether sprite `n` lives in the shared upper bank (128..255) that aliases the
 * bottom half of `__map__`. The gfx/map overlap smart-refuse (next task) keys
 * off this.
 */
export function spriteAliasesMap(n: number): boolean {
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    throw new CartRangeError(`sprite ${n} out of range 0..255`)
  }
  return n >= 128
}

/**
 * The `__map__` rows a shared-bank sprite (128..255) aliases, or `undefined` for
 * a base-bank sprite (0..127) that aliases nothing.
 *
 * Memory layout: sprite `n`'s 8 pixel rows sit at gfx rows `(n \ 16) * 8`; for
 * the shared bank those are gfx rows 64..127, which occupy the SAME memory as
 * `__map__` rows 32..63. Each map row is 128 bytes = 2 gfx pixel rows (128 gfx
 * nibbles map to 128/... ). Concretely: gfx row `g` (64..127) aliases map row
 * `32 + (g - 64) \ 2`, so a single 8-row sprite covers 4 map rows.
 */
export function mapRowsForSprite(n: number): { start: number; end: number } | undefined {
  if (!spriteAliasesMap(n)) return undefined
  const { y0 } = spriteOrigin(n)
  // y0 is 64..120 for the shared bank; each pair of gfx rows aliases one map row.
  const start = 32 + Math.floor((y0 - 64) / 2)
  return { start, end: start + SPRITE_SIZE / 2 } // 8 gfx rows = 4 map rows: [start, end)
}

function hexNibble(ch: string): number {
  const v = Number.parseInt(ch, 16)
  if (Number.isNaN(v)) {
    throw new CartRangeError(`invalid hex nibble "${ch}" in __gfx__`)
  }
  return v
}
