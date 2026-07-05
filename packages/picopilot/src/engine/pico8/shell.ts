import {spawn} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	type ExitReason,
	type Pico8Adapter,
	pico8NotFound,
	type Pico8Result,
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
) => Pico8Process;

/**
 * The default {@link SpawnRunner}: `spawn` with stdin detached (`ignore`) so the
 * cart never blocks on console input, stdout/stderr piped for the sentinel
 * watch. A spawn failure surfaces via `onError` (ENOENT ⇒ absent). `kill` sends
 * SIGKILL to the whole tree (`detached` + negative pid) so a hung PICO-8 dies.
 */
export const spawnRunner: SpawnRunner = (file, args, env) => {
	const child = spawn(file, args, {
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
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
		const [file, ...rest] = pico8Candidates(this.env) as [string, ...string[]];
		const args = ['-desktop', options.shotDir, '-x', options.cartPath];
		const watcher = new SentinelWatcher(options.sentinel);

		return new Promise<Pico8Result>((resolve) => {
			let settled = false;
			let backstop: NodeJS.Timeout | undefined;
			const proc = this.spawnRun(file, args, this.env);

			const finish = (exitReason: ExitReason): void => {
				if (settled) return;
				settled = true;
				if (backstop !== undefined) clearTimeout(backstop);
				resolve({
					ok: true,
					value: {
						screenshots: collectScreenshots(options.shotDir),
						printh: watcher.text,
						exitReason,
					},
				});
			};

			proc.onError((err) => {
				// ENOENT on the ONLY candidate (or the resolved PICO8_PATH) ⇒ absent.
				// Any first-candidate failure with no working fallback is pico8-not-found;
				// we do not try the `pico8` fallback here because a bad PICO8_PATH should
				// surface as absence with the same remedy, not silently fall through.
				if (settled) return;
				if (err.code === 'ENOENT' && rest.length === 0) {
					settled = true;
					if (backstop !== undefined) clearTimeout(backstop);
					resolve(pico8NotFound());
				} else if (err.code === 'ENOENT') {
					// PICO8_PATH ENOENTed but a `pico8` fallback exists: treat as absent
					// too (keep the boundary simple + the remedy identical).
					settled = true;
					if (backstop !== undefined) clearTimeout(backstop);
					resolve(pico8NotFound());
				} else {
					// A non-ENOENT spawn error is still a failed run, not a crash.
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

			// Backstop: a cart that neither signals nor exits gets killed.
			backstop = setTimeout(() => {
				if (settled) return;
				proc.kill();
				finish('timeout');
			}, options.backstopMs);
		});
	}
}
