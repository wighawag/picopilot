import {existsSync, readFileSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {type Cli, z} from 'incur';

import {Cart, CartParseError} from '../engine/cart/index.js';
import {
	type ShrinkoAdapter,
	ShrinkoParseError,
	ShellShrinkoAdapter,
} from '../engine/shrinko/index.js';
import {TOKEN_BUDGET} from './tokens.js';

/**
 * The one-line self-scoping the `picopilot verify` envelope always carries, so
 * the connotation of "verify" never misleads an agent into treating a green
 * static gate as terminal (ADR-0003). It states BOTH facts: verify is static,
 * and passing does NOT mean the cart runs.
 */
export const VERIFY_SCOPE =
	'static gate: tokens + integrity; passing does NOT mean the cart runs' as const;

/**
 * The exit code for the DISTINCT `gate-incapable` outcome (shrinko absent).
 * Chosen as 2 to be categorically separate from `fail` (exit 1, a cart that
 * flunked a check) and from `pass` (exit 0): an absent capability is neither a
 * green gate nor a failed check but a gate that could not run its most
 * important check, so it gets its own nonzero code an agent can branch on.
 */
export const GATE_INCAPABLE_EXIT = 2;

/** See {@link ShrinkoAdapterFactory} in `tokens.ts` — verify reuses the same seam. */
export type ShrinkoAdapterFactory = (env: NodeJS.ProcessEnv) => ShrinkoAdapter;

const defaultAdapterFactory: ShrinkoAdapterFactory = (env) =>
	new ShellShrinkoAdapter({env});

/**
 * The result of the integrity check: the cart parses AND round-trips
 * byte-identically through the cart model (well-formed sections). A cart that
 * fails to parse, or one whose serialize does not reproduce the source, is not
 * well-formed and fails integrity.
 */
type IntegrityResult = {ok: true} | {ok: false; detail: string};

/**
 * Runs the STATIC cart-integrity check against `text`: the cart must parse into
 * the cart model and round-trip cleanly (`Cart.parse(text).serialize() ===
 * text`). This is a purely static, well-formedness check — it never runs the
 * cart. A {@link CartParseError} (malformed header/version/section) or a
 * round-trip mismatch is a fail with a human-readable detail.
 */
function checkIntegrity(text: string): IntegrityResult {
	let cart: Cart;
	try {
		cart = Cart.parse(text);
	} catch (e) {
		if (e instanceof CartParseError) {
			return {
				ok: false,
				detail: `cart does not parse (${e.code}): ${e.message}`,
			};
		}
		throw e;
	}
	if (cart.serialize() !== text) {
		return {
			ok: false,
			detail:
				'cart does not round-trip cleanly through the cart model (malformed sections)',
		};
	}
	return {ok: true};
}

/**
 * Registers `picopilot verify` (US #15, #18), the STATIC cart-acceptance gate an
 * agent drives each iteration toward.
 *
 * It runs two static checks and returns ONE structured envelope:
 *
 * - **integrity** — the cart parses and round-trips cleanly through the cart
 *   model (well-formed sections). No run.
 * - **tokens** — the cart is within the 8,192-token budget (via the shrinko
 *   adapter `--count`).
 *
 * (Lint folds in when the lint task lands; in v1-core verify = tokens +
 * integrity.)
 *
 * Three categorical outcomes (ADR-0003):
 *
 * - **pass** (exit 0) — both checks green. The envelope SELF-SCOPES (states it
 *   is static and that passing does not mean the cart runs) and CTAs to
 *   `picopilot run` ("static checks pass, now confirm it boots"), so the agent
 *   is led from well-formed to actually-runs.
 * - **fail** (exit 1) — a check flunked (over budget, or a malformed/non-parsing
 *   cart). A structured `verify-failed` error listing which checks failed.
 * - **gate-incapable** (exit {@link GATE_INCAPABLE_EXIT}) — shrinko is ABSENT,
 *   so the token check (the #1 failure mode, token bloat) cannot run. verify
 *   returns a DISTINCT `gate-incapable` result, NEVER green, categorically
 *   separate from pass and fail. This is the gate-as-theatre regression guard:
 *   verify must never report green by skipping its most important check.
 *
 * verify is STATIC and never runs the cart, so it has NO PICO-8 dependency (US
 * #19). It reaches shrinko entirely through the {@link ShrinkoAdapter} seam, so
 * a native-TS shrinko would satisfy it unchanged.
 *
 * @param adapterFactory injects the adapter (defaults to the shell adapter);
 *   tests pass a stub to drive present / absent / over-budget without the real
 *   binary.
 */
export function registerVerify(
	cli: Cli.Cli,
	adapterFactory: ShrinkoAdapterFactory = defaultAdapterFactory,
): void {
	cli.command('verify', {
		description:
			'Static acceptance gate: run tokens + cart-integrity and return one pass/fail envelope. Does NOT run the cart. Requires shrinko.',
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to verify. Defaults to main.p8 in the current folder.',
				),
		}),
		// Declared so incur resolves it from the (test-overridable) env source and
		// hands it to the shrinko child; verify itself never runs the cart, so it
		// needs no PICO-8 env.
		env: z.object({
			PATH: z
				.string()
				.optional()
				.describe('Used to locate shrinko8 in the child process.'),
		}),
		output: z.object({
			status: z
				.literal('pass')
				.describe('The overall gate result. Only a green gate reaches ok.'),
			scope: z
				.string()
				.describe(
					'The self-scoping note: verify is static and passing does NOT mean the cart runs.',
				),
			checks: z
				.object({
					integrity: z
						.boolean()
						.describe('True when the cart parses and round-trips cleanly.'),
					tokens: z
						.boolean()
						.describe('True when the cart is within the 8,192-token budget.'),
				})
				.describe('Per-check pass/fail, so the agent sees WHAT was checked.'),
			tokens: z.number().describe('The token count shrinko reported.'),
			budget: z.number().describe('The token budget checked against (8192).'),
		}),
		examples: [
			{description: 'Verify main.p8'},
			{description: 'Verify a specific cart', args: {cart: 'game.p8'}},
		],
		async run({args, env, error, ok}) {
			const cartPath = isAbsolute(args.cart)
				? args.cart
				: resolve(process.cwd(), args.cart);

			// A missing cart is a picopilot-side error, distinct from a fail: there is
			// nothing to gate. Surface it clearly rather than reporting a hollow fail.
			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			const text = readFileSync(cartPath, 'utf8');

			// Integrity is a static, shrinko-free check: the cart parses + round-trips.
			const integrity = checkIntegrity(text);

			// Tokens goes through the shrinko seam. Absent shrinko is the gate-incapable
			// trigger (below); a parse failure of shrinko's own output is shrinko-failed.
			const adapter = adapterFactory(env as NodeJS.ProcessEnv);
			let count: Awaited<ReturnType<ShrinkoAdapter['count']>>;
			try {
				count = await adapter.count(cartPath);
			} catch (e) {
				if (e instanceof ShrinkoParseError) {
					return error({
						code: 'shrinko-failed',
						message: `shrinko ran but its --count output could not be parsed: ${e.message}`,
						exitCode: 1,
					});
				}
				throw e;
			}

			// GATE-INCAPABLE (ADR-0003): shrinko absent → verify CANNOT check the #1
			// failure mode (token bloat). It returns a DISTINCT outcome, NEVER green,
			// never a silent skip. This is the load-bearing regression guard: verify
			// must not report pass by omitting its most important check.
			if (!count.ok) {
				return error({
					code: 'gate-incapable',
					message: `${VERIFY_SCOPE}. gate-incapable: cannot check tokens without shrinko, so verify will not report green. ${count.remedy} (needs: ${count.needs.join(', ')})`,
					exitCode: GATE_INCAPABLE_EXIT,
				});
			}

			const tokens = count.value.tokens;
			const tokensOk = tokens <= TOKEN_BUDGET;

			// FAIL (exit 1): a static check flunked. List every failing check so the
			// agent knows what to fix, not just that something did.
			if (!integrity.ok || !tokensOk) {
				const failed: string[] = [];
				if (!integrity.ok) failed.push(`integrity: ${integrity.detail}`);
				if (!tokensOk) {
					failed.push(
						`tokens: ${tokens} exceeds the ${TOKEN_BUDGET}-token budget`,
					);
				}
				return error({
					code: 'verify-failed',
					message: `${VERIFY_SCOPE}. verify FAILED: ${failed.join('; ')}`,
					exitCode: 1,
				});
			}

			// PASS (exit 0): both static checks green. Self-scope, then CTA to `run` so
			// the agent is led from well-formed to actually-boots (ADR-0003 CTA).
			return ok(
				{
					status: 'pass' as const,
					scope: VERIFY_SCOPE,
					checks: {integrity: true, tokens: true},
					tokens,
					budget: TOKEN_BUDGET,
				},
				{
					cta: {
						description:
							'Static checks pass. Now confirm the cart actually boots:',
						commands: [
							{
								command: 'run',
								description:
									'Launch the cart headless to confirm it boots (verify does not run it).',
							},
						],
					},
				},
			);
		},
	});
}
