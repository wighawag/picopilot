import { describe, expect, it } from 'vitest'

import { PICO8_PALETTE, paletteColor } from './palette.js'

describe('PICO-8 palette (single source of truth)', () => {
  it('has exactly 16 entries', () => {
    expect(PICO8_PALETTE).toHaveLength(16)
  })

  it('matches the fixed PICO-8 constants from the findings table', () => {
    // A representative spot-check against work/notes/findings/pico8-api-reference.md:
    // do NOT re-invent these; they are the load-bearing render source of truth.
    expect(paletteColor(0)).toEqual({ r: 0, g: 0, b: 0 }) // black
    expect(paletteColor(7)).toEqual({ r: 255, g: 241, b: 232 }) // white
    expect(paletteColor(8)).toEqual({ r: 255, g: 0, b: 77 }) // red
    expect(paletteColor(11)).toEqual({ r: 0, g: 228, b: 54 }) // green
    expect(paletteColor(12)).toEqual({ r: 41, g: 173, b: 255 }) // blue
    expect(paletteColor(15)).toEqual({ r: 255, g: 204, b: 170 }) // peach
  })

  it('every entry is a valid 0..255 RGB triple', () => {
    for (const c of PICO8_PALETTE) {
      for (const v of [c.r, c.g, c.b]) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(255)
      }
    }
  })

  it('throws for an out-of-range index', () => {
    expect(() => paletteColor(-1)).toThrow()
    expect(() => paletteColor(16)).toThrow()
  })
})
