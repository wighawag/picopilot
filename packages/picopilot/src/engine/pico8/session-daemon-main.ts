/**
 * The playtest session DAEMON ENTRYPOINT (ADR-0011, spec US #6): the small
 * detached process `playtest start` spawns to OWN a live driven PICO-8 for a
 * session's lifetime. It is invoked via the hidden `playtest __daemon` verb (so it
 * re-uses the exact same executable/loader the parent ran under, dev `tsx` or
 * built `dist`), reads its config from JSON on argv, spawns PICO-8 on the
 * throwaway driven cart with a LIVE stdin, and hands the process to
 * {@link serveSession} to answer verbs over the session socket.
 *
 * PICO-8 ABSENT: the spawn ENOENTs, so the daemon writes a `pico8-not-found`
 * marker file into the session dir and exits; the `start` client polls for either
 * the socket (ready) or that marker (absent) and maps the marker to the same
 * structured `pico8-not-found` boundary as `run`/`audio render`. This keeps the
 * absent path structured WITHOUT the parent ever launching PICO-8 itself (the
 * `pico8 --help` footgun is never touched).
 */

import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pico8NotFound} from './adapter.js';
import {serveSession} from './session-daemon.js';
import {spawnRunner, pico8Candidates, withPico8Home} from './shell.js';
import type {SessionPaths} from './supervisor.js';

/** The marker file the daemon writes into the session dir when PICO-8 is absent. */
export const PICO8_NOT_FOUND_MARKER = 'pico8-not-found' as const;

/** The daemon's launch config, passed as a single JSON argument. */
export interface DaemonConfig {
	readonly id: string;
	readonly paths: SessionPaths;
	/** Absolute path to the throwaway driven cart to run live. */
	readonly cartPath: string;
	/** The screenshot basename the driven cart names each SHOT. */
	readonly shotBasename: string;
	/** Idle-reap window in ms. */
	readonly idleTimeoutMs: number;
	/** Per-command ACK deadline in ms. */
	readonly ackTimeoutMs: number;
}

/**
 * Runs the daemon from its JSON config: spawns PICO-8 live on the driven cart and
 * serves the session, or writes the pico8-not-found marker and exits on ENOENT.
 * Exported so a test can drive it with an injected spawner (no real binary).
 */
export function runDaemon(
	config: DaemonConfig,
	env: NodeJS.ProcessEnv = process.env,
	spawn = spawnRunner,
): void {
	const [file] = pico8Candidates(env) as [string, ...string[]];
	// Live session: `-desktop <shotDir>` for SHOT captures, `-x` headless, stdin
	// piped so the daemon can send fixed-size command blocks per verb.
	const args = ['-desktop', config.paths.shotDir, '-x', config.cartPath];
	// `-home <isolated>` so PICO-8's config/data tree lands in a throwaway dir, not
	// the caller's CWD (matches the shell adapter's spawn sites).
	const proc = spawn(file, withPico8Home(args), env, {stdin: true});

	// A spawn ENOENT means PICO-8 is absent (a bad PICO8_PATH surfaces the same
	// way): leave the structured marker the `start` client polls for, then exit.
	// This can only happen at spawn time (a launched binary does not ENOENT later),
	// so it is unambiguously the absent boundary, not a mid-session fault.
	proc.onError((err) => {
		if (err.code === 'ENOENT') {
			writeFileSync(
				join(config.paths.dir, PICO8_NOT_FOUND_MARKER),
				JSON.stringify(pico8NotFound()),
			);
			process.exit(0);
		}
		process.exit(1);
	});

	serveSession({
		id: config.id,
		paths: config.paths,
		process: proc,
		shotBasename: config.shotBasename,
		idleTimeoutMs: config.idleTimeoutMs,
		ackTimeoutMs: config.ackTimeoutMs,
		onExit: () => process.exit(0),
	});
}

/**
 * The daemon process main: reads the JSON config from `argv[0]` and runs. Called
 * by the hidden `playtest __daemon <configJson>` verb in a detached child.
 */
export function daemonMain(argv: readonly string[]): void {
	const raw = argv[0];
	if (raw === undefined) {
		process.stderr.write('playtest daemon: missing config\n');
		process.exit(2);
	}
	const config = JSON.parse(raw) as DaemonConfig;
	runDaemon(config);
}
