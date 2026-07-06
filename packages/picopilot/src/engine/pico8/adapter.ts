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

/**
 * A completed audio-RECORDING run's results (ADR-0009). `wavPath` is the WAV the
 * cart wrote via `extcmd("audio_end", 1)` into the run-controlled folder (the
 * `audio_end(1)`-to-current-folder quirk, isolated to a temp `wavDir`), or
 * `undefined` if none was produced (e.g. a headless `-x` capture, which yields a
 * silent 0-frame file we treat as "no usable WAV", or a run that never recorded).
 * `printh` + `exitReason` mirror {@link RunReport}, so a recording is a run with a
 * WAV alongside the same run state.
 */
export interface RecordReport {
	readonly wavPath: string | undefined;
	readonly printh: string;
	readonly exitReason: ExitReason;
}

/** A successful audio-record call carrying the {@link RecordReport}. */
export interface Pico8RecordOk {
	readonly ok: true;
	readonly value: RecordReport;
}

/**
 * A completed DRIVE run's results (ADR-0011, `playtest`). Same shape family as
 * {@link RunReport}: `screenshots` are the PNGs the driven cart wrote at the SHOT
 * points (named `<basename>0.png`, ...), `printh` is the captured stdout (the
 * cart's ACKs + the done-sentinel + any cart printh), `exitReason` says how it
 * ended. A driven run is a run whose input + frame loop the harness owned.
 */
export interface DriveReport {
	readonly screenshots: readonly string[];
	readonly printh: string;
	readonly exitReason: ExitReason;
}

/** A successful drive call carrying the {@link DriveReport}. */
export interface Pico8DriveOk {
	readonly ok: true;
	readonly value: DriveReport;
}

/**
 * The result {@link Pico8Adapter.drive} returns: a {@link DriveReport} or the
 * structured {@link Pico8NotFound} (PICO-8 absent), mirroring {@link Pico8Result}.
 */
export type Pico8DriveResult = Pico8DriveOk | Pico8NotFound;

/**
 * Options for a single {@link Pico8Adapter.drive} (ADR-0011). The cart is the
 * THROWAWAY driven cart the drive-transform produced; `blocks` are the encoded
 * FIXED-SIZE command blocks piped to its live `-x` stdin (the load-bearing
 * transport: small unpadded writes coalesce/drop, so the whole block stream is
 * written up front for the one-shot). Screenshots land in `shotDir` (`-desktop`).
 */
export interface DriveOptions {
	/** Absolute path to the throwaway driven `.p8` cart to run. */
	readonly cartPath: string;
	/** The run-controlled dir PICO-8 writes screenshots into (`-desktop <dir>`). */
	readonly shotDir: string;
	/** The encoded fixed-size command blocks to pipe to the cart's stdin. */
	readonly blocks: Uint8Array;
	/** The stdout line that ends the run when matched (defaults to {@link DONE_SENTINEL}). */
	readonly sentinel?: string;
	/** The hard backstop in ms: kill PICO-8 if it neither signals nor exits by then. */
	readonly backstopMs: number;
}

/**
 * The result {@link Pico8Adapter.record} returns: a {@link RecordReport} or the
 * structured {@link Pico8NotFound} (PICO-8 absent), mirroring {@link Pico8Result}.
 */
export type Pico8RecordResult = Pico8RecordOk | Pico8NotFound;

/**
 * Options for a single {@link Pico8Adapter.record} (ADR-0009). The recorded cart
 * is expected to COOPERATE: at start it does `extcmd("set_filename", <base>)` +
 * `extcmd("audio_rec")`, and when finished `extcmd("audio_end", 1)` (save to the
 * current folder) then `printh` the sentinel. For `audio record <cart>` the
 * caller injects that harness around the user's cart; for `audio render` the
 * whole harness cart is built by {@link import('./harness.js')}.
 */
export interface RecordOptions {
	/** Absolute path to the `.p8` cart to run and record. */
	readonly cartPath: string;
	/**
	 * The run-controlled folder PICO-8 records the WAV into. Because
	 * `extcmd("audio_end", 1)` saves to PICO-8's CURRENT folder (NOT `-desktop`),
	 * the adapter points PICO-8's `root_path` here so the WAV lands in an isolated
	 * temp dir, never `~/Desktop` or the carts root (the shared-write discipline).
	 */
	readonly wavDir: string;
	/**
	 * The base filename (no extension) the cart passed to `extcmd("set_filename")`,
	 * so the adapter knows which `<base>.wav` to collect. Defaults to
	 * {@link RECORD_WAV_BASENAME} when omitted.
	 */
	readonly wavBasename?: string;
	/** The stdout line that ends the run when matched (defaults to {@link DONE_SENTINEL}). */
	readonly sentinel?: string;
	/** The hard backstop in ms: kill PICO-8 if it neither signals nor exits by then. */
	readonly backstopMs: number;
}

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
	/**
	 * Optional one-shot scripted input passed as `-p <input>`; the cart reads it
	 * via `stat(6)` and replays it (the canned-playtest channel). The cart must
	 * cooperate by decoding `stat(6)` (taught in the `picopilot-debug` skill).
	 * Absent = no input passed.
	 */
	readonly input?: string;
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

	/**
	 * Launches PICO-8 on `cartPath` in a REAL audio+video session (NOT headless
	 * `-x`, which mixes no audio and yields an empty WAV, ADR-0009), streams
	 * stdout, ends on the sentinel (backstop as the net), and collects the WAV the
	 * cooperating cart wrote via `audio_rec`/`audio_end(1)`. Returns
	 * {@link Pico8NotFound} when PICO-8 is not installed. Live capture is a
	 * manual/opt-in tier; CI drives a fake runner + the absent boundary.
	 */
	record(options: RecordOptions): Promise<Pico8RecordResult>;

	/**
	 * Launches PICO-8 on the THROWAWAY driven cart (`-desktop <shotDir> -x`),
	 * pipes the encoded FIXED-SIZE command blocks to its live stdin (the input +
	 * frame-loop transport, ADR-0011), ends on the sentinel (backstop as the net),
	 * and collects the SHOT screenshots + printh + exit reason. Returns
	 * {@link Pico8NotFound} when PICO-8 is absent. Live drive-and-capture is a
	 * manual/opt-in tier; CI drives a fake runner + the absent boundary.
	 */
	drive(options: DriveOptions): Promise<Pico8DriveResult>;
}

/** The default WAV basename a recorded cart passes to `extcmd("set_filename")`. */
export const RECORD_WAV_BASENAME = 'picopilot-audio' as const;

/** The 60 audio ticks PICO-8 advances per second: the record-duration unit (finding). */
export const PICO8_TICKS_PER_SECOND = 120;

/** The video frames PICO-8 runs per second (`_update` at 30fps; `t` counts frames). */
export const PICO8_FRAMES_PER_SECOND = 30;

/** The frozen {@link Pico8NotFound} value, so every call site returns the same shape. */
export function pico8NotFound(): Pico8NotFound {
	return {
		ok: false,
		reason: 'pico8-not-found',
		remedy: PICO8_REMEDY,
		needs: [...PICO8_NEEDS],
	};
}
