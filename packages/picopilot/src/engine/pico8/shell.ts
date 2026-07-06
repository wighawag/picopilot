import {spawn} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {
	type DriveOptions,
	type ExitReason,
	type Pico8Adapter,
	pico8NotFound,
	type Pico8DriveResult,
	type Pico8RecordResult,
	type Pico8Result,
	RECORD_WAV_BASENAME,
	type RecordOptions,
	type RunOptions,
} from './adapter.js';
import {SentinelWatcher} from './sentinel.js';

/**
 * A spawned PICO-8 process, abstracted so tests inject a fake. `onStdout`
 * delivers stdout chunks (both `stdout` and `stderr` folded in, since PICO-8's
 * `printh` and its own lines can land on either); `onClose` fires when the
 * process exits on its own; `onError` fires on a spawn failure (ENOENT ⇒ PICO-8
 * absent). `kill` terminates the process tree (the backstop / sentinel kill).
 */
export interface Pico8Process {
	onStdout(cb: (chunk: string) => void): void;
	onClose(cb: (code: number | null) => void): void;
	onError(cb: (err: NodeJS.ErrnoException) => void): void;
	kill(): void;
	/**
	 * Writes raw bytes to the process's stdin, for the `drive` transport (the
	 * fixed-size command blocks). Absent/undefined when stdin was detached
	 * (`run`/`record` ignore stdin so the cart never blocks on console input).
	 */
	writeStdin?(bytes: Uint8Array): void;
}

/**
 * The process-spawn seam (mirrors shrinko's `ChildRunner`). The real impl spawns
 * `pico8 -x`; a test injects a fake that emits synthetic stdout and a chosen
 * outcome, so the sentinel-kill / backstop / pico8-absent paths are all testable
 * WITHOUT the paid binary. `env` is handed in (its `PICO8_PATH`/`PATH` are the
 * isolation levers), never read ambiently.
 */
export type SpawnRunner = (
	file: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	options?: {stdin?: boolean},
) => Pico8Process;

/**
 * The default {@link SpawnRunner}: `spawn` with stdin detached (`ignore`) so the
 * cart never blocks on console input, stdout/stderr piped for the sentinel
 * watch. A spawn failure surfaces via `onError` (ENOENT ⇒ absent). `kill` sends
 * SIGKILL to the whole tree (`detached` + negative pid) so a hung PICO-8 dies.
 */
export const spawnRunner: SpawnRunner = (file, args, env, options) => {
	// `drive` pipes fixed-size command blocks to stdin; `run`/`record` detach it so
	// the cart never blocks on console input.
	const stdin = options?.stdin === true ? 'pipe' : 'ignore';
	const child = spawn(file, args, {
		env,
		stdio: [stdin, 'pipe', 'pipe'],
		detached: true,
	});
	child.stdout?.setEncoding('utf8');
	child.stderr?.setEncoding('utf8');
	return {
		onStdout(cb) {
			child.stdout?.on('data', cb);
			child.stderr?.on('data', cb);
		},
		onClose(cb) {
			child.on('close', cb);
		},
		onError(cb) {
			child.on('error', cb as (e: Error) => void);
		},
		writeStdin(bytes) {
			try {
				child.stdin?.write(Buffer.from(bytes));
			} catch {
				// A closed stdin (the cart exited) is not fatal to the run.
			}
		},
		kill() {
			try {
				// Negative pid kills the process GROUP (detached), so any child dies too.
				if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
			} catch {
				child.kill('SIGKILL'); // fall back to killing just the process
			}
		},
	};
};

/** The candidate ways to launch PICO-8, tried in order: `PICO8_PATH`, then `pico8` on `PATH`. */
function pico8Candidates(env: NodeJS.ProcessEnv): string[] {
	const fromEnv = env.PICO8_PATH?.trim();
	return fromEnv !== undefined && fromEnv.length > 0
		? [fromEnv, 'pico8']
		: ['pico8'];
}

/** PNG files a run produced in its `-desktop` dir, sorted for deterministic order. */
function collectScreenshots(shotDir: string): string[] {
	if (!existsSync(shotDir)) return [];
	return readdirSync(shotDir)
		.filter((f) => f.toLowerCase().endsWith('.png'))
		.sort()
		.map((f) => join(shotDir, f));
}

/**
 * The WAV a record run produced in its `wavDir`, or `undefined`. Prefers the
 * expected `<basename>.wav` (what the harness named via `set_filename`); falls
 * back to any single `.wav` present. A well-formed but EMPTY WAV (a headless
 * `-x` capture yields a 44-byte 0-frame RIFF header, ADR-0009) is treated as
 * "no usable WAV" so a silent capture is not reported as a real recording.
 */
function collectWav(wavDir: string, basename: string): string | undefined {
	if (!existsSync(wavDir)) return undefined;
	const wavs = readdirSync(wavDir).filter((f) =>
		f.toLowerCase().endsWith('.wav'),
	);
	if (wavs.length === 0) return undefined;
	const expected = `${basename}.wav`;
	const chosen = wavs.includes(expected) ? expected : wavs.sort()[0]!;
	const path = join(wavDir, chosen);
	// A 44-byte RIFF header with no PCM data is the empty/silent (headless) WAV.
	try {
		if (statSync(path).size <= 44) return undefined;
	} catch {
		return undefined;
	}
	return path;
}

/** Options for {@link ShellPico8Adapter}. */
export interface ShellPico8Options {
	/** The environment for the child (its `PICO8_PATH`/`PATH` locate the binary). */
	readonly env: NodeJS.ProcessEnv;
	/** The spawn runner (defaults to {@link spawnRunner}); tests inject a fake. */
	readonly spawn?: SpawnRunner;
}

/**
 * The v1 {@link Pico8Adapter}: shells out to the user's native `pico8 -x`
 * (ADR-0006, native path first). It owns the ORCHESTRATION the command should
 * not hand-roll: launch, stream stdout, kill on the done-sentinel, arm the
 * backstop, and collect screenshots + printh + exit reason into one result.
 *
 * PICO-8 absent (the first candidate ENOENTs and there is no fallback) returns
 * the structured {@link pico8NotFound} value, never a throw or a hang. That
 * absent path is the CI-testable one; live runs are a manual/opt-in tier.
 */
export class ShellPico8Adapter implements Pico8Adapter {
	private readonly env: NodeJS.ProcessEnv;
	private readonly spawnRun: SpawnRunner;

	constructor(options: ShellPico8Options) {
		this.env = options.env;
		this.spawnRun = options.spawn ?? spawnRunner;
	}

	run(options: RunOptions): Promise<Pico8Result> {
		const [file] = pico8Candidates(this.env) as [string, ...string[]];
		const args = [
			'-desktop',
			options.shotDir,
			'-x',
			options.cartPath,
			// One-shot scripted input (the cart reads it via stat(6)); omitted if absent.
			...(options.input !== undefined ? ['-p', options.input] : []),
		];
		return this.orchestrate(file, args, options, (exitReason, printh) => ({
			ok: true,
			value: {
				screenshots: collectScreenshots(options.shotDir),
				printh,
				exitReason,
			},
		}));
	}

	/**
	 * Records a running cart's audio to a WAV (ADR-0009). Launches PICO-8 in a
	 * REAL A/V session (`-run`, NOT the headless `-x` that mixes no audio) and
	 * controls the WAV location with `-root_path <wavDir>`, because
	 * `extcmd("audio_end", 1)` saves to PICO-8's CURRENT folder, not `-desktop`
	 * (the `audio_end(1)` trap). The cooperating cart (a harness for `record`, or
	 * the whole render harness) does the `audio_rec`/`audio_end`/sentinel dance; we
	 * watch the sentinel, arm the backstop, and collect `<basename>.wav` from the
	 * isolated `wavDir`. Live capture is a manual/opt-in tier; the absent path is
	 * the CI-testable one.
	 */
	/**
	 * Drives a throwaway cart through scripted input and captures live gameplay
	 * (ADR-0011). Launches `-desktop <shotDir> -x <cart>` with a LIVE stdin, writes
	 * the whole encoded FIXED-SIZE command block stream up front (the one-shot; the
	 * cart drains one block per frame and screenshots at the SHOT points), watches
	 * the sentinel, arms the backstop, and collects the SHOT PNGs + printh + exit
	 * reason. Returns {@link pico8NotFound} when PICO-8 is absent. Live capture is a
	 * manual/opt-in tier; the absent path is the CI-testable one.
	 */
	drive(options: DriveOptions): Promise<Pico8DriveResult> {
		const [file] = pico8Candidates(this.env) as [string, ...string[]];
		const args = ['-desktop', options.shotDir, '-x', options.cartPath];
		return this.orchestrate<Pico8DriveResult>(
			file,
			args,
			{sentinel: options.sentinel, backstopMs: options.backstopMs},
			(exitReason, printh) => ({
				ok: true,
				value: {
					screenshots: collectScreenshots(options.shotDir),
					printh,
					exitReason,
				},
			}),
			{stdin: true, onSpawn: (proc) => proc.writeStdin?.(options.blocks)},
		);
	}

	record(options: RecordOptions): Promise<Pico8RecordResult> {
		const [file] = pico8Candidates(this.env) as [string, ...string[]];
		const basename = options.wavBasename ?? RECORD_WAV_BASENAME;
		// `-root_path <wavDir>` steers the `audio_end(1)`-to-current-folder WAV into
		// the isolated temp dir (never ~/Desktop or the carts root). `-run` is a real
		// A/V session (recording needs audio to capture; `-x` yields an empty WAV).
		const args = ['-root_path', options.wavDir, '-run', options.cartPath];
		return this.orchestrate<Pico8RecordResult>(
			file,
			args,
			{sentinel: options.sentinel, backstopMs: options.backstopMs},
			(exitReason, printh) => ({
				ok: true,
				value: {
					wavPath: collectWav(options.wavDir, basename),
					printh,
					exitReason,
				},
			}),
		);
	}

	/**
	 * The shared launch/sentinel-watch/backstop/collect loop behind both
	 * {@link run} and {@link record}. `buildOk` turns the exit reason + captured
	 * stdout into the command-specific success value; a spawn ENOENT with no
	 * fallback resolves the structured {@link pico8NotFound}. `printh` for `run` is
	 * filled by the caller from the run report path (kept out of `buildOk` there so
	 * the two report shapes stay distinct).
	 */
	private orchestrate<R extends {ok: boolean}>(
		file: string,
		args: string[],
		opts: {sentinel?: string; backstopMs: number},
		buildOk: (exitReason: ExitReason, printh: string) => R,
		spawnOpts?: {stdin?: boolean; onSpawn?: (proc: Pico8Process) => void},
	): Promise<R | ReturnType<typeof pico8NotFound>> {
		const watcher = new SentinelWatcher(opts.sentinel);

		return new Promise<R | ReturnType<typeof pico8NotFound>>((resolve) => {
			let settled = false;
			let backstop: NodeJS.Timeout | undefined;
			const proc = this.spawnRun(file, args, this.env, {
				stdin: spawnOpts?.stdin,
			});

			const finish = (exitReason: ExitReason): void => {
				if (settled) return;
				settled = true;
				if (backstop !== undefined) clearTimeout(backstop);
				resolve(buildOk(exitReason, watcher.text));
			};

			proc.onError((err) => {
				// A spawn ENOENT ⇒ PICO-8 is absent (a bad PICO8_PATH surfaces as absence
				// with the same remedy, not a silent fall-through). Any other spawn error
				// is a failed run, not a crash.
				if (settled) return;
				if (err.code === 'ENOENT') {
					settled = true;
					if (backstop !== undefined) clearTimeout(backstop);
					resolve(pico8NotFound());
				} else {
					finish('exit');
				}
			});

			proc.onStdout((chunk) => {
				if (watcher.push(chunk) && !settled) {
					proc.kill(); // sentinel matched: end the run promptly
					finish('sentinel');
				}
			});

			proc.onClose(() => finish('exit')); // PICO-8 exited on its own

			// For `drive`: write the command blocks to the live stdin now that it is
			// spawned. A spawn ENOENT resolves via onError before this matters.
			spawnOpts?.onSpawn?.(proc);

			// Backstop: a cart that neither signals nor exits gets killed.
			backstop = setTimeout(() => {
				if (settled) return;
				proc.kill();
				finish('timeout');
			}, opts.backstopMs);
		});
	}
}
