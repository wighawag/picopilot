import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {type Cli, z} from 'incur';
import {
	buildDriveHarness,
	DONE_SENTINEL,
	DriveError,
	type Pico8Adapter,
	parseInputScript,
	ShellPico8Adapter,
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

/**
 * Registers `picopilot playtest`, the driven-playtest command (ADR-0011, US
 * #1-5,7-11). It DRIVES an arbitrary cart through a scripted button sequence and
 * captures it during ACTUAL gameplay (not the title screen), returning one
 * structured envelope (screenshots + printh + the steps run). The mechanism is
 * the tested `engine/pico8` drive-transform: on a THROWAWAY copy of the cart it
 * redefines `btn`/`btnp` to read a harness-piped held-buttons byte (reconstructing
 * `btnp` edges) and owns the frame loop; the entry's own cart is UNTOUCHED.
 *
 * This is the ONE-SHOT slice: the whole opcode/input script is sent up front as
 * FIXED-SIZE command blocks and the cart replays it to completion, then exits.
 * A generic input default (press-to-start + a few gentle presses + a short hold +
 * a right-nudge) applies when `--input` is omitted, reaching play for common
 * one-button/runner/flappy shapes; an explicit per-cart `--input` overrides it.
 *
 * PICO-8 absent -> structured `pico8-not-found` + nonzero exit (mirrors `run`),
 * never a crash or a hang. That absent path is the CI-testable one; live
 * drive-and-capture is a manual/opt-in tier.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present/absent without the real binary.
 */
export function registerPlaytest(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
): void {
	cli.command('playtest', {
		description:
			'Drive an arbitrary cart through scripted input and capture it during LIVE gameplay (not the title). Transforms a throwaway copy of the cart (btn/btnp -> serial, harness-owned frame loop); your cart is untouched. Requires PICO-8.',
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
		env: z.object({
			PICO8_PATH: z
				.string()
				.optional()
				.describe('Explicit path to the PICO-8 binary (else `pico8` on PATH).'),
			PATH: z.string().optional().describe('Used to locate `pico8`.'),
		}),
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
			{description: 'Playtest main.p8 with the generic driver'},
			{
				description: 'Drive a specific cart with a scripted input',
				args: {cart: 'game.p8'},
				options: {input: '3:4, 18-22:4, 20:1'},
			},
			{
				description: 'Deterministic replay with a fixed seed',
				args: {cart: 'game.p8'},
				options: {seed: 1, input: '3:4'},
			},
		],
		async run({args, options, env, error, ok}) {
			const cartPath = isAbsolute(args.cart)
				? args.cart
				: resolve(process.cwd(), args.cart);

			// A missing cart is a picopilot-side error, distinct from PICO-8 absence.
			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			// Parse the explicit input script (if any) BEFORE touching PICO-8, so a
			// malformed spec is a fast, structured refusal (not a wasted launch).
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

			// Build the throwaway driven cart from a COPY of the entry's cart text.
			// The entry's own main.p8 is never mutated (the transform is pure).
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

			// Screenshot + throwaway-cart dir: a user-given path, else an isolated temp
			// dir. NEVER the default ~/Desktop (the `-desktop` flag is the isolation
			// lever). Both the driven cart AND its screenshots live here.
			const shotDir =
				options.shotDir !== undefined
					? isAbsolute(options.shotDir)
						? options.shotDir
						: resolve(process.cwd(), options.shotDir)
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
				// The two-tier structured failure (ADR-0006/0011): PICO-8 absent. The
				// message carries the exact remedy + needs; the code is the handle.
				return error({
					code: result.reason,
					message: `PICO-8 is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			const {screenshots, printh, exitReason} = result.value;

			// A backstop timeout is a soft warning: the driven cart never signalled
			// done, so it may have hung, errored, or reassigned its own _update at
			// runtime (the documented transform-safety caveat, ADR-0011).
			const cta =
				exitReason === 'timeout'
					? {
							description:
								'The driven cart never printed the done-sentinel (backstop fired). Check for a fault:',
							commands: [
								{
									command: 'verify',
									description:
										'Run the static gate (tokens + lint + integrity).',
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
		},
	});
}
