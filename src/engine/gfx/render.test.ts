import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { GfxSheet } from '../cart/index.js'
import { PICO8_PALETTE } from './palette.js'
import type { RgbImage } from './png.js'
import {
  renderSheetPng,
  renderSpritePng,
  SHEET_RENDER_SCALE,
  SPRITE_RENDER_SCALE,
  upscale,
} from './render.js'

/** Decodes a PNG (via node's independent inflate) into a raw RGB image. */
function decodePng(bytes: Uint8Array): RgbImage {
  let off = 8
  let width = 0
  let height = 0
  const idatParts: Buffer[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (off < bytes.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(
      bytes[off + 4]!,
      bytes[off + 5]!,
      bytes[off + 6]!,
      bytes[off + 7]!,
    )
    const data = bytes.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = dv.getUint32(0)
      height = dv.getUint32(4)
    } else if (type === 'IDAT') {
      idatParts.push(Buffer.from(data))
    }
    off += 12 + len
    if (type === 'IEND') break
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(idatParts)))
  const stride = width * 3
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    rgb.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride)
  }
  return { width, height, rgb }
}

function pixelAt(img: RgbImage, x: number, y: number): [number, number, number] {
  const off = (y * img.width + x) * 3
  return [img.rgb[off]!, img.rgb[off + 1]!, img.rgb[off + 2]!]
}

function rgbOf(index: number): [number, number, number] {
  const c = PICO8_PALETTE[index]!
  return [c.r, c.g, c.b]
}

/** An 8x8 nibble grid from a generator. */
function makeGrid(fn: (r: number, c: number) => number): number[][] {
  return Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => fn(r, c)))
}

describe('upscale (nearest-neighbour, palette-accurate)', () => {
  it('paints each source pixel as a scale x scale block of its palette RGB', () => {
    // 2x1 source: index 8 (red) then index 12 (blue), scale 4.
    const img = upscale(2, 1, (x) => (x === 0 ? 8 : 12), 4)
    expect(img.width).toBe(8)
    expect(img.height).toBe(4)
    // The whole left 4x4 block is red; the whole right 4x4 block is blue.
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) expect(pixelAt(img, x, y)).toEqual(rgbOf(8))
      for (let x = 4; x < 8; x++) expect(pixelAt(img, x, y)).toEqual(rgbOf(12))
    }
  })
})

describe('renderSpritePng: deterministic palette-accurate pixel bytes', () => {
  it('upscales an 8x8 sprite to 256x256 with the exact palette RGB per index', () => {
    // Paint sprite 0 so pixel (c, r) has colour index (r*8 + c) % 16 — every
    // index appears, at a known position.
    const painted = makeGrid((r, c) => (r * 8 + c) % 16)
    const sheet = GfxSheet.fromBody(undefined)
    sheet.setSprite(0, painted)

    const png = renderSpritePng(sheet, 0)
    const img = decodePng(png)
    expect(img.width).toBe(8 * SPRITE_RENDER_SCALE)
    expect(img.height).toBe(8 * SPRITE_RENDER_SCALE)
    expect(img.width).toBe(256)

    // Assert the PIXEL BYTES: the centre of each source-pixel block is exactly
    // that index's palette RGB.
    const s = SPRITE_RENDER_SCALE
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const index = (r * 8 + c) % 16
        const cx = c * s + (s >> 1)
        const cy = r * s + (s >> 1)
        expect(pixelAt(img, cx, cy)).toEqual(rgbOf(index))
      }
    }
  })

  it('renders a non-zero sprite (e.g. 5) from its own origin, not sprite 0', () => {
    const sheet = GfxSheet.fromBody(undefined)
    sheet.setSprite(
      0,
      makeGrid(() => 8),
    ) // sprite 0 is all red — must NOT leak in
    sheet.setSprite(
      5,
      makeGrid(() => 11),
    ) // sprite 5 is all green

    const img = decodePng(renderSpritePng(sheet, 5))
    // Every pixel is green (index 11), proving sprite 5's origin was used.
    for (let y = 0; y < img.height; y += 37) {
      for (let x = 0; x < img.width; x += 37) {
        expect(pixelAt(img, x, y)).toEqual(rgbOf(11))
      }
    }
  })

  it('is byte-deterministic for the same sprite', () => {
    const sheet = GfxSheet.fromBody(undefined)
    sheet.setSprite(
      0,
      makeGrid((r, c) => (r + c) % 16),
    )
    const a = renderSpritePng(sheet, 0)
    const b = renderSpritePng(sheet, 0)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('renderSheetPng: the whole 128x128 spritesheet', () => {
  it('upscales the 128x128 sheet to 256x256 with palette-accurate pixels', () => {
    const sheet = GfxSheet.fromBody(undefined)
    // Distinct colours in distinct sprites, so positions are checkable.
    sheet.setSprite(
      0,
      makeGrid(() => 8),
    ) // top-left 8x8 (upscaled) = red
    sheet.setSprite(
      15,
      makeGrid(() => 12),
    ) // top-right sprite = blue
    sheet.setSprite(
      255,
      makeGrid(() => 10),
    ) // bottom-right sprite = yellow

    const img = decodePng(renderSheetPng(sheet))
    expect(img.width).toBe(128 * SHEET_RENDER_SCALE)
    expect(img.height).toBe(128 * SHEET_RENDER_SCALE)
    expect(img.width).toBe(256)

    const s = SHEET_RENDER_SCALE
    // sprite 0 occupies source pixels [0,8)x[0,8) → dest [0,16)x[0,16).
    expect(pixelAt(img, 0, 0)).toEqual(rgbOf(8))
    expect(pixelAt(img, 8 * s - 1, 8 * s - 1)).toEqual(rgbOf(8))
    // sprite 15 is source cols [120,128) row [0,8) → dest x [240,256).
    expect(pixelAt(img, 120 * s, 0)).toEqual(rgbOf(12))
    // sprite 255 is the bottom-right 8x8 → dest bottom-right corner.
    expect(pixelAt(img, img.width - 1, img.height - 1)).toEqual(rgbOf(10))
    // An untouched pixel (sprite 1 region) is index 0 = black.
    expect(pixelAt(img, 8 * s, 0)).toEqual(rgbOf(0))
  })
})
