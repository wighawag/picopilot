/**
 * The shrinko adapter seam: how every shrinko-backed command reaches shrinko8.
 *
 * `adapter.ts` is the command-facing CONTRACT (the {@link ShrinkoAdapter}
 * interface, the {@link ShrinkoResult} discriminated union, the structured
 * {@link ShrinkoNotFound} value, and the `--count` parser). `shell.ts` is the v1
 * IMPLEMENTATION that shells out to a user-installed Python `shrinko8`
 * (ADR-0001). A future native-TS implementation implements the same interface
 * and drops in without touching the command layer.
 */
export {
  type CountReport,
  parseCount,
  SHRINKO_NEEDS,
  SHRINKO_REMEDY,
  type ShrinkoAdapter,
  type ShrinkoNotFound,
  shrinkoNotFound,
  type ShrinkoOk,
  ShrinkoParseError,
  type ShrinkoResult,
} from './adapter.js'
export {
  type ChildResult,
  type ChildRunner,
  execFileRunner,
  ShellShrinkoAdapter,
  type ShellShrinkoOptions,
} from './shell.js'
