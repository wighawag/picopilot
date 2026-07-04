import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli } from 'incur'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CountReport, ShrinkoAdapter, ShrinkoResult } from '../engine/shrinko/index.js'
import { shrinkoNotFound } from '../engine/shrinko/index.js'
import { GATE_INCAPABLE_EXIT, type ShrinkoAdapterFactory, registerVerify } from './verify.js'

/** A well-formed cart: parses AND round-trips cleanly (passes integrity). */
const GOOD_CART = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n'

/**
 * A MALFORMED cart: no `version N` line after the header, so `Cart.parse`
 * throws a `missing-version` `CartParseError` and integrity fails.
 */
const MALFORMED_CART = 'pico-8 cartridge // http://www.pico-8.com\n__lua__\nprint("hi")\n'

let dir: string
let cartPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'picopilot-verify-'))
  cartPath = join(dir, 'main.p8')
  writeFileSync(cartPath, GOOD_CART)
})

afterEach(() => {
  try {
    execFileSync('rm', ['-rf', dir])
  } catch {
    // ignore
  }
})

/**
 * A stub {@link ShrinkoAdapter} standing in for a shrinko-present shell adapter
 * (or a native-TS one). It never spawns anything, so no test depends on shrinko
 * being installed. `count` returns whatever result the test wired.
 */
function stubAdapter(result: ShrinkoResult<CountReport>): ShrinkoAdapter {
  return {
    async count() {
      return result
    },
  }
}

/** A present-shrinko count: `over` picks an over-budget vs under-budget value. */
function present(over: boolean): ShrinkoResult<CountReport> {
  return {
    ok: true,
    value: over
      ? {
          tokens: 9001,
          tokensPct: 109,
          chars: 34000,
          charsPct: 52,
          compressed: 13000,
          compressedPct: 82,
        }
      : { tokens: 512, tokensPct: 6, chars: 1840, charsPct: 2, compressed: 980, compressedPct: 6 },
  }
}

/**
 * Drives `picopilot verify` through incur's `serve` DI with an INJECTED adapter
 * factory (the seam), capturing stdout + exit without the real environment or
 * binary. `--json` so the structured envelope is asserted directly.
 */
async function runVerify(
  factory: ShrinkoAdapterFactory,
  cart: string = cartPath,
  env: Record<string, string | undefined> = { PATH: '/does/not/matter' },
) {
  const cli = Cli.create('picopilot', { version: '0.0.0' })
  registerVerify(cli, factory)
  let stdout = ''
  let exitCode = 0
  await cli.serve(['verify', cart, '--json'], {
    stdout(s) {
      stdout += s
    },
    exit(code) {
      exitCode = code
    },
    env,
  })
  return { stdout, exitCode }
}

describe('picopilot verify: pass (integrity + tokens both green)', () => {
  it('returns one structured envelope with an overall pass and per-check results', async () => {
    const { stdout, exitCode } = await runVerify(() => stubAdapter(present(false)))
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.status).toBe('pass')
    expect(out.checks.integrity).toBe(true)
    expect(out.checks.tokens).toBe(true)
    expect(out.tokens).toBe(512)
    expect(out.budget).toBe(8192)
  })

  it('SELF-SCOPES: the envelope states it is static and passing does not mean the cart runs', async () => {
    const { stdout } = await runVerify(() => stubAdapter(present(false)))
    const out = JSON.parse(stdout)
    expect(out.scope.toLowerCase()).toContain('static')
    // The connotation guard: passing must NOT be claimed as "the cart runs".
    expect(out.scope.toLowerCase()).toContain('does not mean the cart runs')
  })

  it('green verify CTAs to `run` (well-formed → now confirm it boots)', async () => {
    const { stdout } = await runVerify(() => stubAdapter(present(false)))
    const out = JSON.parse(stdout)
    // incur prefixes the CLI name onto the CTA command.
    expect(out.cta.commands[0].command).toContain('run')
  })
})

describe('picopilot verify: fail (a static check flunked, nonzero exit)', () => {
  it('fails when tokens are over budget', async () => {
    const { stdout, exitCode } = await runVerify(() => stubAdapter(present(true)))
    expect(exitCode).toBe(1)
    const out = JSON.parse(stdout)
    expect(out.code).toBe('verify-failed')
    // NOT reported as pass, and NOT the gate-incapable code.
    expect(out.code).not.toBe('gate-incapable')
    expect(out.message).toContain('budget')
    // Still self-scopes on failure.
    expect(out.message.toLowerCase()).toContain('static')
  })

  it('fails when the cart is malformed (integrity), independent of PICO-8', async () => {
    writeFileSync(cartPath, MALFORMED_CART)
    const { stdout, exitCode } = await runVerify(() => stubAdapter(present(false)))
    expect(exitCode).toBe(1)
    const out = JSON.parse(stdout)
    expect(out.code).toBe('verify-failed')
    expect(out.message).toContain('integrity')
  })
})

describe('picopilot verify: gate-incapable (shrinko absent, the regression guard)', () => {
  it('shrinko absent → DISTINCT gate-incapable outcome with a nonzero exit, NEVER green', async () => {
    const { stdout, exitCode } = await runVerify(() => stubAdapter(shrinkoNotFound()))
    // Nonzero, and specifically the distinct gate-incapable exit code.
    expect(exitCode).not.toBe(0)
    expect(exitCode).toBe(GATE_INCAPABLE_EXIT)
    const out = JSON.parse(stdout)
    // A categorically DISTINCT outcome: not pass, not the ordinary fail.
    expect(out.code).toBe('gate-incapable')
    expect(out.code).not.toBe('verify-failed')
    // It names the missing capability + the remedy so the agent can enable it.
    expect(out.message).toContain('shrinko')
    expect(out.message).toContain('uv pip install shrinko')
  })

  it('REGRESSION GUARD: shrinko absent NEVER reports green, even for a perfect cart', async () => {
    // The cart is well-formed (integrity would pass). If verify ever let a clean
    // cart go green without checking tokens, THIS is the gate-as-theatre bug.
    const { stdout, exitCode } = await runVerify(() => stubAdapter(shrinkoNotFound()))
    expect(exitCode).not.toBe(0)
    const out = JSON.parse(stdout)
    // Must NOT be a success envelope: no `status: 'pass'`.
    expect(out.status).not.toBe('pass')
    expect(out.code).toBe('gate-incapable')
  })

  it('gate-incapable is a distinct exit code from fail (an agent can branch on it)', async () => {
    const incapable = await runVerify(() => stubAdapter(shrinkoNotFound()))
    const failed = await runVerify(() => stubAdapter(present(true)))
    expect(incapable.exitCode).toBe(GATE_INCAPABLE_EXIT)
    expect(failed.exitCode).toBe(1)
    expect(incapable.exitCode).not.toBe(failed.exitCode)
  })
})

describe('picopilot verify: no PICO-8 dependency (it never runs the cart)', () => {
  it('passes with no PICO8_PATH / pico8 anywhere in env (static gate)', async () => {
    // A bare env with only a PATH that has no pico8: verify still passes, proving
    // it never reaches for PICO-8.
    const { stdout, exitCode } = await runVerify(() => stubAdapter(present(false)), cartPath, {
      PATH: '/empty',
    })
    expect(exitCode).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.status).toBe('pass')
  })
})

describe('picopilot verify: a missing cart is a distinct error (not fail, not gate-incapable)', () => {
  it('errors with cart-not-found + nonzero exit when the cart path does not exist', async () => {
    const { stdout, exitCode } = await runVerify(
      () => stubAdapter(present(false)),
      join(dir, 'nope.p8'),
    )
    expect(exitCode).not.toBe(0)
    const out = JSON.parse(stdout)
    expect(out.code).toBe('cart-not-found')
  })
})
