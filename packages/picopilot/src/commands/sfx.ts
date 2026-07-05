import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {Cli, z} from 'incur';

import {
	AudioMmlError,
	mergeSfxRow,
	mmlToSfxRow,
	PITCH_MAX,
	SFX_MAX_ROWS,
	SFX_SLOT_COUNT,
} from '../engine/audio/index.js';
import {Cart, CartParseError} from '../engine/cart/index.js';

/** Resolves a path argument to an absolute path (relative to cwd). */
function resolvePath(p: string): string {
	return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/**
 * Loads + parses a cart, returning either the parsed cart or a structured reason
 * the caller turns into an `error(...)`. Mirrors the gfx command's loader.
 */
function loadCart(
	cartPath: string,
): {ok: true; cart: Cart} | {ok: false; code: string; message: string} {
	if (!existsSync(cartPath)) {
		return {
			ok: false,
			code: 'cart-not-found',
			message: `no cart at ${cartPath}`,
		};
	}
	const text = readFileSync(cartPath, 'utf8');
	try {
		return {ok: true, cart: Cart.parse(text)};
	} catch (e) {
		if (e instanceof CartParseError) {
			return {
				ok: false,
				code: 'cart-parse-failed',
				message: `cart at ${cartPath} does not parse (${e.code}): ${e.message}`,
			};
		}
		throw e;
	}
}

/**
 * Builds the `sfx` command group. Currently just `sfx from-mml` (the
 * picopilot-MML to `__sfx__` transpiler + cart merge).
 */
function buildSfxGroup(): Cli.Cli {
	const sfx = Cli.create('sfx', {
		description:
			'Compose SFX as text: transpile picopilot-MML into a cart __sfx__ slot. Durations are TRACKER ROWS at one SFX speed, NOT tempo/BPM (PICO-8 has no per-note duration).',
	});

	sfx.command('from-mml', {
		description:
			'Transpile picopilot-MML text into one __sfx__ slot (0-63) and merge it into the cart (only that slot changes). picopilot-MML is TRACKER-ROW based: a length is a ROW COUNT (l4 = 4 rows), NOT a musical note value, and there is NO tempo/BPM (PICO-8 measures in ticks/row via `s<N>` speed). Notes carry per-note waveform (@0-7, @8-f = custom SFX-instrument), volume (v0-7), and effect (e0-7) that a score notation cannot express. Out-of-range pitch (below C0 / above D#5) and >32 rows are refused loudly, never silently clamped.',
		args: z.object({
			slot: z.coerce
				.number()
				.int()
				.min(0)
				.max(SFX_SLOT_COUNT - 1)
				.describe(`The target SFX slot 0-${SFX_SLOT_COUNT - 1} to write.`),
			mml: z
				.string()
				.optional()
				.describe(
					'The picopilot-MML source (e.g. "s16 @1 v6 c d e f"). Omit and pass --file to read from a file instead. Modal state: @ waveform, v volume, e effect, o octave, l default length (all sticky). Durations are ROWS: c4 = 4 rows (held via tie rows). Loop with {..}; a lone { marks the pattern LEN.',
				),
		}),
		options: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to merge into. Defaults to main.p8 in the current folder. (An option, not a positional, so it never collides with an omitted `mml` when using --file.)',
				),
			file: z
				.string()
				.optional()
				.describe(
					'Read the picopilot-MML from this file instead of the `mml` argument (for longer sources).',
				),
		}),
		output: z.object({
			slot: z.number().describe('The SFX slot that was written.'),
			cart: z
				.string()
				.describe('The absolute path of the cart that was written.'),
			rows: z
				.number()
				.describe('The number of tracker rows the MML produced (0-32).'),
			speed: z
				.number()
				.describe('The SFX speed (ticks/row) written into the header.'),
			loopStart: z
				.number()
				.describe('The header loop-start value (row index, or a LEN).'),
			loopEnd: z
				.number()
				.describe(
					'The header loop-end value (0 = off or the LEN special case).',
				),
			row: z
				.string()
				.describe('The 168-char __sfx__ text row that was merged.'),
			warnings: z
				.array(z.string())
				.describe(
					'Advisory warnings (e.g. a dotted length whose row count was rounded).',
				),
		}),
		examples: [
			{
				description: 'A simple square-wave arpeggio into slot 0',
				args: {slot: 0, mml: 's8 @3 v6 c e g > c'},
			},
			{
				description: 'A held note (4 rows) with vibrato into slot 5 of a cart',
				args: {slot: 5, mml: 's16 @1 v5 e2 c4'},
				options: {cart: 'game.p8'},
			},
			{
				description: 'Read a longer source from a file',
				args: {slot: 1},
				options: {file: 'lead.mml'},
			},
		],
		run({args, options, error, ok}) {
			// Resolve the MML source: the `mml` arg OR `--file` (exactly one). This is
			// the input surface; both are pure text, shrinko-free + PICO-8-free.
			let mml: string;
			if (options.file !== undefined) {
				if (args.mml !== undefined) {
					return error({
						code: 'ambiguous-input',
						message:
							'pass EITHER the mml argument OR --file, not both (they are two ways to give the same source).',
						exitCode: 1,
					});
				}
				const filePath = resolvePath(options.file);
				if (!existsSync(filePath)) {
					return error({
						code: 'mml-file-not-found',
						message: `no picopilot-MML file at ${filePath}`,
						exitCode: 1,
					});
				}
				mml = readFileSync(filePath, 'utf8');
			} else if (args.mml !== undefined) {
				mml = args.mml;
			} else {
				return error({
					code: 'no-mml',
					message:
						'no picopilot-MML source: pass it as the `mml` argument or via --file.',
					exitCode: 1,
				});
			}

			// Transpile FIRST: a bad MML is a caller error and must never touch the
			// cart (no bytes change on a refusal), mirroring `gfx set`'s grid-first
			// discipline.
			let result: ReturnType<typeof mmlToSfxRow>;
			try {
				result = mmlToSfxRow(mml);
			} catch (e) {
				if (e instanceof AudioMmlError) {
					// The two structured refusals + parse errors surface as incur's
					// error envelope with a nonzero exit (never a silent clamp). The CTA
					// points at the range/cap the author must respect.
					const cta =
						e.code === 'audio-mml-pitch-out-of-range'
							? {
									description:
										'PICO-8 pitch is a hard range; author within it:',
									commands: [
										{
											command: 'sfx from-mml <slot> "<mml>"',
											description: `Use octaves that keep every note within C0..D#5 (0..${PITCH_MAX}).`,
										},
									],
								}
							: e.code === 'audio-mml-sfx-overflow'
								? {
										description: `One SFX holds at most ${SFX_MAX_ROWS} rows; split longer melodies:`,
										commands: [
											{
												command: 'sfx from-mml <other-slot> "<rest>"',
												description:
													'Author the remainder as another SFX, then arrange both with `music from-patterns`.',
											},
										],
									}
								: undefined;
					return error({
						code: e.code,
						message: e.message,
						exitCode: 1,
						...(cta ? {cta} : {}),
					});
				}
				throw e;
			}

			const cartPath = resolvePath(options.cart);
			const loaded = loadCart(cartPath);
			if (!loaded.ok) {
				return error({code: loaded.code, message: loaded.message, exitCode: 1});
			}

			// Merge into the target slot ONLY, through the cart model, so every other
			// section (and every other SFX slot) stays byte-identical.
			mergeSfxRow(loaded.cart, args.slot, result.row);
			writeFileSync(cartPath, loaded.cart.serialize());

			const warnings = result.roundingWarnings.map(
				(w) =>
					`length "${w.token}" = ${w.exactRows} rows rounded to ${w.roundedRows} (rows are whole; PICO-8 has no fractional-length notes).`,
			);

			// CTA toward the verify/hear loop: a merged SFX is next confirmed by
			// verify (static integrity) and heard via `audio render`.
			return ok(
				{
					slot: args.slot,
					cart: cartPath,
					rows: result.rows,
					speed: result.speed,
					loopStart: result.loopStart,
					loopEnd: result.loopEnd,
					row: result.row,
					warnings,
				},
				{
					cta: {
						description: 'The SFX is merged. Confirm it, then hear it:',
						commands: [
							{
								command: 'verify',
								description:
									'Static gate: the cart still parses + is within budget.',
							},
							{
								command: 'audio render',
								description:
									'Record a WAV to hear the result (real-time capture, requires PICO-8).',
							},
						],
					},
				},
			);
		},
	});

	return sfx;
}

/**
 * Registers the `sfx` command group (`sfx from-mml`) on the root CLI.
 *
 * `sfx` is a shrinko-FREE and PICO-8-FREE command group: it transpiles
 * picopilot-MML to `__sfx__` and merges it through the cart model entirely in
 * TS, so it works with both absent and never spawns a child process. The
 * picopilot-MML dialect (ADR-0005 + the audio spike finding) is TRACKER-ROW
 * based: durations are row counts at one SFX speed, NOT tempo (ADR-0008), and
 * out-of-range pitch / >32 rows are structured refusals, never silent clamps.
 */
export function registerSfx(cli: Cli.Cli): void {
	cli.command(buildSfxGroup());
}
