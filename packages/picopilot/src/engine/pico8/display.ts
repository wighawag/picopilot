/**
 * The DISPLAY MODE seam (ADR-0017): how a PICO-8 `-run` session (a real
 * audio+video session, today only the audio-record path) gets a display on a
 * machine that may have none (a server, CI, an agent sandbox).
 *
 * - `native`: spawn PICO-8 as-is (it uses whatever DISPLAY/WAYLAND_DISPLAY the
 *   caller has, or fails to open a window if there is none).
 * - `xvfb`:   always run a `-run` session on a private virtual X display.
 * - `auto`:   the default. Use a virtual display only when the session needs one
 *   and none is available (no DISPLAY and no WAYLAND_DISPLAY); otherwise native.
 *
 * Headless `-x` passes (run screenshots, playtest, export, the label capture)
 * never need a display, so they never consult this module and never pay the
 * Xvfb startup cost.
 *
 * The virtual display prefers spawning `Xvfb -displayfd <fd>` directly: the X
 * server picks a free display number itself and writes it back on the fd, so
 * parallel runs never race for a fixed `:99`. When only the Debian `xvfb-run`
 * script exists, it is the fallback (it wraps the PICO-8 command instead).
 * Either way the virtual display lives exactly as long as the run.
 */

import {spawn} from 'node:child_process';
import {accessSync, constants, statSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {killOnAbort} from './cleanup.js';

/** The three display modes. `auto` is the default. */
export const DISPLAY_MODES = ['auto', 'xvfb', 'native'] as const;

/** A display mode: how a `-run` session gets a display (see the module doc). */
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/** The default display mode when no flag, env var or config sets one. */
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'auto';

/** The env var that sets the display mode (below the `--display` flag, above picopilot.json). */
export const DISPLAY_ENV_VAR = 'PICOPILOT_DISPLAY' as const;

/** The top-level picopilot.json key that sets the display mode (lowest precedence). */
export const DISPLAY_CONFIG_KEY = 'display' as const;

/** Whether `value` names a valid {@link DisplayMode}. */
export function isDisplayMode(value: unknown): value is DisplayMode {
	return (
		typeof value === 'string' &&
		(DISPLAY_MODES as readonly string[]).includes(value)
	);
}

/** The outcome of {@link resolveDisplayMode}: a mode and where it came from, or an invalid value. */
export type DisplayModeResolution =
	| {
			readonly ok: true;
			readonly mode: DisplayMode;
			readonly source: 'flag' | 'env' | 'config' | 'default';
	  }
	| {
			readonly ok: false;
			readonly source: 'flag' | 'env' | 'config';
			readonly value: string;
	  };

/**
 * Resolves the display mode with the precedence `flag > env > config > default`
 * (the same order every picopilot setting uses). An empty/whitespace value is
 * treated as unset; an unknown value is reported (never silently ignored), so a
 * typo like `PICOPILOT_DISPLAY=xfvb` is a visible error rather than `auto`.
 */
export function resolveDisplayMode(sources: {
	readonly flag?: unknown;
	readonly env?: unknown;
	readonly config?: unknown;
}): DisplayModeResolution {
	const ordered = [
		['flag', sources.flag],
		['env', sources.env],
		['config', sources.config],
	] as const;
	for (const [source, raw] of ordered) {
		if (raw === undefined || raw === null) continue;
		const value = String(raw).trim();
		if (value.length === 0) continue;
		if (isDisplayMode(value)) return {ok: true, mode: value, source};
		return {ok: false, source, value};
	}
	return {ok: true, mode: DEFAULT_DISPLAY_MODE, source: 'default'};
}

/** Whether the environment already offers a display (X11 `DISPLAY` or a Wayland socket). */
export function hasNativeDisplay(env: NodeJS.ProcessEnv): boolean {
	const set = (v: string | undefined) => v !== undefined && v.trim() !== '';
	return set(env.DISPLAY) || set(env.WAYLAND_DISPLAY);
}

/**
 * Whether a `-run` session in this `mode` + `env` should run on a virtual
 * display: always for `xvfb`, never for `native`, and for `auto` only when
 * there is no native display.
 */
export function needsVirtualDisplay(
	mode: DisplayMode,
	env: NodeJS.ProcessEnv,
): boolean {
	if (mode === 'xvfb') return true;
	if (mode === 'native') return false;
	return !hasNativeDisplay(env);
}

/**
 * Finds an executable the way a shell would: a name containing `/` is checked
 * as a path, anything else is searched on `env.PATH`. Returns the resolved path,
 * or `undefined`. Pure lookup (no spawn), so it is cheap enough for `doctor` and
 * for the failure path.
 */
export function findExecutable(
	name: string,
	env: NodeJS.ProcessEnv,
): string | undefined {
	const isExec = (p: string): boolean => {
		try {
			if (!statSync(p).isFile()) return false;
			accessSync(p, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	};
	if (name.includes('/')) return isExec(name) ? name : undefined;
	for (const dir of (env.PATH ?? '').split(delimiter)) {
		if (dir === '') continue;
		const candidate = join(dir, name);
		if (isExec(candidate)) return candidate;
	}
	return undefined;
}

/** Which virtual-display backend this machine offers, if any (direct Xvfb is preferred). */
export type VirtualDisplayBackend = 'Xvfb' | 'xvfb-run';

/** Detects the best available virtual-display backend on `env.PATH`. */
export function detectVirtualDisplayBackend(
	env: NodeJS.ProcessEnv,
	find: (
		name: string,
		env: NodeJS.ProcessEnv,
	) => string | undefined = findExecutable,
): VirtualDisplayBackend | undefined {
	if (find('Xvfb', env) !== undefined) return 'Xvfb';
	if (find('xvfb-run', env) !== undefined) return 'xvfb-run';
	return undefined;
}

/** The remedy a `display-unavailable` error names. */
export const DISPLAY_REMEDY =
	'install Xvfb (Debian/Ubuntu: apt install xvfb; Fedora: dnf install xorg-x11-server-Xvfb; NixOS: add xvfb-run or xorg.xvfb), or run under a desktop session (DISPLAY or WAYLAND_DISPLAY set)' as const;

/**
 * The structured "this session needs a display and there is none" failure
 * (mirrors {@link import('./adapter.js').Pico8NotFound}). `detail` says what was
 * tried (Xvfb missing, or Xvfb failed to start and why).
 */
export interface DisplayUnavailable {
	readonly ok: false;
	readonly reason: 'display-unavailable';
	readonly remedy: typeof DISPLAY_REMEDY;
	readonly detail: string;
}

/** Builds a {@link DisplayUnavailable} value. */
export function displayUnavailable(detail: string): DisplayUnavailable {
	return {
		ok: false,
		reason: 'display-unavailable',
		remedy: DISPLAY_REMEDY,
		detail,
	};
}

/**
 * A running virtual display, scoped to ONE PICO-8 session. `env` holds the
 * variables the child must see (DISPLAY for direct Xvfb); `wrap` rewrites the
 * PICO-8 command (identity for direct Xvfb, `xvfb-run -a ...` for the fallback);
 * `stop` tears the X server down and is idempotent.
 */
export interface VirtualDisplay {
	readonly backend: VirtualDisplayBackend;
	readonly env: Readonly<Record<string, string>>;
	wrap(file: string, args: string[]): {file: string; args: string[]};
	stop(): Promise<void>;
}

/**
 * A spawned Xvfb process, abstracted so tests inject a fake. `onDisplayFd`
 * delivers what the server writes on its `-displayfd` pipe (the display number
 * followed by a newline); `onExit` fires when it exits; `kill` sends a signal.
 */
export interface XvfbProcess {
	readonly pid: number | undefined;
	onDisplayFd(cb: (chunk: string) => void): void;
	onStderr(cb: (chunk: string) => void): void;
	onExit(cb: (code: number | null) => void): void;
	onError(cb: (err: NodeJS.ErrnoException) => void): void;
	kill(signal: NodeJS.Signals): void;
}

/** The Xvfb spawn seam: tests pass a fake that writes a display number (or never does). */
export type XvfbSpawner = (
	file: string,
	args: string[],
	env: NodeJS.ProcessEnv,
) => XvfbProcess;

/** The fd number Xvfb writes its display number to (`-displayfd 3`). */
const DISPLAY_FD = 3;

/** The screen geometry for the virtual display (PICO-8's default window fits easily). */
const XVFB_SCREEN = '640x540x24';

/**
 * The real {@link XvfbSpawner}: stdio `[ignore, ignore, pipe, pipe]` so fd 3 is
 * the display-number pipe. NOT detached, so a terminal Ctrl-C reaches it with
 * the rest of picopilot's process group.
 */
export const spawnXvfb: XvfbSpawner = (file, args, env) => {
	const child = spawn(file, args, {
		env,
		stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
	});
	const fd = child.stdio[DISPLAY_FD] as NodeJS.ReadableStream | null;
	fd?.setEncoding('utf8');
	child.stderr?.setEncoding('utf8');
	return {
		pid: child.pid,
		onDisplayFd(cb) {
			fd?.on('data', cb);
		},
		onStderr(cb) {
			child.stderr?.on('data', cb);
		},
		onExit(cb) {
			child.on('exit', cb);
		},
		onError(cb) {
			child.on('error', cb as (e: Error) => void);
		},
		kill(signal) {
			try {
				child.kill(signal);
			} catch {
				// already gone
			}
		},
	};
};

/** Dependencies for {@link startVirtualDisplay}, injectable for tests. */
export interface VirtualDisplayDeps {
	/** Locates `Xvfb` / `xvfb-run` (defaults to a PATH search). */
	readonly find?: (name: string, env: NodeJS.ProcessEnv) => string | undefined;
	/** Spawns Xvfb (defaults to {@link spawnXvfb}). */
	readonly spawnXvfb?: XvfbSpawner;
	/** How long to wait for Xvfb to report its display number (ms). */
	readonly startTimeoutMs?: number;
	/** How long to wait after SIGTERM before SIGKILL on stop (ms). */
	readonly stopGraceMs?: number;
}

/** The default time Xvfb gets to come up before the start is declared failed. */
const DEFAULT_XVFB_START_TIMEOUT_MS = 10_000;

/** The default time Xvfb gets to exit on SIGTERM before SIGKILL. */
const DEFAULT_XVFB_STOP_GRACE_MS = 2_000;

/**
 * Starts a private virtual display for one PICO-8 session. Prefers `Xvfb
 * -displayfd` (no fixed display number, so parallel runs never collide), falls
 * back to wrapping the command in `xvfb-run -a`, and resolves the structured
 * {@link DisplayUnavailable} when neither exists or Xvfb fails to start. Never
 * throws. The returned display MUST be stopped by the caller (the shell adapter
 * does it in a `finally`); a kill-on-abort hook also kills a direct Xvfb so an
 * abrupt picopilot exit or signal never leaves one behind.
 */
export async function startVirtualDisplay(
	env: NodeJS.ProcessEnv,
	deps: VirtualDisplayDeps = {},
): Promise<{ok: true; display: VirtualDisplay} | DisplayUnavailable> {
	const find = deps.find ?? findExecutable;
	const xvfb = find('Xvfb', env);
	if (xvfb !== undefined) {
		return startDirectXvfb(xvfb, env, deps);
	}
	const xvfbRun = find('xvfb-run', env);
	if (xvfbRun !== undefined) {
		return {ok: true, display: xvfbRunDisplay(xvfbRun)};
	}
	return displayUnavailable(
		'there is no display (DISPLAY and WAYLAND_DISPLAY are unset) and neither Xvfb nor xvfb-run is on PATH to provide a virtual one',
	);
}

/**
 * The `xvfb-run` fallback: no server to manage here, the script starts Xvfb,
 * runs the command with DISPLAY set, and kills Xvfb when the command exits. The
 * whole thing runs in PICO-8's process group, so the adapter's group kill
 * (sentinel / backstop) takes Xvfb down with it.
 */
function xvfbRunDisplay(xvfbRun: string): VirtualDisplay {
	return {
		backend: 'xvfb-run',
		env: {},
		wrap(file, args) {
			return {
				file: xvfbRun,
				args: [
					'-a',
					'-s',
					`-screen 0 ${XVFB_SCREEN} -nolisten tcp`,
					file,
					...args,
				],
			};
		},
		async stop() {},
	};
}

/** Starts `Xvfb -displayfd 3` and waits for it to report the display number it picked. */
function startDirectXvfb(
	file: string,
	env: NodeJS.ProcessEnv,
	deps: VirtualDisplayDeps,
): Promise<{ok: true; display: VirtualDisplay} | DisplayUnavailable> {
	const spawner = deps.spawnXvfb ?? spawnXvfb;
	const startTimeoutMs = deps.startTimeoutMs ?? DEFAULT_XVFB_START_TIMEOUT_MS;
	const stopGraceMs = deps.stopGraceMs ?? DEFAULT_XVFB_STOP_GRACE_MS;
	const args = [
		'-displayfd',
		String(DISPLAY_FD),
		'-screen',
		'0',
		XVFB_SCREEN,
		'-nolisten',
		'tcp',
	];

	return new Promise((resolve) => {
		let exited = false;
		let settled = false;
		let fdText = '';
		let stderr = '';
		const exitWaiters: (() => void)[] = [];
		let timer: NodeJS.Timeout | undefined;
		const proc = spawner(file, args, env);

		// Safety net: if picopilot exits or is signalled mid-run, kill the server
		// synchronously so no stray Xvfb is left behind.
		const disposeAbort = killOnAbort(() => proc.kill('SIGKILL'));

		const stop = (): Promise<void> => {
			disposeAbort();
			if (exited) return Promise.resolve();
			return new Promise<void>((done) => {
				exitWaiters.push(done);
				proc.kill('SIGTERM');
				const hard = setTimeout(() => {
					if (!exited) proc.kill('SIGKILL');
				}, stopGraceMs);
				exitWaiters.push(() => clearTimeout(hard));
			});
		};

		const fail = (detail: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			void stop().then(() => resolve(displayUnavailable(detail)));
		};

		proc.onExit(() => {
			exited = true;
			for (const w of exitWaiters.splice(0)) w();
			if (!settled) {
				disposeAbort();
				fail(`Xvfb exited before reporting a display${stderrTail(stderr)}`);
			}
		});
		proc.onError((err) => {
			exited = true;
			for (const w of exitWaiters.splice(0)) w();
			fail(`Xvfb failed to start (${err.code ?? err.message})`);
		});
		proc.onStderr((chunk) => {
			stderr += chunk;
		});
		proc.onDisplayFd((chunk) => {
			if (settled) return;
			fdText += chunk;
			const m = /^\s*(\d+)\s*\n/.exec(fdText);
			if (m === null) return;
			settled = true;
			clearTimeout(timer);
			const display = `:${m[1]}`;
			resolve({
				ok: true,
				display: {
					backend: 'Xvfb',
					env: {DISPLAY: display},
					wrap: (f, a) => ({file: f, args: a}),
					stop,
				},
			});
		});

		timer = setTimeout(
			() =>
				fail(
					`Xvfb did not report a display within ${startTimeoutMs}ms${stderrTail(stderr)}`,
				),
			startTimeoutMs,
		);
	});
}

/** The last few lines of Xvfb's stderr, as a `: ...` suffix (or empty). */
function stderrTail(stderr: string): string {
	const lines = stderr.trim().split('\n').filter(Boolean).slice(-3);
	return lines.length === 0 ? '' : `: ${lines.join(' | ')}`;
}
