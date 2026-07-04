import {execFile} from 'node:child_process';

import {
	type CountReport,
	parseCount,
	type ShrinkoAdapter,
	type ShrinkoResult,
	shrinkoNotFound,
} from './adapter.js';

/**
 * The result of running one child process: its exit `code` (null when killed by
 * a signal), captured `stdout`/`stderr`, and `spawnError` set when the binary
 * could not be launched AT ALL (ENOENT etc.) rather than launched-and-exited.
 * `spawnError` is how the shell adapter distinguishes "shrinko is not installed"
 * from "shrinko ran and failed".
 */
export interface ChildResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly spawnError: NodeJS.ErrnoException | undefined;
}

/**
 * The child-process seam. The real implementation shells out with the CALLER's
 * `env` (so a test overrides the child's `PATH` and nothing else). Tests inject
 * a stub runner to simulate shrinko present/absent WITHOUT ever requiring the
 * real binary, and to assert exactly what argv/env the adapter would spawn.
 */
export type ChildRunner = (
	file: string,
	args: string[],
	env: NodeJS.ProcessEnv,
) => Promise<ChildResult>;

/**
 * The default {@link ChildRunner}: an `execFile` that captures stdout/stderr and
 * NEVER rejects. A failed spawn (ENOENT) becomes `spawnError`; a nonzero exit
 * becomes a `code`, so both outcomes are data the adapter maps to a structured
 * result. The child inherits ONLY the `env` it is handed (the command layer
 * passes the incur-resolved env, whose `PATH` a test can override) so there is
 * no ambient-environment leak.
 */
export const execFileRunner: ChildRunner = (file, args, env) =>
	new Promise((resolve) => {
		execFile(file, args, {env, encoding: 'utf8'}, (error, stdout, stderr) => {
			const err = error as NodeJS.ErrnoException | null;
			resolve({
				// `execFile` sets error.code to the string 'ENOENT' on spawn failure and
				// to the numeric exit code on a nonzero exit; separate the two.
				code:
					err !== null && typeof err.code === 'number'
						? err.code
						: err === null
							? 0
							: null,
				stdout,
				stderr,
				spawnError:
					err !== null && typeof err.code === 'string' ? err : undefined,
			});
		});
	});

/**
 * The candidate ways to invoke shrinko, tried in order. First the `shrinko8`
 * entry-point on `PATH`, then `python -m shrinko8` / `python3 -m shrinko8` as
 * fallbacks (the module is `shrinko8`; the pip package is `shrinko`). The first
 * candidate that SPAWNS (does not ENOENT) is the one shrinko is reached through.
 */
const SHRINKO_INVOCATIONS: readonly (readonly string[])[] = [
	['shrinko8'],
	['python', '-m', 'shrinko8'],
	['python3', '-m', 'shrinko8'],
];

/** Options for {@link ShellShrinkoAdapter}. */
export interface ShellShrinkoOptions {
	/**
	 * The environment handed to the child process. The command layer passes the
	 * incur-resolved env here; its `PATH` is the isolation lever a test overrides
	 * (an empty/`PATH`-less env makes every invocation ENOENT ⇒ shrinko-absent).
	 */
	readonly env: NodeJS.ProcessEnv;
	/** The child runner (defaults to {@link execFileRunner}); tests inject a stub. */
	readonly run?: ChildRunner;
}

/**
 * The v1 {@link ShrinkoAdapter}: shells out to a user-installed Python
 * `shrinko8` (ADR-0001). It is the ONLY place that knows shrinko is an external
 * process; every command talks to the {@link ShrinkoAdapter} interface, so a
 * future native-TS adapter replaces this class without touching a command.
 *
 * Presence detection and invocation are the SAME act: the adapter tries each
 * {@link SHRINKO_INVOCATIONS} candidate and uses the first that spawns. If every
 * candidate ENOENTs, shrinko is absent and the method returns the structured
 * {@link shrinkoNotFound} value (never a throw, never a hollow success).
 */
export class ShellShrinkoAdapter implements ShrinkoAdapter {
	private readonly env: NodeJS.ProcessEnv;
	private readonly run: ChildRunner;

	constructor(options: ShellShrinkoOptions) {
		this.env = options.env;
		this.run = options.run ?? execFileRunner;
	}

	async count(cartPath: string): Promise<ShrinkoResult<CountReport>> {
		const outcome = await this.invoke([cartPath, '--count']);
		if (outcome === undefined) {
			return shrinkoNotFound();
		}
		// shrinko prints the count report; some builds send it to stderr, so parse
		// the combined stream. parseCount throws on unparseable output (ShrinkoParseError).
		return {
			ok: true,
			value: parseCount(`${outcome.stdout}\n${outcome.stderr}`),
		};
	}

	/**
	 * Runs shrinko with the given trailing args, trying each invocation candidate
	 * until one SPAWNS. Returns the {@link ChildResult} of the first candidate
	 * that launched, or `undefined` when every candidate ENOENTs (shrinko absent).
	 */
	private async invoke(args: string[]): Promise<ChildResult | undefined> {
		for (const inv of SHRINKO_INVOCATIONS) {
			const [file, ...prefix] = inv as [string, ...string[]];
			const result = await this.run(file, [...prefix, ...args], this.env);
			if (result.spawnError === undefined) {
				return result;
			}
			// ENOENT on this candidate: fall through to the next. Any other spawn
			// error (EACCES etc.) also falls through, so a broken candidate never
			// masks a working one.
		}
		return undefined;
	}
}
