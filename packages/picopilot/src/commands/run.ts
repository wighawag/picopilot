import {existsSync, mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {type Cli, z} from 'incur';
import {
	DONE_SENTINEL,
	type Pico8Adapter,
	ShellPico8Adapter,
} from '../engine/pico8/index.js';

/**
 * Injects the PICO-8 adapter `run` uses (defaults to the shell adapter over
 * native `pico8 -x`). Mirrors the shrinko `adapterFactory` seam: a test passes a
 * stub to drive the sentinel/backstop/absent paths without the paid binary, and
 * to isolate the child `env` (its `PICO8_PATH`/`PATH`).
 */
export type Pico8AdapterFactory = (env: NodeJS.ProcessEnv) => Pico8Adapter;

const defaultAdapterFactory: Pico8AdapterFactory = (env) =>
	new ShellPico8Adapter({env});

/** The default backstop: kill a cart that never signals/exits after this many ms. */
const DEFAULT_BACKSTOP_MS = 15_000;

/**
 * Registers `picopilot run`, the THIN sentinel-watch + screenshot-collect
 * orchestration command (US #14, ADR-0006). It is NOT a `pico8` wrapper: its
 * value is the glue an agent should not hand-roll every run, launch PICO-8,
 * stream stdout, kill on the cart's done-sentinel (backstop as the safety net),
 * and collect screenshots + printh + exit reason into ONE structured result.
 *
 * The cart cooperates: it self-screenshots via `extcmd("screen")` on a timer and
 * prints the done-sentinel via `printh` when finished (the `picopilot-debug`
 * skill teaches the recipe). A cart cannot self-quit the app, so the external
 * sentinel-kill IS the quit mechanism.
 *
 * PICO-8 absent → structured `pico8-not-found` + nonzero exit (mirrors the
 * shrinko boundary), never a crash or a hang. That absent path is the one
 * exercised in CI; live runs are a manual/opt-in tier.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present/absent without the real binary.
 */
export function registerRun(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
): void {
	cli.command('run', {
		description:
			"Run a cart on the user's PICO-8, capture printh + screenshots, end on a done-sentinel. Requires PICO-8.",
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to run. Defaults to main.p8 in the current folder.',
				),
		}),
		options: z.object({
			shotDir: z
				.string()
				.optional()
				.describe(
					'Where PICO-8 writes screenshots (-desktop). Defaults to an isolated temp dir; NEVER ~/Desktop.',
				),
			sentinel: z
				.string()
				.default(DONE_SENTINEL)
				.describe(
					'The stdout line that ends the run. The cart printh-es this when done.',
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
		// incur resolves these from the (test-overridable) env source and hands
		// them to the child, so PICO8_PATH/PATH locate the binary in isolation.
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
				.describe('Absolute paths of the PNG screenshots the cart produced.'),
			printh: z
				.string()
				.describe('Captured stdout (the cart printh output + PICO-8 lines).'),
			exitReason: z
				.enum(['sentinel', 'timeout', 'exit'])
				.describe(
					'sentinel = cart signalled done; timeout = backstop fired; exit = PICO-8 quit.',
				),
			shotDir: z.string().describe('The dir screenshots were written to.'),
		}),
		examples: [
			{description: 'Run main.p8'},
			{description: 'Run a specific cart', args: {cart: 'game.p8'}},
			{
				description: 'Collect screenshots into a chosen dir',
				args: {cart: 'game.p8'},
				options: {shotDir: './shots'},
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

			// Screenshot dir: a user-given path, else an isolated temp dir. NEVER the
			// default ~/Desktop (the `-desktop` flag is the isolation lever). Create
			// it so PICO-8 has somewhere to write.
			const shotDir =
				options.shotDir !== undefined
					? isAbsolute(options.shotDir)
						? options.shotDir
						: resolve(process.cwd(), options.shotDir)
					: mkdtempSync(join(tmpdir(), 'picopilot-run-'));
			if (!existsSync(shotDir)) mkdirSync(shotDir, {recursive: true});

			const adapter = adapterFactory(env as NodeJS.ProcessEnv);
			const result = await adapter.run({
				cartPath,
				shotDir,
				sentinel: options.sentinel,
				backstopMs: options.backstopMs,
			});

			if (!result.ok) {
				// The two-tier structured failure (US #19, ADR-0006): PICO-8 absent.
				// The message carries the exact remedy + needs; the code is the handle.
				return error({
					code: result.reason,
					message: `PICO-8 is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			const {screenshots, printh, exitReason} = result.value;

			// A backstop timeout is a soft warning: the cart never signalled done, so
			// it may have hung or errored. CTA the agent toward the static checks
			// (lint/tokens) to catch a code fault before re-running.
			const cta =
				exitReason === 'timeout'
					? {
							description:
								'The cart never printed the done-sentinel (backstop fired). Check for a fault:',
							commands: [
								{
									command: 'verify',
									description:
										'Run the static gate (tokens + lint + integrity).',
								},
								{
									command: 'tokens',
									description: 'Confirm the cart is under the token budget.',
								},
							],
						}
					: undefined;

			return ok(
				{screenshots: [...screenshots], printh, exitReason, shotDir},
				cta === undefined ? undefined : {cta},
			);
		},
	});
}
