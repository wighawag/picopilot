import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli, z } from 'incur'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Cart } from '../engine/cart/index.js'
import { readAllowMapOverlap } from '../engine/config/index.js'
import { createCli } from '../cli.js'

/**
 * Drives `picopilot init <dir>` through incur's `serve` DI, capturing stdout and
 * the exit code without touching the real process env. The command writes only
 * inside `dir` (a temp dir here), so this exercises the real scaffold I/O in
 * isolation.
 */
async function runInit(argv: string[]) {
  let stdout = ''
  let exitCode = 0
  await createCli().serve(argv, {
    stdout(s) {
      stdout += s
    },
    exit(code) {
      exitCode = code
    },
    // An EMPTY env: proves init needs nothing from the environment and, with a
    // real command, that no shared-dir env (HOME/skills) is consulted.
    env: {},
  })
  return { stdout, exitCode }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'picopilot-init-'))
})

afterEach(() => {
  // Best-effort cleanup; a leftover temp dir must never fail the suite.
  try {
    execFileSync('rm', ['-rf', dir])
  } catch {
    // ignore
  }
})

describe('picopilot init: scaffold output', () => {
  it('writes EXACTLY the four scaffold files, nothing else', async () => {
    const { exitCode } = await runInit(['init', dir])
    expect(exitCode).toBe(0)
    expect(readdirSync(dir).sort()).toEqual(
      ['AGENTS.md', 'main.lua', 'main.p8', 'picopilot.json'].sort(),
    )
  })

  it('reports the written files and the absolute dir', async () => {
    const { stdout } = await runInit(['init', dir])
    expect(stdout).toContain('main.p8')
    expect(stdout).toContain('main.lua')
    expect(stdout).toContain('AGENTS.md')
    expect(stdout).toContain('picopilot.json')
    expect(stdout).toContain(dir)
  })

  it('main.p8 is a valid cart whose only code is `#include main.lua`', async () => {
    await runInit(['init', dir])
    const text = readFileSync(join(dir, 'main.p8'), 'utf8')
    const cart = Cart.parse(text)
    // Round-trips through the cart model (identity).
    expect(cart.serialize()).toBe(text)
    // __lua__ holds exactly the include line and nothing else.
    expect(cart.getSection('lua')?.trim()).toBe('#include main.lua')
    // No hand-written binary sections in a fresh cart.
    expect(cart.hasSection('gfx')).toBe(false)
    expect(cart.hasSection('map')).toBe(false)
  })

  it('main.lua is the plain-Lua edit surface with the _init/_update/_draw loop', async () => {
    await runInit(['init', dir])
    const lua = readFileSync(join(dir, 'main.lua'), 'utf8')
    expect(lua).toContain('function _init()')
    expect(lua).toContain('function _update()')
    expect(lua).toContain('function _draw()')
    // main.lua must NOT be a .p8 (no cart header / section markers).
    expect(lua).not.toContain('pico-8 cartridge')
    expect(lua).not.toContain('__lua__')
  })
})

describe('picopilot init: AGENTS.md carries the curated PICO-8 reference', () => {
  let agents: string

  beforeEach(async () => {
    await runInit(['init', dir])
    agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  })

  it('carries the execution loop', () => {
    expect(agents).toContain('_init()')
    expect(agents).toContain('_update()')
    expect(agents).toContain('_draw()')
  })

  it('carries the fixed 16-colour palette with real RGB values', () => {
    // A palette entry the gfx render encoder depends on (red = 255,0,77).
    expect(agents).toMatch(/red/)
    expect(agents).toContain('255')
    expect(agents).toContain('77')
    // The transparent/index legend.
    expect(agents).toMatch(/`\.`\s*=\s*transparent/)
  })

  it('carries the memory map AND the gfx/map overlap warning', () => {
    expect(agents).toContain('0x1000')
    expect(agents).toContain('0x6000')
    expect(agents.toLowerCase()).toContain('overlap')
    expect(agents).toContain('128..255')
    expect(agents).toMatch(/__map__` rows 32\.\.63/)
  })

  it('carries the most-used, grouped API', () => {
    expect(agents).toContain('spr(')
    expect(agents).toContain('btn(')
    expect(agents).toContain('sfx(')
    expect(agents).toContain('printh')
  })

  it('carries the token discipline (8192 budget + shorthands)', () => {
    expect(agents).toContain('8192')
    expect(agents).toContain('picopilot tokens')
    expect(agents).toContain('picopilot minify')
    // A PICO-8 shorthand the reference teaches.
    expect(agents).toContain('+=')
  })

  it('carries the `#include` discipline (edit main.lua, not the binary sections)', () => {
    expect(agents).toContain('#include main.lua')
    expect(agents).toContain('main.lua')
  })
})

describe('picopilot init: INSTRUCT, not mutate (no VCS, prints tips)', () => {
  it('does NOT run git init: no .git in the scaffolded folder', async () => {
    await runInit(['init', dir])
    expect(existsSync(join(dir, '.git'))).toBe(false)
  })

  it('PRINTS a skills-discovery tip and a git init tip', async () => {
    const { stdout } = await runInit(['init', dir])
    expect(stdout.toLowerCase()).toContain('skills')
    expect(stdout).toContain('--install-skills')
    expect(stdout).toContain('git init')
  })
})

describe('picopilot init: shared-write isolation (default has no shared write)', () => {
  it('writes NOTHING outside the target folder', async () => {
    // Sentinels OUTSIDE the cart dir: a sibling temp dir standing in for the
    // real home / a shared config location. Default `init` must not touch them.
    const outside = mkdtempSync(join(tmpdir(), 'picopilot-outside-'))
    const sentinel = join(outside, 'DO-NOT-TOUCH')
    writeFileSync(sentinel, 'untouched')
    const beforeOutside = readdirSync(outside).sort()

    try {
      await runInit(['init', dir])
      // The sentinel folder is byte-for-byte the same (no new files, sentinel intact).
      expect(readdirSync(outside).sort()).toEqual(beforeOutside)
      expect(readFileSync(sentinel, 'utf8')).toBe('untouched')
      // And the only new entries are inside the cart dir.
      expect(readdirSync(dir).sort()).toEqual(
        ['AGENTS.md', 'main.lua', 'main.p8', 'picopilot.json'].sort(),
      )
    } finally {
      execFileSync('rm', ['-rf', outside])
    }
  })

  it('refuses to overwrite an existing scaffold file (nonzero exit, no clobber)', async () => {
    const existing = join(dir, 'main.lua')
    writeFileSync(existing, 'MY WORK, do not clobber')
    const { exitCode } = await runInit(['init', dir])
    expect(exitCode).not.toBe(0)
    // The pre-existing file is untouched.
    expect(readFileSync(existing, 'utf8')).toBe('MY WORK, do not clobber')
  })
})

describe('picopilot.json: schema shape + incur config read (argv > config > default)', () => {
  it('scaffolds a valid picopilot.json carrying allowMapOverlap = false', async () => {
    await runInit(['init', dir])
    const raw = readFileSync(join(dir, 'picopilot.json'), 'utf8')
    const parsed = JSON.parse(raw)
    // The gfx/map-overlap authorisation key lives where incur's config layer
    // reads a `gfx set` option default.
    expect(parsed.commands.gfx.commands.set.options.allowMapOverlap).toBe(false)
    // The reader helper agrees.
    expect(readAllowMapOverlap(parsed)).toBe(false)
  })

  it('feeds incur config → option default (config overrides zod default)', async () => {
    await runInit(['init', dir])
    // Hand-set the config to true, mirroring an agent authorising overlap.
    const cfgPath = join(dir, 'picopilot.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    cfg.commands.gfx.commands.set.options.allowMapOverlap = true
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)

    const seen = await readOverlapViaIncur(cfgPath)
    // zod default is false; the config file wins.
    expect(seen).toBe(true)
  })

  it('argv beats config (argv > config)', async () => {
    await runInit(['init', dir])
    // Scaffolded config is false; --no-allow-map-overlap-style not needed:
    // pass the flag true on argv while config stays false, argv must win... and
    // the reverse: config true, flag false.
    const cfgPath = join(dir, 'picopilot.json')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    cfg.commands.gfx.commands.set.options.allowMapOverlap = true
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)

    // config = true, but argv explicitly disables -> argv wins (false).
    const seen = await readOverlapViaIncur(cfgPath, ['--no-allowMapOverlap'])
    expect(seen).toBe(false)
  })
})

/**
 * Builds a throwaway CLI whose only command mirrors how `gfx set` will read
 * `allowMapOverlap`: a boolean option defaulting to false, resolved through
 * incur's config layer against the scaffolded `picopilot.json`. Proves the
 * scaffolded file's SHAPE actually drives incur's `argv > config > default`
 * precedence, not just that a helper can parse it.
 */
async function readOverlapViaIncur(configPath: string, extraArgv: string[] = []): Promise<boolean> {
  const cli = Cli.create('picopilot', {
    version: '0.0.0',
    config: { flag: 'config', files: ['picopilot.json'] },
  })
  // Mount `gfx set` so its config path is commands.gfx.commands.set.options.
  const gfx = Cli.create('gfx')
  gfx.command('set', {
    description: 'test stand-in for the real gfx set',
    options: z.object({
      allowMapOverlap: z.boolean().default(false),
    }),
    output: z.object({ allowMapOverlap: z.boolean() }),
    run({ options }) {
      return { allowMapOverlap: options.allowMapOverlap }
    },
  })
  cli.command(gfx as never)

  let stdout = ''
  await cli.serve(['gfx', 'set', '--config', configPath, ...extraArgv, '--json'], {
    stdout(s) {
      stdout += s
    },
    exit() {},
    env: {},
  })
  const parsed = JSON.parse(stdout) as { allowMapOverlap: boolean }
  return parsed.allowMapOverlap
}
