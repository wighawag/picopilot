import { describe, expect, it } from 'vitest'

import { GfxSheet } from '../cart/index.js'
import { GfxGridError, GRID_SIZE, gridToNibbles, nibblesToGrid, TRANSPARENT_CHAR } from './grid.js'

/** An 8x8 nibble grid built from a generator, for exhaustive round-trip tests. */
function makeGrid(fn: (r: number, c: number) => number): number[][] {
  const grid: number[][] = []
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: number[] = []
    for (let c = 0; c < GRID_SIZE; c++) row.push(fn(r, c))
    grid.push(row)
  }
  return grid
}

describe('gfx char-grid codec: encode', () => {
  it('renders colour 0 as "." (transparent) and 1..15 as lowercase hex', () => {
    // Row of 0..7 then 8..15 across two rows, rest zero.
    const grid = makeGrid((r, c) => (r === 0 ? c : r === 1 ? c + 8 : 0))
    const text = nibblesToGrid(grid)
    const lines = text.split('\n')
    expect(lines).toHaveLength(GRID_SIZE)
    // Row 0: 0..7 → ".123457"? no — index 0 is ".", 1..7 are hex.
    expect(lines[0]).toBe('.1234567')
    // Row 1: 8..15 → hex 8,9,a..f.
    expect(lines[1]).toBe('89abcdef')
    // Empty rows are all dots.
    expect(lines[2]).toBe(TRANSPARENT_CHAR.repeat(GRID_SIZE))
  })

  it('produces 8 lines of 8 chars, no trailing newline', () => {
    const text = nibblesToGrid(makeGrid(() => 0))
    expect(text.endsWith('\n')).toBe(false)
    const lines = text.split('\n')
    expect(lines).toHaveLength(GRID_SIZE)
    for (const line of lines) expect(line).toHaveLength(GRID_SIZE)
  })
})

describe('gfx char-grid codec: decode', () => {
  it('decodes "." to 0 and hex digits (any case) to 1..15', () => {
    const text = ['.1234567', '89ABCDEF', ...Array(6).fill('........')].join('\n')
    const grid = gridToNibbles(text)
    expect(grid[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // Upper-case hex decodes the same as lower-case.
    expect(grid[1]).toEqual([8, 9, 10, 11, 12, 13, 14, 15])
    expect(grid[2]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('tolerates a single trailing newline (a pasted grid)', () => {
    const text = `${Array(GRID_SIZE).fill('........').join('\n')}\n`
    expect(() => gridToNibbles(text)).not.toThrow()
  })

  it('accepts CRLF line endings', () => {
    const text = Array(GRID_SIZE).fill('........').join('\r\n')
    const grid = gridToNibbles(text)
    expect(grid).toHaveLength(GRID_SIZE)
  })

  it('rejects a grid with the wrong number of rows', () => {
    const tooFew = Array(GRID_SIZE - 1)
      .fill('........')
      .join('\n')
    expect(() => gridToNibbles(tooFew)).toThrow(GfxGridError)
  })

  it('rejects a row with the wrong number of cells', () => {
    const rows = Array(GRID_SIZE).fill('........')
    rows[3] = '.......' // 7 cells
    expect(() => gridToNibbles(rows.join('\n'))).toThrow(GfxGridError)
  })

  it('rejects an invalid char', () => {
    const rows = Array(GRID_SIZE).fill('........')
    rows[0] = '.......X'
    expect(() => gridToNibbles(rows.join('\n'))).toThrow(GfxGridError)
  })
})

describe('gfx char-grid codec: round-trip is an IDENTITY (the acceptance guard)', () => {
  it('nibbles → grid → nibbles is identity for a ramp covering every colour', () => {
    // Cover all 16 indices densely across the 8x8 (index = (r*8+c) % 16).
    const grid = makeGrid((r, c) => (r * GRID_SIZE + c) % 16)
    const round = gridToNibbles(nibblesToGrid(grid))
    expect(round).toEqual(grid)
  })

  it('grid → nibbles → grid is identity for a hand-written grid', () => {
    const text = [
      '.8888888',
      '8.7.7.7.',
      '88888888',
      '.a.a.a.a',
      'ffffffff',
      '........',
      '0.1.2.3.', // wait: "0" is a valid nibble too (1..15 use hex, 0 uses ".")
      'c.d.e.f.',
    ]
    // Fix row 6: "0" is NOT how zero is written; zero is ".". Use non-zero hex.
    text[6] = '1.2.3.4.'
    const grid = gridToNibbles(text.join('\n'))
    const round = nibblesToGrid(grid)
    expect(round).toBe(text.join('\n'))
  })

  it('every colour value survives the round trip via a real GfxSheet sprite', () => {
    // The codec must compose with the cart model: read a sprite off a GfxSheet,
    // encode, decode, and the sheet write-back must reproduce the same pixels.
    const sheet = GfxSheet.fromBody(undefined)
    // Paint sprite 5 with a full-range pattern.
    const painted = makeGrid((r, c) => (r * GRID_SIZE + c) % 16)
    sheet.setSprite(5, painted)

    const text = nibblesToGrid(sheet.getSprite(5))
    const decoded = gridToNibbles(text)
    expect(decoded).toEqual(painted)
  })
})
