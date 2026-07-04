import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  Cart,
  CART_SECTION_NAMES,
  CartParseError,
  CartRangeError,
  GFX_HEIGHT,
  GfxSheet,
  MapData,
  mapRowsForSprite,
  spriteAliasesMap,
  spriteOrigin,
} from './index.js'

/** Reads a fixture `.p8` as a raw string (no newline normalisation). */
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

const ALL_FIXTURES = [
  'minimal.p8',
  'full.p8',
  'crlf.p8',
  'no-trailing-newline.p8',
  'header-only.p8',
]

describe('Cart round-trip identity', () => {
  for (const name of ALL_FIXTURES) {
    it(`parse -> serialize is byte-identical for ${name}`, () => {
      const text = fixture(name)
      expect(Cart.parse(text).serialize()).toBe(text)
    })
  }

  it('round-trips CRLF newlines without normalising them', () => {
    const text = fixture('crlf.p8')
    expect(text).toContain('\r\n')
    const out = Cart.parse(text).serialize()
    expect(out).toBe(text)
    expect(out).toContain('\r\n')
  })

  it('round-trips a cart with no trailing newline', () => {
    const text = fixture('no-trailing-newline.p8')
    expect(text.endsWith('\n')).toBe(false)
    expect(Cart.parse(text).serialize()).toBe(text)
  })

  it('does not mistake a `__x__` token inside Lua for a section marker', () => {
    const text = [
      'pico-8 cartridge // http://www.pico-8.com',
      'version 42',
      '__lua__',
      'x = "__gfx__ inside a string, indented"',
      '   __map__ = 1 -- indented, not a marker',
      '__gfx__',
      '00000000',
      '',
    ].join('\n')
    const cart = Cart.parse(text)
    // Only the two real, line-anchored markers are sections.
    expect(cart.sectionNames()).toEqual(['lua', 'gfx'])
    expect(cart.getSection('lua')).toContain('__gfx__ inside a string')
    expect(cart.serialize()).toBe(text)
  })
})

describe('Cart section-level read/write', () => {
  it('reads individual section bodies', () => {
    const cart = Cart.parse(fixture('minimal.p8'))
    expect(cart.sectionNames()).toEqual(['lua', 'gfx'])
    expect(cart.getSection('lua')).toContain('function _init()')
    expect(cart.getSection('gfx')).toContain('00000000')
    expect(cart.getSection('sfx')).toBeUndefined()
    expect(cart.hasSection('map')).toBe(false)
  })

  it('replaces __gfx__ without disturbing __lua__ or the header', () => {
    const text = fixture('minimal.p8')
    const cart = Cart.parse(text)
    const luaBefore = cart.getSection('lua')
    cart.setSection('gfx', 'ffffffff\n')
    expect(cart.getSection('gfx')).toBe('ffffffff\n')
    // Other section + header untouched.
    expect(cart.getSection('lua')).toBe(luaBefore)
    expect(cart.header).toBe(Cart.parse(text).header)
    // The only diff from the original is inside __gfx__.
    const out = cart.serialize()
    expect(out).toContain('__lua__\n-- minimal cart')
    expect(out).toContain('__gfx__\nffffffff\n')
    expect(out).not.toContain('00000000')
  })

  it('appends a new section in the file newline style, leaving others intact', () => {
    const text = fixture('minimal.p8')
    const cart = Cart.parse(text)
    cart.setSection('sfx', '000100000\n')
    expect(cart.sectionNames()).toEqual(['lua', 'gfx', 'sfx'])
    // Original text is a strict prefix; the new section is appended verbatim.
    expect(cart.serialize()).toBe(`${text}__sfx__\n000100000\n`)
  })

  it('setSection is idempotent for an unchanged body (still round-trips)', () => {
    const text = fixture('full.p8')
    const cart = Cart.parse(text)
    const gfx = cart.getSection('gfx')
    if (gfx === undefined) throw new Error('fixture missing __gfx__')
    cart.setSection('gfx', gfx)
    expect(cart.serialize()).toBe(text)
  })
})

describe('Cart structured errors (no crash on malformed input)', () => {
  it('throws missing-header when the header line is absent', () => {
    try {
      Cart.parse(fixture('malformed-no-header.p8'))
      throw new Error('expected CartParseError')
    } catch (e) {
      expect(e).toBeInstanceOf(CartParseError)
      expect((e as CartParseError).code).toBe('missing-header')
    }
  })

  it('throws missing-version when the version line is absent', () => {
    const text = 'pico-8 cartridge // http://www.pico-8.com\n__lua__\nx=1\n'
    expect(() => Cart.parse(text)).toThrow(CartParseError)
    try {
      Cart.parse(text)
    } catch (e) {
      expect((e as CartParseError).code).toBe('missing-version')
    }
  })

  it('throws unknown-section for an unmodelled marker', () => {
    const text = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__bogus__\nx\n'
    try {
      Cart.parse(text)
      throw new Error('expected CartParseError')
    } catch (e) {
      expect(e).toBeInstanceOf(CartParseError)
      expect((e as CartParseError).code).toBe('unknown-section')
    }
  })

  it('throws duplicate-section when a marker repeats', () => {
    const text = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nx\n__lua__\ny\n'
    try {
      Cart.parse(text)
      throw new Error('expected CartParseError')
    } catch (e) {
      expect((e as CartParseError).code).toBe('duplicate-section')
    }
  })

  it('parses a header-only cart (no sections) and round-trips it', () => {
    const text = fixture('header-only.p8')
    const cart = Cart.parse(text)
    expect(cart.sectionNames()).toEqual([])
    expect(cart.serialize()).toBe(text)
  })

  it('recognises every modelled section name', () => {
    expect([...CART_SECTION_NAMES].sort()).toEqual(
      ['gff', 'gfx', 'label', 'lua', 'map', 'music', 'sfx'].sort(),
    )
  })
})

describe('GfxSheet addressable region', () => {
  it('reads a sprite from the parsed sheet as an 8x8 colour grid', () => {
    const cart = Cart.parse(fixture('full.p8'))
    const sheet = GfxSheet.fromBody(cart.getSection('gfx'))
    const sprite1 = sheet.getSprite(1)
    expect(sprite1.length).toBe(8)
    expect(sprite1[0]?.length).toBe(8)
    // Fixture painted sprite 1 with e (14) / 8 (8) in a checker.
    expect(sprite1[0]?.[0]).toBe(14)
    expect(sprite1[0]?.[1]).toBe(8)
  })

  it('gfx grid round-trips to the same __gfx__ body (identity)', () => {
    const cart = Cart.parse(fixture('full.p8'))
    const body = cart.getSection('gfx')
    if (body === undefined) throw new Error('fixture missing __gfx__')
    expect(GfxSheet.fromBody(body).toBody()).toBe(body)
  })

  it('editing one sprite and committing changes only __gfx__', () => {
    const text = fixture('full.p8')
    const cart = Cart.parse(text)
    const luaBefore = cart.getSection('lua')
    const mapBefore = cart.getSection('map')
    const sheet = GfxSheet.fromBody(cart.getSection('gfx'))
    const solid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 9))
    sheet.setSprite(0, solid)
    sheet.commit(cart)
    expect(GfxSheet.fromBody(cart.getSection('gfx')).getSprite(0)).toEqual(solid)
    // Sprite 1 (unrelated) and other sections untouched.
    expect(GfxSheet.fromBody(cart.getSection('gfx')).getSprite(1)[0]?.[0]).toBe(14)
    expect(cart.getSection('lua')).toBe(luaBefore)
    expect(cart.getSection('map')).toBe(mapBefore)
  })

  it('setPixel round-trips through hex', () => {
    const sheet = GfxSheet.fromBody(undefined)
    expect(sheet.getPixel(0, 0)).toBe(0)
    sheet.setPixel(3, 5, 12)
    expect(sheet.getPixel(3, 5)).toBe(12)
    const reparsed = GfxSheet.fromBody(sheet.toBody())
    expect(reparsed.getPixel(3, 5)).toBe(12)
  })

  it('rejects out-of-range pixels, sprites, and colours', () => {
    const sheet = GfxSheet.fromBody(undefined)
    expect(() => sheet.getPixel(-1, 0)).toThrow(CartRangeError)
    expect(() => sheet.getPixel(0, GFX_HEIGHT)).toThrow(CartRangeError)
    expect(() => sheet.setPixel(0, 0, 16)).toThrow(CartRangeError)
    expect(() => sheet.getSprite(256)).toThrow(CartRangeError)
  })
})

describe('sprite <-> pixel <-> map addressing (0x1000 overlap)', () => {
  it('maps sprite index to its pixel origin', () => {
    expect(spriteOrigin(0)).toEqual({ x0: 0, y0: 0 })
    expect(spriteOrigin(1)).toEqual({ x0: 8, y0: 0 })
    expect(spriteOrigin(16)).toEqual({ x0: 0, y0: 8 })
    expect(spriteOrigin(128)).toEqual({ x0: 0, y0: 64 })
    expect(spriteOrigin(255)).toEqual({ x0: 120, y0: 120 })
  })

  it('flags the shared upper bank (128..255) as map-aliasing', () => {
    expect(spriteAliasesMap(0)).toBe(false)
    expect(spriteAliasesMap(127)).toBe(false)
    expect(spriteAliasesMap(128)).toBe(true)
    expect(spriteAliasesMap(255)).toBe(true)
  })

  it('base-bank sprites alias no map rows; shared-bank sprites alias 4 rows', () => {
    expect(mapRowsForSprite(0)).toBeUndefined()
    expect(mapRowsForSprite(127)).toBeUndefined()
    // sprite 128 sits at gfx row 64 -> map rows 32..35.
    expect(mapRowsForSprite(128)).toEqual({ start: 32, end: 36 })
    // sprite 255 sits at gfx row 120 -> map rows 60..63.
    expect(mapRowsForSprite(255)).toEqual({ start: 60, end: 64 })
  })
})

describe('MapData addressable region + overlap inspection', () => {
  it('reads a tile from the parsed map', () => {
    const cart = Cart.parse(fixture('full.p8'))
    const map = MapData.fromBody(cart.getSection('map'))
    expect(map.getTile(0, 0)).toBe(5) // fixture set tile (0,0) = 05
    expect(map.getTile(1, 0)).toBe(0)
  })

  it('map grid round-trips to the same __map__ body (identity)', () => {
    const cart = Cart.parse(fixture('full.p8'))
    const body = cart.getSection('map')
    if (body === undefined) throw new Error('fixture missing __map__')
    expect(MapData.fromBody(body).toBody()).toBe(body)
  })

  it('counts non-zero tiles across a row range (overlap primitive)', () => {
    const cart = Cart.parse(fixture('full.p8'))
    const map = MapData.fromBody(cart.getSection('map'))
    // Only tile (0,0) is non-zero, in row 0.
    expect(map.nonZeroTilesInRows(0, 1)).toBe(1)
    expect(map.nonZeroTilesInRows(1, 32)).toBe(0)
    // Shared-bank rows (>= 32) are not stored in text __map__, so zero.
    expect(map.nonZeroTilesInRows(32, 64)).toBe(0)
  })

  it('editing a tile and committing changes only __map__', () => {
    const text = fixture('full.p8')
    const cart = Cart.parse(text)
    const gfxBefore = cart.getSection('gfx')
    const map = MapData.fromBody(cart.getSection('map'))
    map.setTile(5, 5, 42)
    map.commit(cart)
    expect(MapData.fromBody(cart.getSection('map')).getTile(5, 5)).toBe(42)
    expect(cart.getSection('gfx')).toBe(gfxBefore)
  })

  it('rejects out-of-range map cells and tile values', () => {
    const map = MapData.fromBody(undefined)
    expect(() => map.getTile(-1, 0)).toThrow(CartRangeError)
    expect(() => map.setTile(0, 0, 256)).toThrow(CartRangeError)
    expect(() => map.getRow(32)).toThrow(CartRangeError)
  })
})
