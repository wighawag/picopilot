import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {type Cli, z} from 'incur';
import {Cart, CartParseError} from '../engine/cart/index.js';
import {labelHexFromPng, LabelError} from '../engine/gfx/index.js';
import {
	EXPORT_HTML_NAME,
	type Pico8Adapter,
	ShellPico8Adapter,
} from '../engine/pico8/index.js';

/**
 * Injects the PICO-8 adapter `export` uses (defaults to the shell adapter over
 * native `pico8 <cart> -export <name>.html -x`). Mirrors the `run` seam: a test
 * passes a stub to drive the present/absent paths without the paid binary, and
 * to isolate the child `env` (its `PICO8_PATH`/`PATH`).
 */
export type Pico8AdapterFactory = (env: NodeJS.ProcessEnv) => Pico8Adapter;

const defaultAdapterFactory: Pico8AdapterFactory = (env) =>
	new ShellPico8Adapter({env});

/** The default backstop: kill an export that never completes/exits after this many ms. */
const DEFAULT_BACKSTOP_MS = 30_000;

/**
 * Registers `picopilot export`, the THIN structured wrapper over PICO-8's HTML
 * export (`pico8 <cart> -export <name>.html -x`, the headless `-x` path, no
 * display needed). It is NOT a `pico8` reimplementation: PICO-8 owns the bundle
 * (an Emscripten runtime `.js` with the cart baked in, plus a shell `.html`).
 * The value picopilot adds is the glue an agent should not hand-roll: resolve
 * the cart, pick/create the output dir, name the pair `index.html` + `index.js`
 * so a dest folder is directly serveable/showcase-ready, and return ONE
 * structured result (output dir + file paths + the labelless-cart warning). It
 * hard-requires PICO-8; absence is a first-class `pico8-not-found` value + a
 * nonzero exit (mirrors `run`), never a crash or a hang. Live export is the
 * manual/opt-in tier; the absent path is the CI-testable one.
 *
 * Two shapes, one command:
 *  - default (standalone): keep the `index.html` + `index.js` pair; the html
 *    references its sibling by name, so the dir plays directly (and `serve`
 *    uses this internally).
 *  - `--payload-only`: keep only the `.js` runtime payload; drop the shell page.
 *    For a website that provides its OWN player shell (a Svelte component that
 *    ports PICO-8's small bootstrap and loads the exported `.js`). The split is
 *    a post-export file op the command owns, never the PICO-8 binary's concern.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present/absent without the real binary.
 */
export function registerExport(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
): void {
	cli.command('export', {
		description:
			"Export a cart to a playable HTML bundle (index.html + index.js) via the user's PICO-8. Requires PICO-8.",
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to export. Defaults to main.p8 in the current folder.',
				),
			dest: z
				.string()
				.optional()
				.describe(
					'Output folder (created if missing). Point it at a showcase dir (e.g. ./website/static/games/<slug>/). Defaults to an isolated temp dir.',
				),
		}),
		options: z.object({
			label: z
				.string()
				.optional()
				.describe(
					'Path to a 128x128 PNG to bake in as the cart __label__ (the export splash), for a cart that has none. Ignored if the cart already has a label.',
				),
			payloadOnly: z
				.boolean()
				.default(false)
				.describe(
					'Keep only the .js runtime payload (drop the shell .html), for a site that provides its own player component.',
				),
			backstopMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_BACKSTOP_MS)
				.describe(
					'Safety backstop: kill PICO-8 after this many ms if the export never completes.',
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
			outDir: z
				.string()
				.describe('Absolute path of the folder the bundle was written to.'),
			html: z
				.string()
				.optional()
				.describe(
					'Absolute path of the shell index.html (omitted with --payload-only).',
				),
			js: z.string().describe('Absolute path of the runtime payload index.js.'),
			files: z
				.array(z.string())
				.describe('Absolute paths of every file the bundle contains.'),
			labelWarning: z
				.boolean()
				.describe(
					'True when the cart has no __label__: it exports with a blank/ugly splash.',
				),
		}),
		examples: [
			{description: 'Export main.p8 to a temp dir'},
			{
				description: 'Export a cart into a showcase folder',
				args: {cart: 'game.p8', dest: './website/static/games/my-game'},
			},
			{
				description: 'Bake a PNG as the label splash for a labelless cart',
				args: {cart: 'game.p8', dest: './website/static/games/my-game'},
				options: {label: './label.png'},
			},
			{
				description:
					'Export only the runtime payload for a site player component',
				args: {cart: 'game.p8', dest: './website/static/games/my-game'},
				options: {payloadOnly: true},
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

			// --label <png>: bake a 128x128 PNG in as the cart's __label__ so a
			// labelless cart gets a splash without an interactive F7 capture. We do
			// NOT mutate the user's cart: we write a labeled copy NEXT TO it (same dir,
			// so `#include main.lua` still resolves) and export that, then clean it up.
			// A cart that ALREADY has a label wins (the flag is a fallback, not an
			// override), matching the export precedence PICO-8 itself uses.
			let exportCartPath = cartPath;
			let labeledCopy: string | undefined;
			if (options.label !== undefined) {
				const labelPath = isAbsolute(options.label)
					? options.label
					: resolve(process.cwd(), options.label);
				if (!existsSync(labelPath)) {
					return error({
						code: 'label-not-found',
						message: `no label image at ${labelPath}`,
						exitCode: 1,
					});
				}
				try {
					const cart = Cart.parse(readFileSync(cartPath, 'utf8'));
					const existingLabel = cart.getSection('label');
					if (existingLabel === undefined || existingLabel.trim() === '') {
						const hex = labelHexFromPng(readFileSync(labelPath));
						cart.setSection('label', hex);
						labeledCopy = join(
							dirname(cartPath),
							`.picopilot-export-${process.pid}-${Date.now()}.p8`,
						);
						writeFileSync(labeledCopy, cart.serialize());
						exportCartPath = labeledCopy;
					}
					// else: cart already has a label; keep it, ignore --label.
				} catch (e) {
					if (e instanceof LabelError) {
						return error({
							code: `label-${e.code}`,
							message: e.message,
							exitCode: 1,
						});
					}
					if (e instanceof CartParseError) {
						return error({
							code: `cart-${e.code}`,
							message: `could not parse the cart to inject a label: ${e.message}`,
							exitCode: 1,
						});
					}
					throw e;
				}
			}

			// Output dir: a user-given dest (point it at the showcase), else an
			// isolated temp dir. Create it so PICO-8 has somewhere to write.
			const outDir =
				args.dest !== undefined
					? isAbsolute(args.dest)
						? args.dest
						: resolve(process.cwd(), args.dest)
					: mkdtempSync(join(tmpdir(), 'picopilot-export-'));
			if (!existsSync(outDir)) mkdirSync(outDir, {recursive: true});

			const adapter = adapterFactory(env as NodeJS.ProcessEnv);
			const result = await adapter.export({
				cartPath: exportCartPath,
				outDir,
				htmlName: EXPORT_HTML_NAME,
				backstopMs: options.backstopMs,
			});

			// Remove the temporary labeled copy now that PICO-8 has read it (on every
			// path below); best-effort, a leftover dotfile is not fatal.
			if (labeledCopy !== undefined) {
				try {
					rmSync(labeledCopy);
				} catch {
					// ignore
				}
			}

			if (!result.ok) {
				// The two-tier structured failure: PICO-8 absent. The message carries
				// the exact remedy + needs; the code is the handle.
				return error({
					code: result.reason,
					message: `PICO-8 is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
					exitCode: 1,
				});
			}

			let {htmlPath, jsPath, files, labelWarning} = result.value;

			// PICO-8 must have produced the runtime payload; if not, the export failed
			// (most often a labelless-cart bail that wrote nothing).
			if (jsPath === undefined) {
				return error({
					code: 'export-failed',
					message: labelWarning
						? 'PICO-8 produced no bundle (the cart has no __label__ to embed). Give it one with --label <128x128.png>, or capture a label in PICO-8 (F7), then re-export.'
						: 'PICO-8 produced no export bundle. Check the cart runs without a boot error.',
					exitCode: 1,
				});
			}

			// --payload-only: drop the shell .html; keep just the runtime payload the
			// site's own player component loads. A post-export file op we own, not the
			// binary's concern.
			if (options.payloadOnly && htmlPath !== undefined) {
				try {
					rmSync(htmlPath);
				} catch {
					// A stubborn html is not fatal: the payload is what matters.
				}
				htmlPath = undefined;
				files = listFiles(outDir);
			}

			const cta =
				labelWarning && !options.payloadOnly
					? {
							description:
								'The cart has no __label__, so the export splash is blank. Add one for a nicer bundle:',
							commands: [
								{
									command: 'export --label <128x128.png>',
									description:
										'Bake a PNG in as the label splash, or capture one in PICO-8 (F7) before exporting.',
								},
							],
						}
					: undefined;

			return ok(
				{
					outDir,
					html: htmlPath,
					js: jsPath,
					files: [...files],
					labelWarning,
				},
				cta === undefined ? undefined : {cta},
			);
		},
	});
}

/** Absolute, sorted file paths currently in `dir` (post file-op re-scan). */
function listFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.sort()
		.map((f) => join(dir, f));
}
