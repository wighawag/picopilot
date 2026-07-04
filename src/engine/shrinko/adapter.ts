/**
 * The shrinko adapter SEAM: a typed interface every shrinko-backed command
 * (`tokens`, and later `lint`, `minify`, `gfx import/export`, `verify`) talks
 * to, plus the discriminated result shape they all return.
 *
 * The seam exists so the command layer never knows HOW shrinko is reached. The
 * v1 implementation shells out to a user-installed Python `shrinko8` (see
 * `shell.ts` and ADR-0001); a future native-TS implementation can implement the
 * SAME {@link ShrinkoAdapter} interface and drop in without touching a single
 * command. The command-facing contract is entirely in this file.
 *
 * The two-tier capability contract (ADR-0002) lives in the RESULT type: every
 * adapter method returns a {@link ShrinkoResult}, a discriminated union of a
 * success value OR the structured {@link ShrinkoNotFound} failure. Absent
 * shrinko is therefore NOT an exception a command must try/catch, it is a
 * first-class `{ok:false, reason:'shrinko-not-found', ...}` value a command maps
 * onto incur's error envelope with a nonzero exit. Never a crash, never a hollow
 * success.
 */

/** The PyPI package name in the remedy: `uv pip install shrinko` (NOT `shrinko8`). */
export const SHRINKO_REMEDY = 'uv pip install shrinko' as const

/** What shrinko needs to run: Python 3.8+ (the module is `shrinko8`). */
export const SHRINKO_NEEDS = ['python>=3.8'] as const

/**
 * The structured "shrinko is not installed" failure (ADR-0002). Its shape is
 * fixed by the prd's two-tier contract (US #17): `ok:false`, a machine-readable
 * `reason`, the EXACT `remedy` string, and the `needs` list. A command turns
 * this into an incur `error({ code: reason, ... })` with a nonzero exit.
 */
export interface ShrinkoNotFound {
  readonly ok: false
  readonly reason: 'shrinko-not-found'
  /** The EXACT remedy: `uv pip install shrinko` (package is `shrinko`, module `shrinko8`). */
  readonly remedy: typeof SHRINKO_REMEDY
  /** Prerequisites the remedy assumes are present. */
  readonly needs: readonly string[]
}

/** A successful adapter call carrying the parsed value. */
export interface ShrinkoOk<T> {
  readonly ok: true
  readonly value: T
}

/**
 * The result every {@link ShrinkoAdapter} method returns: either a parsed value
 * or the structured {@link ShrinkoNotFound}. Absence is a value, not a throw, so
 * the two-tier contract is total and type-checked at every call site.
 */
export type ShrinkoResult<T> = ShrinkoOk<T> | ShrinkoNotFound

/**
 * The parsed `--count` report (US #3). `tokens`/`chars`/`compressed` are the
 * raw counts shrinko prints; `pct` fields are shrinko's own reported
 * percentages (its `--count` prints `tokens: 8053 98%`, i.e. against PICO-8's
 * limits), preserved verbatim so a command can show them without recomputing.
 * `compressed`/`compressedPct` are optional because shrinko omits the
 * compressed line for input formats where it does not apply.
 */
export interface CountReport {
  readonly tokens: number
  readonly tokensPct: number
  readonly chars: number
  readonly charsPct: number
  readonly compressed: number | undefined
  readonly compressedPct: number | undefined
}

/**
 * The shrinko capability seam. One method per shrinko-backed operation; only
 * `count` exists in this task, the rest (lint, minify, convert) land with their
 * commands and extend THIS interface rather than forking a new one.
 *
 * Every method is async (the shell-out is async) and returns a
 * {@link ShrinkoResult}, so absence is handled uniformly at each seam.
 */
export interface ShrinkoAdapter {
  /**
   * Runs shrinko's `--count` on the cart at `cartPath` and parses the
   * `tokens/chars/compressed` report. Returns {@link ShrinkoNotFound} when
   * shrinko is not installed.
   */
  count(cartPath: string): Promise<ShrinkoResult<CountReport>>
}

/** The frozen {@link ShrinkoNotFound} value, so every call site returns the same shape. */
export function shrinkoNotFound(): ShrinkoNotFound {
  return {
    ok: false,
    reason: 'shrinko-not-found',
    remedy: SHRINKO_REMEDY,
    needs: [...SHRINKO_NEEDS],
  }
}

/**
 * Parses shrinko's `--count` output into a {@link CountReport}.
 *
 * shrinko prints lines like:
 *
 * ```
 * tokens: 8053 98%
 * chars: 30320 46%
 * compressed: 12176 77%
 * ```
 *
 * (the compressed line is absent for some input formats). Parsing is
 * line-oriented and tolerant of surrounding output/whitespace: it scans for the
 * `tokens:`/`chars:`/`compressed:` labels anywhere in the combined stdout+stderr
 * and pulls the count and percentage off each. Throws if the required
 * `tokens:`/`chars:` lines are missing, so a shrinko that ran but produced
 * unparseable output surfaces as a real error rather than a silent zero.
 */
export function parseCount(output: string): CountReport {
  const line = (label: string): { n: number; pct: number } | undefined => {
    // `label: <count> <pct>%` — count and percent may be separated by any run
    // of spaces; the `%` is optional-tolerant but shrinko always prints it.
    const re = new RegExp(`^\\s*${label}:\\s*(\\d+)\\s+(\\d+)\\s*%`, 'm')
    const m = re.exec(output)
    if (m === null) return undefined
    return { n: Number(m[1]), pct: Number(m[2]) }
  }

  const tokens = line('tokens')
  const chars = line('chars')
  if (tokens === undefined || chars === undefined) {
    throw new ShrinkoParseError(
      `could not parse shrinko --count output (missing tokens/chars lines):\n${output}`,
    )
  }
  const compressed = line('compressed')

  return {
    tokens: tokens.n,
    tokensPct: tokens.pct,
    chars: chars.n,
    charsPct: chars.pct,
    compressed: compressed?.n,
    compressedPct: compressed?.pct,
  }
}

/**
 * Thrown when shrinko RAN but its output could not be parsed (a shrinko
 * version/format drift), distinct from shrinko being ABSENT (which is the
 * structured {@link ShrinkoNotFound} value, not a throw). Commands surface this
 * as a `shrinko-failed` error, separate from `shrinko-not-found`.
 */
export class ShrinkoParseError extends Error {
  override readonly name = 'ShrinkoParseError'
}
