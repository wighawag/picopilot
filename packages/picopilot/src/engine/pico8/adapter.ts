/**
 * The PICO-8 adapter SEAM: the typed interface `picopilot run` talks to, plus
 * the structured result shapes. Mirrors the `engine/shrinko` seam (ADR-0002):
 * the command layer never knows HOW PICO-8 is launched; it talks to
 * {@link Pico8Adapter}, and PICO-8 being ABSENT is a first-class value
 * (`{ok:false, reason:'pico8-not-found', ...}`), never a throw or a hollow
 * success. The v1 implementation shells out to the user's native `pico8 -x`
 * (see `shell.ts` and ADR-0006, native path first); a future web-export /
 * headless-browser implementation can satisfy the SAME interface.
 *
 * PICO-8 is a licensed, paid binary with no pip/npm install path, so absence is
 * a normal, well-signposted boundary (US #14, #19), mirroring shrinko-not-found.
 */

/** The remedy string in a pico8-not-found result: how the user makes `run` work. */
export const PICO8_REMEDY = 'set PICO8_PATH or install PICO-8' as const;

/** What `run` needs: the PICO-8 binary (a paid, licensed download; no package manager). */
export const PICO8_NEEDS = ['pico8'] as const;

/** The default done-sentinel: the cart prints this via `printh` to signal it is finished. */
export const DONE_SENTINEL = '__PICOPILOT_DONE__' as const;

/**
 * The structured "PICO-8 is not installed" failure (US #19, ADR-0006). Shape
 * mirrors {@link import('../shrinko/adapter.js').ShrinkoNotFound}: `ok:false`, a
 * machine-readable `reason`, the EXACT `remedy`, and the `needs` list. A command
 * maps it onto incur's `error({ code: reason, ... })` with a nonzero exit.
 */
export interface Pico8NotFound {
	readonly ok: false;
	readonly reason: 'pico8-not-found';
	readonly remedy: typeof PICO8_REMEDY;
	readonly needs: readonly string[];
}

/** Why a run ended: the cart signalled done, the backstop fired, or PICO-8 exited on its own. */
export type ExitReason = 'sentinel' | 'timeout' | 'exit';

/**
 * A completed run's collected results. `screenshots` are the PNG paths PICO-8
 * wrote into the run-controlled `-desktop` dir (via the cart's `extcmd("screen")`);
 * `printh` is the captured stdout (the cart's `printh` output plus PICO-8's own
 * lines); `exitReason` says how it ended.
 */
export interface RunReport {
	readonly screenshots: readonly string[];
	readonly printh: string;
	readonly exitReason: ExitReason;
}

/** A successful adapter call carrying the run report. */
export interface Pico8Ok {
	readonly ok: true;
	readonly value: RunReport;
}

/**
 * The result {@link Pico8Adapter.run} returns: either a {@link RunReport} or the
 * structured {@link Pico8NotFound}. Absence is a value, not a throw, so the
 * two-tier capability contract is total and type-checked at the call site.
 */
export type Pico8Result = Pico8Ok | Pico8NotFound;

/** Options for a single {@link Pico8Adapter.run}. */
export interface RunOptions {
	/** Absolute path to the `.p8` cart to run. */
	readonly cartPath: string;
	/** The run-controlled dir PICO-8 writes screenshots into (`-desktop <dir>`). */
	readonly shotDir: string;
	/** The stdout line that ends the run when matched (defaults to {@link DONE_SENTINEL}). */
	readonly sentinel?: string;
	/** The hard backstop in ms: kill PICO-8 if it neither signals nor exits by then. */
	readonly backstopMs: number;
}

/**
 * The PICO-8 capability seam. One method for now: {@link run}. Later PICO-8-gated
 * operations (`audio render`, `export`) extend THIS interface rather than forking.
 */
export interface Pico8Adapter {
	/**
	 * Launches PICO-8 on `cartPath`, streams stdout, ends the run on the sentinel
	 * (with the backstop as the safety net), and collects screenshots + printh +
	 * exit reason. Returns {@link Pico8NotFound} when PICO-8 is not installed.
	 */
	run(options: RunOptions): Promise<Pico8Result>;
}

/** The frozen {@link Pico8NotFound} value, so every call site returns the same shape. */
export function pico8NotFound(): Pico8NotFound {
	return {
		ok: false,
		reason: 'pico8-not-found',
		remedy: PICO8_REMEDY,
		needs: [...PICO8_NEEDS],
	};
}
