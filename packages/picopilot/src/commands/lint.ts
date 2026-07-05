import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {type Cli, z} from 'incur';
import {
	type ShrinkoAdapter,
	ShellShrinkoAdapter,
} from '../engine/shrinko/index.js';

/** See {@link import('./tokens.js').ShrinkoAdapterFactory}: lint reuses the same seam. */
export type ShrinkoAdapterFactory = (env: NodeJS.ProcessEnv) => ShrinkoAdapter;

const defaultAdapterFactory: ShrinkoAdapterFactory = (env) =>
	new ShellShrinkoAdapter({env});

/**
 * Registers `picopilot lint` (US #4): surface PICO-8-specific issues (undefined
 * globals, unused/duplicate locals, and, via the parsed findings, the classic
 * gotchas) as STRUCTURED findings via shrinko8 `--lint`, so an agent catches
 * them before running. Findings are DATA: a cart WITH warnings is a successful
 * lint that reports them (exit 0), not a failure exit; only a broken cart or a
 * missing dependency is an error.
 *
 * shrinko-backed: absent shrinko returns the structured `shrinko-not-found`
 * error + nonzero exit (ADR-0002), mirroring `tokens`.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present/absent without the real binary.
 */
export function registerLint(
	cli: Cli.Cli,
	adapterFactory: ShrinkoAdapterFactory = defaultAdapterFactory,
): void {
	cli.command('lint', {
		description:
			'Surface PICO-8 lint findings (undefined globals, unused/duplicate locals) via shrinko8. Requires shrinko.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to lint. Defaults to main.p8 in the current folder.',
				),
		}),
		env: z.object({
			PATH: z
				.string()
				.optional()
				.describe('Used to locate shrinko8 in the child process.'),
		}),
		output: z.object({
			findings: z
				.array(
					z.object({
						line: z.number().describe('1-based line in the cart.'),
						col: z.number().describe('1-based column.'),
						message: z.string().describe('The lint warning text.'),
					}),
				)
				.describe(
					'Every lint warning shrinko reported (empty when the cart is clean).',
				),
			clean: z.boolean().describe('True when there are no findings.'),
			count: z.number().describe('Number of findings.'),
		}),
		examples: [
			{description: 'Lint main.p8'},
			{description: 'Lint a specific cart', args: {cart: 'game.p8'}},
		],
		async run({args, env, error, ok}) {
			const cartPath = isAbsolute(args.cart)
				? args.cart
				: resolve(process.cwd(), args.cart);

			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			const adapter = adapterFactory(env as NodeJS.ProcessEnv);
			const result = await adapter.lint(cartPath);

			if (!result.ok) {
				return error({
					code: result.reason,
					message: `shrinko is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			const {findings} = result.value;
			const clean = findings.length === 0;

			// Findings are DATA, not a failure exit (an agent reads them and fixes the
			// code). When there ARE findings, CTA toward the run/verify loop.
			const cta = clean
				? undefined
				: {
						description: `${findings.length} lint finding(s). Fix them, then re-check:`,
						commands: [
							{command: 'lint', description: 'Re-lint after fixing.'},
							{
								command: 'verify',
								description: 'Run the static gate before running.',
							},
						],
					};

			return ok(
				{findings: [...findings], clean, count: findings.length},
				cta === undefined ? undefined : {cta},
			);
		},
	});
}
