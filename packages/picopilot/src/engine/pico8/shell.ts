import {spawn} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	type DriveOptions,
	type ExitReason,
	EXPORT_HTML_NAME,
	type ExportOptions,
	type Pico8Adapter,
	pico8NotFound,
	type Pico8DriveResult,
	type Pico8ExportResult,
	type Pico8RecordResult,
	type Pico8Result,
	RECORD_WAV_BASENAME,
	type RecordOptions,
	type RecordReport,
	type RunOptions,
} from './adapter.js';
import {
	DEFAULT_DISPLAY_MODE,
	type DisplayMode,
	findExecutable,
	needsVirtualDisplay,
	startVirtualDisplay,
	type VirtualDisplayDeps,
} from './display.js';
import {overlayEnv} from '../child-env.js';
import {killOnAbort} from './cleanup.js';
import {SentinelWatcher} from './sentinel.js';

/**
 * A spawned PICO-8 process, abstracted so tests inject a fake. `onStdout`
 * delivers stdout chunks (both `stdout` and `stderr` folded in, since PICO-8's
 * `printh` and its own lines can land on either); `onClose` fires when the
 * process exits on its own; `onError` fires on a spawn failure (ENOENT ⇒ PICO-8
 * absent). `kill` terminates the process tree (the backstop / sentinel kill),
 * with SIGKILL unless a gentler `signal` is given (the `xvfb-run` fallback is
 * first sent SIGTERM so Xvfb can remove its lock file and socket).
 */
export interface Pico8Process {
	onStdout(cb: (chunk: string) => void): void;
	onClose(cb: (code: number | null) => void): void;
	onError(cb: (err: NodeJS.ErrnoException) => void): void;
	kill(signal?: NodeJS.Signals): void;
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
/**
 * An isolated directory to hand PICO-8 as its `-home`, so it writes its config /
 * data tree (`config.txt`, `log.txt`, `sdl_controllers.txt`, `backup/`, `carts/`,
 * `bbs/`, `cdata/`, `cstore/`, `plates/`) THERE and never litters the caller's
 * CWD. Without `-home`, PICO-8 creates that tree in whatever directory it was
 * spawned from, e.g. a user's repo root (see
 * work/notes/observations/pico8-appimage-writes-config-into-cwd.md). Verified:
 * `-home <dir>` fully redirects every one of those files/dirs.
 *
 * One dir per process, created lazily under the OS temp dir and reused by every
 * launch (run/drive/export/record/session). It is throwaway config, so OS temp
 * cleanup reclaims it; picopilot never needs its contents.
 */
let cachedHome: string | undefined;
export function pico8HomeDir(): string {
	if (cachedHome !== undefined && existsSync(cachedHome)) return cachedHome;
	cachedHome = mkdtempSync(join(tmpdir(), 'picopilot-pico8-home-'));
	return cachedHome;
}

/**
 * Prepend `-home <isolatedDir>` to a PICO-8 arg list so its config/data never
 * land in the CWD. Applied at every spawn site.
 */
export function withPico8Home(args: string[]): string[] {
	const home = pico8HomeDir();
	mkdirSync(home, {recursive: true});
	return ['-home', home, ...args];
}

/**
 * The environment PICO-8 is spawned with: the parent env overlaid with the
 * picopilot-resolved values ({@link overlayEnv}). A `-run` session cannot open a
 * window or an audio device without DISPLAY, HOME, XDG_RUNTIME_DIR, SDL_*, ...
 */
export function pico8ChildEnv(
	resolved: Readonly<Record<string, string | undefined>>,
	parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	return overlayEnv(resolved, parent);
}

/**
 * A private `XDG_RUNTIME_DIR` (mode 0700, one per picopilot process) for a
 * PICO-8 launched without one. SDL logs "XDG_RUNTIME_DIR is invalid or not set"
 * otherwise, which is noise in every headless report.
 */
let cachedRuntimeDir: string | undefined;
export function pico8RuntimeDir(): string {
	if (cachedRuntimeDir !== undefined && existsSync(cachedRuntimeDir)) {
		return cachedRuntimeDir;
	}
	cachedRuntimeDir = mkdtempSync(join(tmpdir(), 'picopilot-xdg-runtime-'));
	return cachedRuntimeDir;
}

/** `env` with a private {@link pico8RuntimeDir} filled in when XDG_RUNTIME_DIR is absent. */
export function withRuntimeDir(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const current = env.XDG_RUNTIME_DIR;
	if (current !== undefined && current.trim() !== '') return env;
	return {...env, XDG_RUNTIME_DIR: pico8RuntimeDir()};
}

/** How many lines of PICO-8's `log.txt` a failed record reports. */
const LOG_TAIL_LINES = 25;

/** The last lines of PICO-8's `log.txt` in the isolated `-home`, or undefined if absent. */
export function readPico8LogTail(
	home: string = pico8HomeDir(),
	lines: number = LOG_TAIL_LINES,
): string | undefined {
	try {
		const text = readFileSync(join(home, 'log.txt'), 'utf8');
		const all = text.trimEnd().split('\n');
		return all.slice(-lines).join('\n');
	} catch {
		return undefined;
	}
}

/**
 * Says WHY a record run produced no WAV, from how it ended. The sentinel is the
 * harness's last act (after `audio_end`), so anything other than a sentinel
 * means the harness never finished; a sentinel with no WAV means `audio_end`
 * saved nothing usable.
 */
export function explainNoWav(
	exitReason: ExitReason,
	ctx: {backstopMs: number; wavDir: string; basename: string},
): string {
	switch (exitReason) {
		case 'timeout':
			return `the backstop fired after ${ctx.backstopMs}ms before the record harness printed its done-sentinel: the cart never reached audio_end (it failed to load, errored at runtime, or its game loop never ran). See pico8LogTail and printh.`;
		case 'exit':
			return 'PICO-8 exited before the record harness printed its done-sentinel: the cart failed to load or crashed, or PICO-8 itself could not start (e.g. no display or audio device). See pico8LogTail and printh.';
		case 'sentinel':
			return `the record harness reached its done-sentinel but no non-empty ${ctx.basename}.wav was written to ${ctx.wavDir}: audio_end saved nothing usable (an empty 0-frame capture).`;
	}
}

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
		kill(signal = 'SIGKILL') {
			try {
				// Negative pid kills the process GROUP (detached), so any child dies too.
				if (child.pid !== undefined) process.kill(-child.pid, signal);
			} catch {
				child.kill(signal); // fall back to killing just the process
			}
		},
	};
};

/** The candidate ways to launch PICO-8, tried in order: `PICO8_PATH`, then `pico8` on `PATH`. */
export function pico8Candidates(env: NodeJS.ProcessEnv): string[] {
	const fromEnv = env.PICO8_PATH?.trim();
	return fromEnv !== undefined && fromEnv.length > 0
		? [fromEnv, 'pico8']
		: ['pico8'];
}

/**
 * The files an export produced in `outDir`, absolute + sorted. PICO-8 writes the
 * `<name>.html` shell and the `<name>.js` runtime payload; we return every file
 * present so the report is faithful even if a future PICO-8 adds siblings.
 */
function collectExportFiles(outDir: string): string[] {
	if (!existsSync(outDir)) return [];
	return readdirSync(outDir)
		.sort()
		.map((f) => join(outDir, f))
		.filter((p) => {
			try {
				return statSync(p).isFile();
			} catch {
				return false;
			}
		});
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
	/**
	 * The display mode for `-run` sessions (ADR-0017; defaults to `auto`). Only
	 * {@link ShellPico8Adapter.record} consults it: the `-x` paths never need a
	 * display and never start one.
	 */
	readonly display?: DisplayMode;
	/** The virtual-display dependencies (Xvfb lookup + spawn); tests inject fakes. */
	readonly virtualDisplay?: VirtualDisplayDeps;
	/**
	 * How long a gracefully-ended run (the `xvfb-run` fallback) gets between
	 * SIGTERM and SIGKILL, in ms (default {@link DEFAULT_KILL_GRACE_MS}).
	 */
	readonly killGraceMs?: number;
}

/** The default SIGTERM-to-SIGKILL grace for a gracefully-ended run. */
export const DEFAULT_KILL_GRACE_MS = 2_000;

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
	private readonly display: DisplayMode;
	private readonly virtualDisplay: VirtualDisplayDeps;
	private readonly killGraceMs: number;

	constructor(options: ShellPico8Options) {
		this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
		this.env = options.env;
		this.spawnRun = options.spawn ?? spawnRunner;
		this.display = options.display ?? DEFAULT_DISPLAY_MODE;
		this.virtualDisplay = options.virtualDisplay ?? {};
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

	/**
	 * Exports the cart as a PICO-8 HTML bundle over the HEADLESS `-x` path (no
	 * display needed: `pico8 <cart> -export <outDir>/<name> -x` runs the cart, writes
	 * `<name>.html` + `<name>.js`, and exits). PICO-8 derives both file names from
	 * the `.html` name, so passing `index.html` yields a directly-serveable pair.
	 * A labelless cart prints "please capture a label first" and still exports (a
	 * blank splash), surfaced as `labelWarning`. PICO-8 absent -> {@link pico8NotFound}.
	 */
	export(options: ExportOptions): Promise<Pico8ExportResult> {
		const [file] = pico8Candidates(this.env) as [string, ...string[]];
		const htmlName = options.htmlName ?? EXPORT_HTML_NAME;
		const outPath = join(options.outDir, htmlName);
		// `-export <name>.html` is a load-and-export command; `-x` makes it headless
		// (run the cart, perform the export, exit) so no window/display is needed.
		const args = ['-export', outPath, '-x', options.cartPath];
		return this.orchestrate<Pico8ExportResult>(
			file,
			args,
			// The export has no cooperative done-sentinel; `-x` exits on its own when
			// finished, and the backstop is the net for a cart that hangs at boot.
			{backstopMs: options.backstopMs},
			(_exitReason, printh) => {
				const files = collectExportFiles(options.outDir);
				const htmlPath = files.find((p) => p.endsWith('.html'));
				const jsPath = files.find((p) => p.endsWith('.js'));
				return {
					ok: true,
					value: {
						htmlPath,
						jsPath,
						files,
						// PICO-8 warns when the cart has no `__label__` to embed as the splash.
						labelWarning: /please capture a label first/i.test(printh),
					},
				};
			},
		);
	}

	record(options: RecordOptions): Promise<Pico8RecordResult> {
		if (needsVirtualDisplay(this.display, this.env)) {
			return this.recordOnVirtualDisplay(options);
		}
		return this.recordWith(options, 'native');
	}

	/**
	 * The record session on a private virtual display (ADR-0017): start Xvfb
	 * (or fall back to `xvfb-run`), run PICO-8 on it with a dummy SDL audio
	 * driver (unless the caller chose one; `audio_rec` captures PICO-8's own
	 * mixer, not the device), and ALWAYS stop the display afterwards, however
	 * the run ended (sentinel, backstop, crash, spawn failure).
	 */
	private async recordOnVirtualDisplay(
		options: RecordOptions,
	): Promise<Pico8RecordResult> {
		const [file] = pico8Candidates(this.env) as [string, ...string[]];
		// Absent PICO-8 is reported as such BEFORE paying for (or failing on) a
		// display, and wrapped in xvfb-run a missing binary would not ENOENT.
		const find = this.virtualDisplay.find ?? findExecutable;
		if (find(file, this.env) === undefined) return pico8NotFound();

		const started = await startVirtualDisplay(this.env, this.virtualDisplay);
		if (!started.ok) return started;
		const vd = started.display;
		try {
			const env: NodeJS.ProcessEnv = {...this.env, ...vd.env};
			const audioDriver = env.SDL_AUDIODRIVER;
			if (audioDriver === undefined || audioDriver.trim() === '') {
				env.SDL_AUDIODRIVER = 'dummy';
			}
			return await this.recordWith(options, vd.backend, {
				env,
				wrap: (f, a) => vd.wrap(f, a),
				// xvfb-run's Xvfb lives in PICO-8's process group: SIGTERM first so it
				// removes its /tmp/.X<n>-lock and socket (a SIGKILL leaves them behind).
				endGracefully: vd.backend === 'xvfb-run',
			});
		} finally {
			await vd.stop();
		}
	}

	/** The record launch itself, natively or under a virtual display's env/wrapper. */
	private recordWith(
		options: RecordOptions,
		display: RecordReport['display'],
		launch?: {
			env: NodeJS.ProcessEnv;
			wrap: (file: string, args: string[]) => {file: string; args: string[]};
			endGracefully?: boolean;
		},
	): Promise<Pico8RecordResult> {
		const [file] = pico8Candidates(this.env) as [string, ...string[]];
		const basename = options.wavBasename ?? RECORD_WAV_BASENAME;
		// `-root_path <wavDir>` steers the `audio_end(1)`-to-current-folder WAV into
		// the isolated temp dir (never ~/Desktop or the carts root). `-run` is a real
		// A/V session (recording needs audio to capture; `-x` yields an empty WAV).
		const args = ['-root_path', options.wavDir, '-run', options.cartPath];
		// The `-home` is shared by every launch in this process: drop the previous
		// log.txt so a failed record never reports another run's log as its own.
		rmSync(join(pico8HomeDir(), 'log.txt'), {force: true});
		return this.orchestrate<Pico8RecordResult>(
			file,
			args,
			{sentinel: options.sentinel, backstopMs: options.backstopMs},
			(exitReason, printh) => {
				const wavPath = collectWav(options.wavDir, basename);
				if (wavPath !== undefined) {
					return {ok: true, value: {wavPath, printh, exitReason, display}};
				}
				const pico8LogTail = readPico8LogTail();
				return {
					ok: true,
					value: {
						wavPath,
						printh,
						exitReason,
						display,
						noWavReason: explainNoWav(exitReason, {
							backstopMs: options.backstopMs,
							wavDir: options.wavDir,
							basename,
						}),
						...(pico8LogTail !== undefined ? {pico8LogTail} : {}),
					},
				};
			},
			launch,
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
		spawnOpts?: {
			stdin?: boolean;
			onSpawn?: (proc: Pico8Process) => void;
			/** The child env (defaults to the adapter's); a virtual display adds DISPLAY etc. */
			env?: NodeJS.ProcessEnv;
			/** Rewrites the launch (the `xvfb-run` fallback wraps the PICO-8 command). */
			wrap?: (file: string, args: string[]) => {file: string; args: string[]};
			/**
			 * End the run with SIGTERM, then SIGKILL after the grace period, and wait
			 * for the process to close before resolving (default: an immediate SIGKILL).
			 */
			endGracefully?: boolean;
		},
	): Promise<R | ReturnType<typeof pico8NotFound>> {
		const watcher = new SentinelWatcher(opts.sentinel);

		return new Promise<R | ReturnType<typeof pico8NotFound>>((resolve) => {
			let settled = false;
			let backstop: NodeJS.Timeout | undefined;
			const homeArgs = withPico8Home(args);
			const launch =
				spawnOpts?.wrap !== undefined
					? spawnOpts.wrap(file, homeArgs)
					: {file, args: homeArgs};
			const proc = this.spawnRun(
				launch.file,
				launch.args,
				withRuntimeDir(spawnOpts?.env ?? this.env),
				{stdin: spawnOpts?.stdin},
			);

			// If picopilot itself is stopped mid-run, take PICO-8 down with it.
			const disposeAbort = killOnAbort(() => proc.kill());
			let onClosed: (() => void) | undefined;

			/**
			 * Ends the run once. `kill` = PICO-8 is still running (sentinel/backstop):
			 * SIGKILL its group, or for a graceful end SIGTERM it and resolve when it
			 * has closed (SIGKILL after the grace period).
			 */
			const finish = (exitReason: ExitReason, kill = false): void => {
				if (settled) return;
				settled = true;
				if (backstop !== undefined) clearTimeout(backstop);
				let resolved = false;
				const done = () => {
					if (resolved) return;
					resolved = true;
					// Only now: a signal during the graceful wait must still kill PICO-8.
					disposeAbort();
					resolve(buildOk(exitReason, watcher.text));
				};
				if (!kill) return done();
				if (spawnOpts?.endGracefully !== true) {
					proc.kill();
					return done();
				}
				proc.kill('SIGTERM');
				const hard = setTimeout(() => {
					proc.kill();
					done();
				}, this.killGraceMs);
				onClosed = () => {
					clearTimeout(hard);
					done();
				};
			};

			proc.onError((err) => {
				// A spawn ENOENT ⇒ PICO-8 is absent (a bad PICO8_PATH surfaces as absence
				// with the same remedy, not a silent fall-through). Any other spawn error
				// is a failed run, not a crash.
				if (settled) return;
				if (err.code === 'ENOENT') {
					settled = true;
					disposeAbort();
					if (backstop !== undefined) clearTimeout(backstop);
					resolve(pico8NotFound());
				} else {
					finish('exit');
				}
			});

			proc.onStdout((chunk) => {
				// sentinel matched: end the run promptly
				if (watcher.push(chunk) && !settled) finish('sentinel', true);
			});

			proc.onClose(() => {
				if (onClosed !== undefined) return onClosed();
				finish('exit'); // PICO-8 exited on its own
			});

			// For `drive`: write the command blocks to the live stdin now that it is
			// spawned. A spawn ENOENT resolves via onError before this matters.
			spawnOpts?.onSpawn?.(proc);

			// Backstop: a cart that neither signals nor exits gets killed.
			backstop = setTimeout(() => {
				if (settled) return;
				finish('timeout', true);
			}, opts.backstopMs);
		});
	}
}
