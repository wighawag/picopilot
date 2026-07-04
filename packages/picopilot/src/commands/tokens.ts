import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {type Cli, z} from 'incur';

import {
	type ShrinkoAdapter,
	ShrinkoParseError,
	ShellShrinkoAdapter,
} from '../engine/shrinko/index.js';

/** PICO-8's Lua token budget. A cart over this will not load in PICO-8 (US #3). */
export const TOKEN_BUDGET = 8192;

/**
 * Builds the {@link ShrinkoAdapter} a command uses, given the incur-resolved
 * env. The default is the shell-out {@link ShellShrinkoAdapter}, whose child
 * process inherits ONLY this `env` (its `PATH` is the test isolation lever).
 *
 * A test passes its own factory to {@link registerTokens} to SWAP a stub
 * adapter (the seam-swap contract): the command's public output/exit must be
 * unchanged whether the real shell adapter or a native-TS stub is behind the
 * seam, because the command only ever talks to the {@link ShrinkoAdapter}
 * interface.
 */
export type ShrinkoAdapterFactory = (env: NodeJS.ProcessEnv) => ShrinkoAdapter;

const defaultAdapterFactory: ShrinkoAdapterFactory = (env) =>
	new ShellShrinkoAdapter({env});

/**
 * Registers `picopilot tokens` (US #3), the first shrinko-backed command.
 *
 * It reports `{tokens, pct, chars, compressed}` for a cart against the 8,192
 * token budget via shrinko8 `--count`, and CTAs to `minify` when over budget so
 * the agent is led straight to the fix (the detect-then-fix loop, ADR CTAs).
 *
 * Two-tier contract (ADR-0002): `tokens` is shrinko-BACKED, so with shrinko
 * ABSENT it returns the structured `shrinko-not-found` error (nonzero exit,
 * exact remedy `uv pip install shrinko`) rather than crashing or reporting a
 * hollow zero. The dependency is reached entirely through the {@link
 * ShrinkoAdapter} seam, so a native-TS shrinko would satisfy this command
 * unchanged.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to swap the seam and to drive present/absent without the
 *   real binary.
 */
export function registerTokens(
	cli: Cli.Cli,
	adapterFactory: ShrinkoAdapterFactory = defaultAdapterFactory,
): void {
	cli.command('tokens', {
		description:
			'Count a cart against the 8,192-token PICO-8 budget (via shrinko8 --count). Requires shrinko.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to count. Defaults to main.p8 in the current folder.',
				),
		}),
		// Declaring PATH here makes incur resolve it from the (test-overridable)
		// env source and hand it to us, so we pass a controlled PATH to the child.
		env: z.object({
			PATH: z
				.string()
				.optional()
				.describe('Used to locate shrinko8 in the child process.'),
		}),
		output: z.object({
			tokens: z.number().describe('The token count shrinko reported.'),
			pct: z
				.number()
				.describe(
					'tokens as a percentage of the 8,192 budget (rounded); >100 means over budget.',
				),
			chars: z.number().describe('The character count shrinko reported.'),
			compressed: z
				.number()
				.optional()
				.describe('The compressed byte count (absent for some input formats).'),
			budget: z
				.number()
				.describe('The token budget the percentage is against (8192).'),
			overBudget: z.boolean().describe('True when tokens exceed the budget.'),
		}),
		examples: [
			{description: 'Count main.p8'},
			{description: 'Count a specific cart', args: {cart: 'game.p8'}},
		],
		async run({args, env, error, ok}) {
			const cartPath = isAbsolute(args.cart)
				? args.cart
				: resolve(process.cwd(), args.cart);

			// A missing cart is a picopilot-side error, distinct from shrinko absence:
			// surface it clearly instead of letting shrinko fail opaquely on the path.
			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			const adapter = adapterFactory(env as NodeJS.ProcessEnv);

			let result: Awaited<ReturnType<ShrinkoAdapter['count']>>;
			try {
				result = await adapter.count(cartPath);
			} catch (e) {
				// shrinko RAN but its output was unparseable (version/format drift):
				// a distinct `shrinko-failed`, NOT `shrinko-not-found` (which is absence).
				if (e instanceof ShrinkoParseError) {
					return error({
						code: 'shrinko-failed',
						message: `shrinko ran but its --count output could not be parsed: ${e.message}`,
						exitCode: 1,
					});
				}
				throw e;
			}

			if (!result.ok) {
				// The two-tier structured failure (ADR-0002 / US #17): shrinko absent.
				// The message CARRIES the exact remedy + needs so an agent reading only
				// the message still learns the fix; the code is the machine handle.
				return error({
					code: result.reason,
					message: `shrinko is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			const {tokens, chars, compressed} = result.value;
			const pct = Math.round((tokens / TOKEN_BUDGET) * 100);
			const overBudget = tokens > TOKEN_BUDGET;

			// Over budget → CTA to `minify` (the detect-then-fix loop). Under budget
			// needs no CTA: nothing to do.
			const cta = overBudget
				? {
						description: 'Over the 8,192-token budget. Reclaim tokens with:',
						commands: [
							{
								command: 'minify',
								description:
									'Safe-minify the cart to reduce tokens without changing behaviour.',
							},
						],
					}
				: undefined;

			return ok(
				{
					tokens,
					pct,
					chars,
					compressed,
					budget: TOKEN_BUDGET,
					overBudget,
				},
				cta === undefined ? undefined : {cta},
			);
		},
	});
}
