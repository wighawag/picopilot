import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GfxSheet } from '../engine/cart/index.js'
import { defaultConfigFile } from '../engine/config/index.js'
import { nibblesToGrid, PICO8_PALETTE } from '../engine/gfx/index.js'
import { createCli } from '../cli.js'

/** Decodes a PNG file into its raw RGB pixels (node's independent inflate). */
function decodePngFile(path: string): {
  width: number
  height: number
  pixel(x: number, y: number): [number, number, number]
} {
  const bytes = new Uint8Array(readFileSync(path))
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
  return {
    width,
    height,
    pixel(x, y) {
      const base = y * (stride + 1) + 1 + x * 3
      return [raw[base]!, raw[base + 1]!, raw[base + 2]!]
    },
  }
}

function rgbOf(index: number): [number, number, number] {
  const c = PICO8_PALETTE[index]!
  return [c.r, c.g, c.b]
}

/** A minimal valid cart with an empty (all-zero) __gfx__ section. */
function cartText(gfxBody?: string): string {
  const header = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n'
  if (gfxBody === undefined) return header
  return `${header}__gfx__\n${gfxBody}`
}

let dir: string
let cartPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'picopilot-gfx-'))
  cartPath = join(dir, 'main.p8')
})

afterEach(() => {
  try {
    execFileSync('rm', ['-rf', dir])
  } catch {
    // ignore
  }
})

/** Drives a `picopilot gfx ...` invocation through incur's serve DI. */
async function runGfx(argv: string[]) {
  let stdout = ''
  let exitCode = 0
  await createCli().serve(argv, {
    stdout(s) {
      stdout += s
    },
    exit(code) {
      exitCode = code
    },
    env: {},
  })
  return { stdout, exitCode }
}

/** Writes a cart whose sprite `n` is painted from `grid` (8x8 nibbles), rest zero. */
function writeCartWithSprite(n: number, grid: number[][]): void {
  const sheet = GfxSheet.fromBody(undefined)
  sheet.setSprite(n, grid)
  writeFileSync(cartPath, cartText(sheet.toBody()))
}

/** An 8x8 nibble grid from a generator. */
function makeGrid(fn: (r: number, c: number) => number): number[][] {
  return Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => fn(r, c)))
}

describe('picopilot gfx show', () => {
  it('renders a painted sprite to a char grid and CTAs to `gfx set`', async () => {
    const painted = makeGrid((r, c) => (r * 8 + c) % 16)
    writeCartWithSprite(5, painted)

    const { stdout, exitCode } = await runGfx(['gfx', 'show', '5', cartPath, '--json'])
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.sprite).toBe(5)
    // The grid matches the codec's rendering of the painted sprite.
    expect(out.grid).toBe(nibblesToGrid(painted))
    expect(out.aliasesMap).toBe(false)
    // CTA leads to `gfx set` for the fix step.
    expect(JSON.stringify(out.cta)).toContain('gfx set 5')
  })

  it('flags aliasesMap = true for a 128-255 sprite', async () => {
    writeFileSync(cartPath, cartText())
    const { stdout } = await runGfx(['gfx', 'show', '200', cartPath, '--json'])
    expect(JSON.parse(stdout).aliasesMap).toBe(true)
  })
})

describe('picopilot gfx set: base-bank sprite (0-127) always succeeds', () => {
  it('writes the grid back into __gfx__ and reports success', async () => {
    writeFileSync(cartPath, cartText())
    const grid = nibblesToGrid(makeGrid((r, c) => (r === c ? 8 : 0)))

    const { stdout, exitCode } = await runGfx(['gfx', 'set', '3', grid, cartPath, '--json'])
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.sprite).toBe(3)
    expect(out.aliasesMap).toBe(false)
    expect(out.overwroteSharedData).toBe(false)

    // The pixels are actually persisted: read them back.
    const sheet = GfxSheet.fromBody(
      (readFileSync(cartPath, 'utf8').match(/__gfx__\n([\s\S]*)/) ?? [])[1],
    )
    expect(nibblesToGrid(sheet.getSprite(3))).toBe(grid)
  })

  it('leaves every OTHER section byte-identical (only __gfx__ changes)', async () => {
    writeFileSync(cartPath, cartText())
    const before = readFileSync(cartPath, 'utf8')
    const grid = nibblesToGrid(makeGrid(() => 1))
    await runGfx(['gfx', 'set', '0', grid, cartPath, '--json'])
    const after = readFileSync(cartPath, 'utf8')
    // The lua section + header are unchanged; only gfx was added/updated.
    expect(after).toContain('print("hi")')
    expect(before.slice(0, before.indexOf('__lua__'))).toBe(
      after.slice(0, after.indexOf('__lua__')),
    )
  })
})

describe('picopilot gfx set: shared-bank sprite (128-255) smart-refuse (ADR-0004)', () => {
  it('empty (all-zero) target → succeeds and NOTES the aliasing', async () => {
    writeFileSync(cartPath, cartText())
    const grid = nibblesToGrid(makeGrid(() => 2))

    const { stdout, exitCode } = await runGfx(['gfx', 'set', '130', grid, cartPath, '--json'])
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.aliasesMap).toBe(true)
    expect(out.overwroteSharedData).toBe(false)
    expect(out.note).toContain('shared map region')
    // Persisted.
    const sheet = GfxSheet.fromBody(
      (readFileSync(cartPath, 'utf8').match(/__gfx__\n([\s\S]*)/) ?? [])[1],
    )
    expect(nibblesToGrid(sheet.getSprite(130))).toBe(grid)
  })

  it('data present + unauthorised → structured map-overlap refusal + nonzero exit', async () => {
    // Paint sprite 130 non-zero: the shared region already holds data.
    writeCartWithSprite(
      130,
      makeGrid((r, c) => (r === 0 && c === 0 ? 7 : 0)),
    )
    const grid = nibblesToGrid(makeGrid(() => 3))

    const { stdout, exitCode } = await runGfx(['gfx', 'set', '130', grid, cartPath, '--json'])
    expect(exitCode).not.toBe(0)
    const out = JSON.parse(stdout)
    // incur error envelope: code is the machine handle; detail + remedy in message.
    expect(out.code).toBe('map-overlap')
    expect(out.message).toContain('sprite 130')
    expect(out.message).toContain('--allow-map-overlap')
    expect(out.message).toContain('allowMapOverlap')
    // The CTA points at the authorised re-run.
    expect(JSON.stringify(out.cta)).toContain('--allow-map-overlap')
  })

  it('REGRESSION GUARD: a refusal leaves the sprite __gfx__ bytes BYTE-UNCHANGED', async () => {
    writeCartWithSprite(
      130,
      makeGrid((r, c) => (r === 0 && c === 0 ? 7 : 0)),
    )
    const before = readFileSync(cartPath, 'utf8')

    const grid = nibblesToGrid(makeGrid(() => 3))
    const { exitCode } = await runGfx(['gfx', 'set', '130', grid, cartPath, '--json'])
    expect(exitCode).not.toBe(0)

    // The silent-corruption guard: the WHOLE cart file is byte-identical.
    const after = readFileSync(cartPath, 'utf8')
    expect(after).toBe(before)
  })

  it('data present + --allow-map-overlap flag → succeeds, overwrites, reports it', async () => {
    writeCartWithSprite(
      130,
      makeGrid((r, c) => (r === 0 && c === 0 ? 7 : 0)),
    )
    const grid = nibblesToGrid(makeGrid(() => 4))

    const { stdout, exitCode } = await runGfx([
      'gfx',
      'set',
      '130',
      grid,
      cartPath,
      '--allow-map-overlap',
      '--json',
    ])
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.overwroteSharedData).toBe(true)
    expect(out.note).toContain('authorised')
    // The new pixels replaced the old.
    const sheet = GfxSheet.fromBody(
      (readFileSync(cartPath, 'utf8').match(/__gfx__\n([\s\S]*)/) ?? [])[1],
    )
    expect(nibblesToGrid(sheet.getSprite(130))).toBe(grid)
  })

  it('data present + allowMapOverlap in picopilot.json → succeeds (config authorisation)', async () => {
    writeCartWithSprite(
      130,
      makeGrid((r, c) => (r === 0 && c === 0 ? 7 : 0)),
    )
    // Author a config that authorises overlap.
    const cfg = JSON.parse(defaultConfigFile())
    cfg.commands.gfx.commands.set.options.allowMapOverlap = true
    const cfgPath = join(dir, 'picopilot.json')
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)

    const grid = nibblesToGrid(makeGrid(() => 5))
    const { stdout, exitCode } = await runGfx([
      'gfx',
      'set',
      '130',
      grid,
      cartPath,
      '--config',
      cfgPath,
      '--json',
    ])
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).overwroteSharedData).toBe(true)
  })
})

describe('picopilot gfx set: input validation never touches the cart', () => {
  it('a malformed grid is rejected with a nonzero exit and no write', async () => {
    writeFileSync(cartPath, cartText())
    const before = readFileSync(cartPath, 'utf8')
    // Only 3 rows: malformed.
    const { stdout, exitCode } = await runGfx([
      'gfx',
      'set',
      '3',
      '...\n...\n...',
      cartPath,
      '--json',
    ])
    expect(exitCode).not.toBe(0)
    expect(JSON.parse(stdout).code).toBe('invalid-grid')
    expect(readFileSync(cartPath, 'utf8')).toBe(before)
  })

  it('a missing cart is a distinct cart-not-found error', async () => {
    const grid = nibblesToGrid(makeGrid(() => 0))
    const { stdout, exitCode } = await runGfx([
      'gfx',
      'set',
      '3',
      grid,
      join(dir, 'nope.p8'),
      '--json',
    ])
    expect(exitCode).not.toBe(0)
    expect(JSON.parse(stdout).code).toBe('cart-not-found')
  })
})

describe('picopilot gfx render: the JUDGE surface (upscaled palette-accurate PNG)', () => {
  it('renders a sprite to an upscaled PNG with the CORRECT palette RGB per index', async () => {
    // Paint sprite 5 so pixel (c, r) = index (r*8 + c) % 16 (every colour used).
    const painted = makeGrid((r, c) => (r * 8 + c) % 16)
    writeCartWithSprite(5, painted)

    const { stdout, exitCode } = await runGfx(['gfx', 'render', '5', cartPath, '--json'])
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)

    // Reports the PNG path AND the grid (so the skill can pick view-vs-imagine).
    expect(out.png).toContain('main-sprite-5.png')
    expect(existsSync(out.png)).toBe(true)
    expect(out.grid).toBe(nibblesToGrid(painted))
    expect(out.target).toBe('5')
    expect(out.width).toBe(256)
    expect(out.height).toBe(256)

    // Assert PIXEL BYTES: the centre of each 8x8-source block is that index's
    // exact palette RGB (32x nearest-neighbour upscale).
    const img = decodePngFile(out.png)
    expect(img.width).toBe(256)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const index = (r * 8 + c) % 16
        expect(img.pixel(c * 32 + 16, r * 32 + 16)).toEqual(rgbOf(index))
      }
    }
  })

  it('renders the whole `sheet` similarly (256x256, palette-accurate)', async () => {
    const sheet = GfxSheet.fromBody(undefined)
    sheet.setSprite(
      0,
      makeGrid(() => 8),
    ) // red top-left
    sheet.setSprite(
      255,
      makeGrid(() => 10),
    ) // yellow bottom-right
    writeFileSync(cartPath, cartText(sheet.toBody()))

    const { stdout, exitCode } = await runGfx(['gfx', 'render', 'sheet', cartPath, '--json'])
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.target).toBe('sheet')
    expect(out.png).toContain('main-sheet.png')
    expect(out.grid).toBeUndefined() // a sheet has no single 8x8 grid
    expect(out.width).toBe(256)

    const img = decodePngFile(out.png)
    expect(img.width).toBe(256)
    expect(img.pixel(0, 0)).toEqual(rgbOf(8)) // sprite 0 top-left
    expect(img.pixel(255, 255)).toEqual(rgbOf(10)) // sprite 255 bottom-right
  })

  it('wires the CTA loop render -> set -> render', async () => {
    writeFileSync(cartPath, cartText())
    const { stdout } = await runGfx(['gfx', 'render', '7', cartPath, '--json'])
    const cta = JSON.stringify(JSON.parse(stdout).cta)
    expect(cta).toContain('gfx set 7')
    expect(cta).toContain('gfx render 7')
  })

  it('flags aliasesMap = true for a rendered 128-255 sprite', async () => {
    writeFileSync(cartPath, cartText())
    const { stdout } = await runGfx(['gfx', 'render', '200', cartPath, '--json'])
    expect(JSON.parse(stdout).aliasesMap).toBe(true)
  })

  it('honours an explicit --out path', async () => {
    writeFileSync(cartPath, cartText())
    const outPath = join(dir, 'custom.png')
    const { stdout, exitCode } = await runGfx([
      'gfx',
      'render',
      '0',
      cartPath,
      '--out',
      outPath,
      '--json',
    ])
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).png).toBe(outPath)
    expect(existsSync(outPath)).toBe(true)
  })

  it('rejects a bad target with a nonzero exit and writes no file', async () => {
    writeFileSync(cartPath, cartText())
    const { stdout, exitCode } = await runGfx(['gfx', 'render', 'nope', cartPath, '--json'])
    expect(exitCode).not.toBe(0)
    expect(JSON.parse(stdout).code).toBe('invalid-target')
    expect(existsSync(join(dir, 'main-sprite-nope.png'))).toBe(false)
  })

  it('a missing cart is a distinct cart-not-found error', async () => {
    const { stdout, exitCode } = await runGfx([
      'gfx',
      'render',
      '0',
      join(dir, 'nope.p8'),
      '--json',
    ])
    expect(exitCode).not.toBe(0)
    expect(JSON.parse(stdout).code).toBe('cart-not-found')
  })
})
