import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {type Cli, Cli as IncurCli, z} from 'incur';
import {
	buildDriveHarness,
	DEFAULT_ACK_TIMEOUT_MS,
	DEFAULT_IDLE_TIMEOUT_MS,
	DONE_SENTINEL,
	DriveError,
	type Pico8Adapter,
	PICO8_NOT_FOUND_MARKER,
	parseButtons,
	parseInputScript,
	SessionClient,
	SessionRegistry,
	sessionExists,
	SHOT_BASENAME,
	ShellPico8Adapter,
	spawnSessionDaemon,
	type SessionRequest,
	type SessionResponse,
	type SessionResponseValue,
} from '../engine/pico8/index.js';

/**
 * Injects the PICO-8 adapter `playtest` uses (defaults to the shell adapter over
 * native `pico8 -x`). Mirrors `run`'s `Pico8AdapterFactory` seam: a test passes a
 * stub to drive the drive-orchestration + the absent path WITHOUT the paid
 * binary, and to isolate the child `env` (its `PICO8_PATH`/`PATH`).
 */
export type Pico8AdapterFactory = (env: NodeJS.ProcessEnv) => Pico8Adapter;

const defaultAdapterFactory: Pico8AdapterFactory = (env) =>
	new ShellPico8Adapter({env});

/**
 * The default backstop: kill a driven cart that never signals/exits after this
 * many ms. Larger than `run`'s screenshot default because a driven run advances
 * a scripted sequence of frames (plus PICO-8 startup), not a single quick pass.
 */
const DEFAULT_BACKSTOP_MS = 20_000;

/** How long `start` waits for the daemon to become READY (socket) or report absent. */
const START_READY_TIMEOUT_MS = 15_000;
/** How often `start` polls for the daemon's readiness/absence markers. */
const START_POLL_MS = 50;

/** Resolves a path argument to an absolute path (relative to cwd). */
function resolvePath(p: string): string {
	return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/** A small sleep for the `start` readiness poll. */
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Registers `picopilot playtest`, the driven-playtest command group (ADR-0011).
 * The ROOT command (`playtest <cart>`) is the ONE-SHOT driver (US #1-5,7-11): it
 * sends the whole scripted input up front and captures gameplay in one envelope.
 * The SUBCOMMANDS are the RESUMABLE LIVE SESSION (US #6, the "A" model): `start`
 * launches a persistent driven process the agent addresses BY ID, and `step` /
 * `input` / `shot` / `stop` / `status` drive it across SEPARATE invocations while
 * the game stays alive + paused between turns, over the same verified block+ACK
 * transport. The cart-side drive-transform is reused UNCHANGED (see `drive.ts`).
 *
 * PICO-8 absent -> structured `pico8-not-found` + nonzero exit (mirrors `run`),
 * never a crash or a hang. The CI-testable surface is the pure transform + the
 * session handshake core (against a fake process); a live multi-turn session is
 * the manual/opt-in tier.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present/absent without the real binary.
 */
export function registerPlaytest(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
): void {
	cli.command(buildPlaytestGroup(adapterFactory));
}

/**
 * Builds the `playtest` command GROUP: `playtest run <cart>` (the one-shot
 * driver, US #1-5,7-11) plus the resumable LIVE session verbs `start`/`step`/
 * `input`/`shot`/`stop`/`status` (US #6). `playtest` is a verb group (not a bare
 * `playtest <cart>`) because the resumable session needs first-class sibling verbs
 * that a bare positional-arg root would swallow; see the ## Decisions note in the
 * task. The one-shot's behaviour + flags are unchanged, only its path moved from
 * `playtest <cart>` to `playtest run <cart>`.
 */
function buildPlaytestGroup(adapterFactory: Pico8AdapterFactory): Cli.Cli {
	const playtest = IncurCli.create('playtest', {
		description:
			'Drive an arbitrary cart through input and capture LIVE gameplay (not the title). `playtest run <cart>` is a one-shot scripted drive; `start`/`step`/`input`/`shot`/`stop` are a resumable LIVE session you play across turns. Transforms a throwaway copy of the cart (btn/btnp -> serial, harness-owned frame loop); your cart is untouched. Requires PICO-8.',
	});

	playtest.command('run', {
		description:
			'One-shot: drive an arbitrary cart through a scripted input and capture LIVE gameplay (not the title) in ONE structured envelope. Transforms a throwaway copy of the cart; your cart is untouched. Requires PICO-8.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to playtest. Defaults to main.p8 in the current folder.',
				),
		}),
		options: z.object({
			input: z
				.string()
				.optional()
				.describe(
					'Scripted input as a comma list of "frame:bit" (single press) or "from-to:bit" (hold), bit 0=L 1=R 2=U 3=D 4=O 5=X, e.g. "3:4, 18-22:4, 20:1". Omit for the generic one-button/runner/flappy driver.',
				),
			seed: z
				.number()
				.int()
				.optional()
				.describe(
					'Opt-in determinism: inject srand(n) at cart start so an otherwise-random cart replays identically. Omitted = no srand injected (never silent).',
				),
			frames: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					'How many frames to drive the cart for (defaults to a short window that reaches play).',
				),
			shotDir: z
				.string()
				.optional()
				.describe(
					'Where PICO-8 writes gameplay screenshots (-desktop). Defaults to an isolated temp dir; NEVER ~/Desktop.',
				),
			sentinel: z
				.string()
				.default(DONE_SENTINEL)
				.describe(
					'The stdout line that ends the run. The driven cart printh-es this on QUIT.',
				),
			backstopMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_BACKSTOP_MS)
				.describe(
					'Safety backstop: kill PICO-8 after this many ms if it never signals.',
				),
		}),
		env: PLAYTEST_ENV,
		output: z.object({
			screenshots: z
				.array(z.string())
				.describe(
					'Absolute paths of the gameplay PNG screenshots the driven cart produced.',
				),
			printh: z
				.string()
				.describe('Captured stdout (the cart ACKs + printh + the sentinel).'),
			exitReason: z
				.enum(['sentinel', 'timeout', 'exit'])
				.describe(
					'sentinel = cart signalled done; timeout = backstop fired; exit = PICO-8 quit.',
				),
			shotDir: z.string().describe('The dir screenshots were written to.'),
			steps: z
				.number()
				.int()
				.describe('The number of driven-run command blocks sent to the cart.'),
			shotCount: z
				.number()
				.int()
				.describe(
					'The number of screenshots the script requested (SHOT commands).',
				),
			seeded: z
				.boolean()
				.describe('Whether a --seed was injected (deterministic replay).'),
		}),
		examples: [
			{description: 'Playtest main.p8 with the generic driver (one-shot)'},
			{
				description: 'Drive a specific cart with a scripted input (one-shot)',
				args: {cart: 'game.p8'},
				options: {input: '3:4, 18-22:4, 20:1'},
			},
			{
				description: 'Deterministic replay with a fixed seed',
				args: {cart: 'game.p8'},
				options: {seed: 1, input: '3:4'},
			},
		],
		async run(ctx: any) {
			return runOneShot(
				{
					args: ctx.args,
					options: ctx.options,
					env: ctx.env,
					error: ctx.error,
					ok: ctx.ok as (value: unknown, extra?: unknown) => never,
				},
				adapterFactory,
			);
		},
	});

	registerSessionVerbs(playtest as unknown as Cli.Cli);
	return playtest as unknown as Cli.Cli;
}

/** The env schema the whole `playtest` group shares (locates the binary, isolated). */
const PLAYTEST_ENV = z.object({
	PICO8_PATH: z
		.string()
		.optional()
		.describe('Explicit path to the PICO-8 binary (else `pico8` on PATH).'),
	PATH: z.string().optional().describe('Used to locate `pico8`.'),
});

/**
 * The ONE-SHOT root handler (unchanged behaviour from the one-shot task): build
 * the throwaway driven cart, pipe the whole scripted input as fixed-size blocks,
 * capture the SHOT screenshots, return one structured envelope.
 */
async function runOneShot<R>(
	ctx: {
		args: {cart: string};
		options: {
			input?: string;
			seed?: number;
			frames?: number;
			shotDir?: string;
			sentinel: string;
			backstopMs: number;
		};
		env: {PICO8_PATH?: string; PATH?: string};
		error: (e: {code: string; message: string; exitCode: number}) => R;
		ok: (value: unknown, extra?: unknown) => R;
	},
	adapterFactory: Pico8AdapterFactory,
): Promise<R> {
	const {args, options, env, error, ok} = ctx;
	const cartPath = resolvePath(args.cart);

	if (!existsSync(cartPath)) {
		return error({
			code: 'cart-not-found',
			message: `no cart at ${cartPath}`,
			exitCode: 1,
		});
	}

	let presses;
	if (options.input !== undefined) {
		try {
			presses = parseInputScript(options.input);
		} catch (e) {
			if (e instanceof DriveError) {
				return error({code: e.code, message: e.message, exitCode: 1});
			}
			throw e;
		}
	}

	let harness;
	try {
		harness = buildDriveHarness(readFileSync(cartPath, 'utf8'), {
			presses,
			frames: options.frames,
			seed: options.seed,
			sentinel: options.sentinel,
		});
	} catch (e) {
		if (e instanceof DriveError) {
			return error({code: e.code, message: e.message, exitCode: 1});
		}
		throw e;
	}

	const shotDir =
		options.shotDir !== undefined
			? resolvePath(options.shotDir)
			: mkdtempSync(join(tmpdir(), 'picopilot-playtest-'));
	if (!existsSync(shotDir)) mkdirSync(shotDir, {recursive: true});

	const drivenCart = join(shotDir, 'driven.p8');
	writeFileSync(drivenCart, harness.cartText);

	const adapter = adapterFactory(env as NodeJS.ProcessEnv);
	const result = await adapter.drive({
		cartPath: drivenCart,
		shotDir,
		blocks: harness.blocks,
		sentinel: options.sentinel,
		backstopMs: options.backstopMs,
	});

	if (!result.ok) {
		return error({
			code: result.reason,
			message: `PICO-8 is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
			exitCode: 1,
		});
	}

	const {screenshots, printh, exitReason} = result.value;
	const cta =
		exitReason === 'timeout'
			? {
					description:
						'The driven cart never printed the done-sentinel (backstop fired). Check for a fault:',
					commands: [
						{
							command: 'verify',
							description: 'Run the static gate (tokens + lint + integrity).',
						},
						{
							command: 'run',
							description: 'Boot the cart on its own to see what it draws.',
						},
					],
				}
			: undefined;

	return ok(
		{
			screenshots: [...screenshots],
			printh,
			exitReason,
			shotDir,
			steps: harness.script.length,
			shotCount: harness.shotCount,
			seeded: options.seed !== undefined,
		},
		cta === undefined ? undefined : {cta},
	);
}

// ---------------------------------------------------------------------------
// The RESUMABLE LIVE SESSION verbs (US #6, the "A" model).
// ---------------------------------------------------------------------------

/** The structured output shape the session verbs return. */
const SESSION_OUTPUT = z.object({
	id: z.string().describe('The session id to address in later verbs.'),
	frame: z
		.number()
		.int()
		.describe('Total frames the session has advanced so far.'),
	alive: z
		.boolean()
		.describe(
			'Whether the session is still alive (the game is paused, ready).',
		),
	ack: z
		.string()
		.optional()
		.describe('The cart ACK line for this command (settled-frame proof).'),
	screenshot: z
		.string()
		.optional()
		.describe('For `shot`: the absolute path of the captured frame PNG.'),
	shotName: z
		.string()
		.optional()
		.describe('For `shot`: the basename the cart named the capture.'),
	shotDir: z
		.string()
		.optional()
		.describe('The dir the session writes screenshots into (never ~/Desktop).'),
});

/** Registers `start`/`step`/`input`/`shot`/`stop`/`status` on the group. */
function registerSessionVerbs(playtest: Cli.Cli): void {
	// --- playtest start <cart> -------------------------------------------------
	playtest.command('start', {
		description:
			'Start a RESUMABLE live playtest session on a cart: launches a persistent driven PICO-8 (paused) and returns a session id you drive with step/input/shot/stop across turns. Requires PICO-8; absent -> structured pico8-not-found.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe('The .p8 cart to start a session on. Defaults to main.p8.'),
		}),
		options: z.object({
			id: z
				.string()
				.optional()
				.describe(
					'A session id to use (1-64 chars of [A-Za-z0-9._-]). Omit for a fresh random id.',
				),
			seed: z
				.number()
				.int()
				.optional()
				.describe(
					'Opt-in determinism: inject srand(n) at cart start (never silent).',
				),
			idleTimeoutMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_IDLE_TIMEOUT_MS)
				.describe(
					'Orphan reap: tear the session (and PICO-8) down after this idle window.',
				),
			ackTimeoutMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_ACK_TIMEOUT_MS)
				.describe(
					'Per-command deadline to wait for the cart ACK before failing.',
				),
		}),
		env: PLAYTEST_ENV,
		output: SESSION_OUTPUT,
		examples: [
			{description: 'Start a session on main.p8'},
			{
				description: 'Start a named, seeded session',
				args: {cart: 'game.p8'},
				options: {id: 'run1', seed: 1},
			},
		],
		async run({args, options, env, error, ok}) {
			const cartPath = resolvePath(args.cart);
			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			// Resolve/validate the session id and its controlled on-disk layout.
			const registry = new SessionRegistry();
			let id: string;
			try {
				id =
					options.id !== undefined
						? SessionRegistry.validateId(options.id)
						: SessionRegistry.freshId();
			} catch (e) {
				return error({
					code: 'playtest-session-id-invalid',
					message: e instanceof Error ? e.message : String(e),
					exitCode: 1,
				});
			}
			if (options.id !== undefined && sessionExists(registry.resolve(id))) {
				return error({
					code: 'playtest-session-exists',
					message: `a session "${id}" is already running; stop it first or use a new id`,
					exitCode: 1,
				});
			}
			const paths = registry.create(id);

			// Build the throwaway driven cart from a COPY (the shim + optional srand).
			// The blocks are ignored: a live session drives commands per-verb.
			let harness;
			try {
				harness = buildDriveHarness(readFileSync(cartPath, 'utf8'), {
					seed: options.seed,
					shotBasename: SHOT_BASENAME,
				});
			} catch (e) {
				if (e instanceof DriveError) {
					registry.remove(id);
					return error({code: e.code, message: e.message, exitCode: 1});
				}
				throw e;
			}
			const drivenCart = join(paths.dir, 'driven.p8');
			writeFileSync(drivenCart, harness.cartText);

			// Spawn the detached daemon, then wait for it to become READY (socket) or
			// report PICO-8 ABSENT (marker), or time out.
			spawnSessionDaemon({
				id,
				paths,
				cartPath: drivenCart,
				shotBasename: SHOT_BASENAME,
				idleTimeoutMs: options.idleTimeoutMs,
				ackTimeoutMs: options.ackTimeoutMs,
			});

			const readiness = await waitForReady(paths, START_READY_TIMEOUT_MS);
			if (readiness === 'absent') {
				registry.remove(id);
				return error({
					code: 'pico8-not-found',
					message:
						'PICO-8 is not installed. set PICO8_PATH or install PICO-8 (needs: pico8)',
					exitCode: 1,
				});
			}
			if (readiness === 'timeout') {
				registry.remove(id);
				return error({
					code: 'playtest-session-start-failed',
					message: `the session daemon did not become ready within ${START_READY_TIMEOUT_MS}ms`,
					exitCode: 1,
				});
			}

			return ok(
				{id, frame: 0, alive: true, shotDir: paths.shotDir},
				{
					cta: {
						description: `Session "${id}" is live and paused. Drive it:`,
						commands: [
							{
								command: `playtest input ${id} "right o"`,
								description: 'Hold buttons for the next steps.',
							},
							{
								command: `playtest step ${id} --frames 30`,
								description: 'Advance exactly N frames, then pause.',
							},
							{
								command: `playtest shot ${id}`,
								description: 'Capture the current frozen frame.',
							},
							{
								command: `playtest stop ${id}`,
								description: 'Tear the session down.',
							},
						],
					},
				},
			);
		},
	});

	// --- playtest input <id> <buttons> ----------------------------------------
	playtest.command('input', {
		description:
			'Inject held buttons for the upcoming steps of a live session. Buttons are names (left/right/up/down/o/x, or l/r/u/d), space- or comma-separated; an empty string releases all.',
		args: z.object({
			id: z.string().describe('The session id (from `playtest start`).'),
			buttons: z
				.string()
				.default('')
				.describe('Held buttons, e.g. "right o". Empty = release all.'),
		}),
		env: PLAYTEST_ENV,
		output: SESSION_OUTPUT,
		examples: [
			{description: 'Hold Right + O', args: {id: 'run1', buttons: 'right o'}},
			{description: 'Release all', args: {id: 'run1', buttons: ''}},
		],
		async run({args, error, ok}) {
			let held: number;
			try {
				held = parseButtons(args.buttons);
			} catch (e) {
				if (e instanceof DriveError) {
					return error({code: e.code, message: e.message, exitCode: 1});
				}
				throw e;
			}
			return sendVerb(args.id, {verb: 'input', held}, error, ok);
		},
	});

	// --- playtest step <id> --frames N ----------------------------------------
	playtest.command('step', {
		description:
			'Advance a live session EXACTLY N frames then pause (deterministic via the ACK handshake). The game stays paused on a settled frame between steps.',
		args: z.object({
			id: z.string().describe('The session id (from `playtest start`).'),
		}),
		options: z.object({
			frames: z
				.number()
				.int()
				.positive()
				.default(1)
				.describe('The exact number of frames to advance (default 1).'),
		}),
		env: PLAYTEST_ENV,
		output: SESSION_OUTPUT,
		examples: [
			{description: 'Advance one frame', args: {id: 'run1'}},
			{
				description: 'Advance 30 frames',
				args: {id: 'run1'},
				options: {frames: 30},
			},
		],
		async run({args, options, error, ok}) {
			return sendVerb(
				args.id,
				{verb: 'step', frames: options.frames},
				error,
				ok,
			);
		},
	});

	// --- playtest shot <id> ----------------------------------------------------
	playtest.command('shot', {
		description:
			'Capture the current (paused, frozen) frame of a live session as a PNG and return its path.',
		args: z.object({
			id: z.string().describe('The session id (from `playtest start`).'),
		}),
		env: PLAYTEST_ENV,
		output: SESSION_OUTPUT,
		examples: [
			{description: 'Screenshot the current frame', args: {id: 'run1'}},
		],
		async run({args, error, ok}) {
			return sendVerb(args.id, {verb: 'shot'}, error, ok);
		},
	});

	// --- playtest status <id> --------------------------------------------------
	playtest.command('status', {
		description:
			'Report a live session: whether it is alive (game paused, ready) and its frame count.',
		args: z.object({
			id: z.string().describe('The session id (from `playtest start`).'),
		}),
		env: PLAYTEST_ENV,
		output: SESSION_OUTPUT,
		examples: [{description: 'Check a session', args: {id: 'run1'}}],
		async run({args, error, ok}) {
			return sendVerb(args.id, {verb: 'status'}, error, ok);
		},
	});

	// --- playtest stop <id> ----------------------------------------------------
	playtest.command('stop', {
		description:
			'Tear down a live session: quit its PICO-8 and reap its dir. Idempotent; safe on an already-dead session.',
		args: z.object({
			id: z.string().describe('The session id (from `playtest start`).'),
		}),
		env: PLAYTEST_ENV,
		output: SESSION_OUTPUT,
		examples: [{description: 'Stop a session', args: {id: 'run1'}}],
		async run({args, error, ok}) {
			const registry = new SessionRegistry();
			let paths;
			try {
				paths = registry.resolve(args.id);
			} catch (e) {
				return error({
					code: 'playtest-session-id-invalid',
					message: e instanceof Error ? e.message : String(e),
					exitCode: 1,
				});
			}
			// A stop on a session with no live daemon is a no-op success (idempotent):
			// clean up any leftover dir and report it gone.
			if (!sessionExists(paths)) {
				registry.remove(args.id);
				return ok({id: args.id, frame: 0, alive: false});
			}
			const res = await sendVerb(args.id, {verb: 'stop'}, error, ok);
			// The daemon reaps its own dir on teardown; sweep any residue.
			registry.remove(args.id);
			return res;
		},
	});
}

/**
 * Polls for the daemon becoming READY (its socket appears) or reporting PICO-8
 * ABSENT (its marker file appears), or a timeout. This is how `start` turns the
 * detached daemon's async startup into a synchronous structured result.
 */
async function waitForReady(
	paths: {socket: string; dir: string},
	timeoutMs: number,
): Promise<'ready' | 'absent' | 'timeout'> {
	const marker = join(paths.dir, PICO8_NOT_FOUND_MARKER);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(marker)) return 'absent';
		if (existsSync(paths.socket)) return 'ready';
		await sleep(START_POLL_MS);
	}
	return 'timeout';
}

/**
 * Sends one verb to a session daemon and maps its {@link SessionResponse} onto the
 * command's ok/error. A connection failure (no daemon at that id) is the
 * structured `playtest-session-not-found`; a daemon error (a lost ack, a dead
 * process) is surfaced with its structured code. Never a hang.
 */
async function sendVerb<R>(
	id: string,
	request: SessionRequest,
	error: (e: {code: string; message: string; exitCode: number}) => R,
	ok: (value: SessionResponseValue) => R,
): Promise<R> {
	const registry = new SessionRegistry();
	let paths;
	try {
		paths = registry.resolve(id);
	} catch (e) {
		return error({
			code: 'playtest-session-id-invalid',
			message: e instanceof Error ? e.message : String(e),
			exitCode: 1,
		});
	}
	if (!sessionExists(paths)) {
		return error({
			code: 'playtest-session-not-found',
			message: `no live session "${id}" (start one with \`playtest start\`)`,
			exitCode: 1,
		});
	}

	let response: SessionResponse;
	try {
		response = await new SessionClient(paths.socket).send(request);
	} catch (e) {
		return error({
			code: 'playtest-session-not-found',
			message: `could not reach session "${id}": ${e instanceof Error ? e.message : String(e)}`,
			exitCode: 1,
		});
	}

	if (!response.ok) {
		return error({
			code: response.code,
			message: response.message,
			exitCode: 1,
		});
	}
	return ok(response.value);
}
