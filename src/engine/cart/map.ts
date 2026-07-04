import type { Cart } from './cart.js'
import { CartRangeError } from './errors.js'

/**
 * Addressable view over a cart's `__map__` section: the tile map as a grid of
 * 8-bit tile indices, NOT an opaque hex string.
 *
 * The text `__map__` stores the base map: up to 32 rows of 128 tiles, each tile
 * a byte written as two hex chars (`grid[y][x]`). Rows 32..63 (the shared half)
 * are NOT stored here in the text format (they live in `__gfx__`'s upper bank
), see `gfx.ts` {@link mapRowsForSprite}; this view models the `__map__` body
 * as written. The 0x1000 overlap check reads a shared-bank sprite's aliased map
 * region through {@link nonZeroTilesInRows} to decide whether a write clobbers
 * real tiles.
 *
 * Reads/writes go through the parsed grid; call {@link commit} to write it back
 * into the cart's `__map__` body. A missing/short section reads as zero tiles.
 */
export const MAP_WIDTH = 128
export const MAP_ROWS = 32

export class MapData {
  /** `tiles[y][x]` is the 0..255 tile index at map cell (x, y). */
  private readonly tiles: number[][]

  private readonly newline: string

  private constructor(tiles: number[][], newline: string) {
    this.tiles = tiles
    this.newline = newline
  }

  /** Builds an addressable map from a cart's `__map__` body (all-zero if absent). */
  static fromBody(body: string | undefined): MapData {
    const newline = body !== undefined && /\r\n/.test(body) ? '\r\n' : '\n'
    const lines = body === undefined ? [] : body.split(/\r?\n/)
    const tiles: number[][] = []
    for (let y = 0; y < MAP_ROWS; y++) {
      const line = lines[y] ?? ''
      const row: number[] = []
      for (let x = 0; x < MAP_WIDTH; x++) {
        const hi = line[x * 2]
        const lo = line[x * 2 + 1]
        row.push(hi === undefined || lo === undefined ? 0 : hexByte(hi, lo))
      }
      tiles.push(row)
    }
    return new MapData(tiles, newline)
  }

  /** Reads the tile index (0..255) at map cell (x, y). */
  getTile(x: number, y: number): number {
    this.assertCell(x, y)
    return this.tiles[y]?.[x] ?? 0
  }

  /** Writes the tile index (0..255) at map cell (x, y). */
  setTile(x: number, y: number, value: number): void {
    this.assertCell(x, y)
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new CartRangeError(`tile value ${value} out of range 0..255`)
    }
    const row = this.tiles[y]
    if (row !== undefined) row[x] = value
  }

  /** Reads one full map row (128 tile indices) at row `y`. */
  getRow(y: number): number[] {
    if (!Number.isInteger(y) || y < 0 || y >= MAP_ROWS) {
      throw new CartRangeError(`map row ${y} out of range 0..${MAP_ROWS - 1}`)
    }
    return (this.tiles[y] ?? []).slice()
  }

  /**
   * Counts non-zero tiles across a half-open row range `[start, end)`, clamped
   * to the stored `__map__` rows (0..31). Shared-bank rows (32..63) that the
   * text `__map__` does not store contribute zero. This is the primitive the
   * gfx/map overlap smart-refuse uses to decide whether a shared-bank sprite
   * write would clobber real map data.
   */
  nonZeroTilesInRows(start: number, end: number): number {
    let count = 0
    for (let y = Math.max(0, start); y < Math.min(MAP_ROWS, end); y++) {
      for (let x = 0; x < MAP_WIDTH; x++) if ((this.tiles[y]?.[x] ?? 0) !== 0) count++
    }
    return count
  }

  /** Serializes the grid back to a `__map__` body (32 lines of 256 hex chars). */
  toBody(): string {
    const lines: string[] = []
    for (let y = 0; y < MAP_ROWS; y++) {
      let line = ''
      for (let x = 0; x < MAP_WIDTH; x++) line += byteHex(this.tiles[y]?.[x] ?? 0)
      lines.push(line)
    }
    return lines.join(this.newline) + this.newline
  }

  /** Writes the grid back into the cart's `__map__` section. */
  commit(cart: Cart): void {
    cart.setSection('map', this.toBody())
  }

  private assertCell(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= MAP_WIDTH ||
      y >= MAP_ROWS
    ) {
      throw new CartRangeError(
        `map cell (${x}, ${y}) out of range 0..${MAP_WIDTH - 1} x 0..${MAP_ROWS - 1}`,
      )
    }
  }
}

function hexByte(hi: string, lo: string): number {
  const v = Number.parseInt(`${hi}${lo}`, 16)
  if (Number.isNaN(v)) {
    throw new CartRangeError(`invalid hex byte "${hi}${lo}" in __map__`)
  }
  return v
}

function byteHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}
