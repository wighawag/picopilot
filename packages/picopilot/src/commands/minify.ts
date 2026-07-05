import {existsSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {type Cli, z} from 'incur';
import {
	type ShrinkoAdapter,
	ShellShrinkoAdapter,
} from '../engine/shrinko/index.js';

/** See {@link import('./tokens.js').ShrinkoAdapterFactory}: minify reuses the same seam. */
export type ShrinkoAdapterFactory = (env: NodeJS.ProcessEnv) => ShrinkoAdapter;

const defaultAdapterFactory: ShrinkoAdapterFactory = (env) =>
	new ShellShrinkoAdapter({env});

/**
 * Derives the default output path `<name>.min.p8` next to the source cart:
 * `main.p8` -> `main.min.p8`, `game.p8.png` -> `game.min.p8.png` is NOT the
 * case (we only special-case the final `.p8`); a plain `<name>.p8` becomes
 * `<name>.min.p8`. Anything without a `.p8` suffix just gets `.min.p8` appended.
 */
function defaultOutPath(cartPath: string): string {
	const dir = dirname(cartPath);
	const base = cartPath.slice(dir.length + 1);
	const out = base.endsWith('.p8')
		? `${base.slice(0, -'.p8'.length)}.min.p8`
		: `${base}.min.p8`;
	return join(dir, out);
}

/**
 * Registers `picopilot minify` (US #5, ADR-0007): run shrinko8's SAFE
 * minification and write the result to a SEPARATE artifact (`<name>.min.p8` by
 * default), reporting the before/after token delta. It is COMPILER-STYLE: the
 * user's authored source (`main.p8` / the `#include`d `main.lua`) is NEVER
 * touched, and it refuses to clobber an existing output unless `--force`.
 *
 * Safe-only by default (never aggressive-minify silently). shrinko-backed:
 * absent shrinko returns the structured `shrinko-not-found` error + nonzero
 * exit, mirroring `tokens`/`lint`.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present/absent without the real binary.
 */
export function registerMinify(
	cli: Cli.Cli,
	adapterFactory: ShrinkoAdapterFactory = defaultAdapterFactory,
): void {
	cli.command('minify', {
		description:
			'Safe-minify a cart to a SEPARATE artifact (<name>.min.p8), reporting the token delta. Source untouched. Requires shrinko.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to minify. Defaults to main.p8 in the current folder.',
				),
		}),
		options: z.object({
			out: z
				.string()
				.optional()
				.describe(
					'Output cart path. Defaults to <name>.min.p8 next to the source.',
				),
			force: z
				.boolean()
				.default(false)
				.describe(
					'Overwrite an existing output cart. Default off (no-clobber).',
				),
		}),
		env: z.object({
			PATH: z
				.string()
				.optional()
				.describe('Used to locate shrinko8 in the child process.'),
		}),
		output: z.object({
			outPath: z
				.string()
				.describe('Absolute path of the minified cart written.'),
			beforeTokens: z.number().describe('Tokens in the source cart.'),
			afterTokens: z.number().describe('Tokens in the minified cart.'),
			saved: z.number().describe('Tokens reclaimed (before - after).'),
		}),
		examples: [
			{description: 'Minify main.p8 to main.min.p8'},
			{
				description: 'Minify to a chosen path',
				args: {cart: 'game.p8'},
				options: {out: 'dist/game.p8'},
			},
		],
		async run({args, options, env, error, ok}) {
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

			const outPath =
				options.out !== undefined
					? isAbsolute(options.out)
						? options.out
						: resolve(process.cwd(), options.out)
					: defaultOutPath(cartPath);

			// Guard the source FIRST: never let --out point AT the source cart (that
			// would be in-place mutation, which ADR-0007 forbids). Checked before the
			// no-clobber guard so it wins even though the source obviously exists.
			if (outPath === cartPath) {
				return error({
					code: 'output-is-source',
					message: `--out must differ from the source cart (${cartPath}); minify never mutates the source`,
					exitCode: 1,
				});
			}

			// No-clobber (ADR-0007, mirrors init): refuse to overwrite an existing
			// artifact unless --force, so a minify never silently destroys a prior one.
			if (existsSync(outPath) && !options.force) {
				return error({
					code: 'output-exists',
					message: `refusing to overwrite existing ${outPath}; pass --force to overwrite`,
					exitCode: 1,
				});
			}

			const adapter = adapterFactory(env as NodeJS.ProcessEnv);
			const result = await adapter.minify(cartPath, outPath);

			if (!result.ok) {
				return error({
					code: result.reason,
					message: `shrinko is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			const {beforeTokens, afterTokens} = result.value;
			return ok({
				outPath,
				beforeTokens,
				afterTokens,
				saved: beforeTokens - afterTokens,
			});
		},
	});
}
