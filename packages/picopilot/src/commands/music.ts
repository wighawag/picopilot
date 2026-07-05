import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {Cli, z} from 'incur';

import {
	MusicError,
	patternsToMusic,
	type Pattern,
	SFX_INDEX_MAX,
	setMusicSection,
} from '../engine/audio/index.js';
import {Cart, CartParseError} from '../engine/cart/index.js';

/** Resolves a path argument to an absolute path (relative to cwd). */
function resolvePath(p: string): string {
	return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/**
 * Loads + parses a cart, returning either the parsed cart or a structured reason
 * the caller turns into an `error(...)`. Mirrors the sfx/gfx command loaders.
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
 * A parsed pattern list, OR a structured reason it could not be read as the
 * documented JSON shape (a syntactically-bad payload). Value validation (channel
 * count, sfx range) is the codec's job (structured `MusicError`s); this only
 * gets the payload from text into the `Pattern[]` shape.
 */
type ParsedPatterns =
	{ok: true; patterns: Pattern[]} | {ok: false; code: string; message: string};

/**
 * Reads the pattern-list JSON into the codec's `Pattern[]` model (finding B.6).
 *
 * The serialization is JSON: an array of `{channels:[c0,c1,c2,c3], loopStart?,
 * loopBack?, stop?}` (see the command help). This maps 1:1 to the finding's B.6
 * model, so an author (human or agent) writes exactly that structure. An SFX
 * reference is a number 0..63; an OFF channel is `null` (distinct from sfx 0, per
 * finding B.7 #9). This parser is deliberately structural-only: it accepts the
 * shape and hands it to the codec, which owns range/count validation.
 */
function parsePatterns(text: string): ParsedPatterns {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return {
			ok: false,
			code: 'audio-music-parse-error',
			message: `pattern list is not valid JSON: ${
				e instanceof Error ? e.message : String(e)
			}. Expected an array of patterns, e.g. [{"channels":[0,1,null,3],"loopStart":true}].`,
		};
	}
	if (!Array.isArray(raw)) {
		return {
			ok: false,
			code: 'audio-music-parse-error',
			message:
				'pattern list must be a JSON array of patterns, e.g. [{"channels":[0,1,null,3]}]. Each channel is an SFX index 0..63 or null (off).',
		};
	}
	// Hand the array straight to the codec as Pattern[]; the codec validates
	// channel count + sfx range structurally and refuses out-of-range values.
	return {ok: true, patterns: raw as Pattern[]};
}

/**
 * Builds the `music` command group. Currently just `music from-patterns` (the
 * structural pattern-list to `__music__` codec + cart merge).
 */
function buildMusicGroup(): Cli.Cli {
	const music = Cli.create('music', {
		description:
			'Assemble music STRUCTURALLY: an ordered list of up-to-4 SFX-channel references per pattern -> __music__. There is NO melodic content in __music__; melody lives in the referenced SFX (built by `sfx from-mml`). Pattern LENGTH is inherited from the referenced SFX (the left-most non-looping channel), NOT stored per pattern.',
	});

	music.command('from-patterns', {
		description:
			'Assemble a JSON pattern list into __music__ and merge it into the cart (only __music__ changes; every other section incl. __sfx__ stays byte-identical). A pattern is {"channels":[c0,c1,c2,c3], loopStart?, loopBack?, stop?}: each channel is an SFX index 0-63 OR null = OFF (silent this pattern; null is NOT sfx 0). Flags: loopStart (0x01), loopBack (0x02, jump back to loop-start), stop (0x04). Pattern order = song order. Pattern length is INHERITED from the referenced SFX (its speed + LEN via `sfx from-mml`), so no per-pattern length is stored. Out-of-range SFX index is refused; loopBack with no loopStart warns (PICO-8 falls back to pattern 0), not a crash.',
		args: z.object({
			patterns: z
				.string()
				.optional()
				.describe(
					'The pattern list as JSON: an array of {"channels":[c0,c1,c2,c3], loopStart?, loopBack?, stop?}. A channel is an SFX index 0-63 or null (off). Omit and pass --file to read from a file instead. Example: \'[{"channels":[0,1,null,3],"loopStart":true},{"channels":[2,2,2,2],"loopBack":true,"stop":true}]\'.',
				),
		}),
		options: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to merge into. Defaults to main.p8 in the current folder. (An option, not a positional, so it never collides with an omitted `patterns` when using --file.)',
				),
			file: z
				.string()
				.optional()
				.describe(
					'Read the JSON pattern list from this file instead of the `patterns` argument (for longer songs).',
				),
		}),
		output: z.object({
			cart: z
				.string()
				.describe('The absolute path of the cart that was written.'),
			patterns: z
				.number()
				.describe('The number of patterns written (= song length).'),
			section: z
				.string()
				.describe('The __music__ section body that was merged.'),
			warnings: z
				.array(z.string())
				.describe(
					'Advisory warnings (e.g. loopBack with no loopStart -> PICO-8 loops to pattern 0).',
				),
		}),
		examples: [
			{
				description: 'A two-pattern loop (pattern 0 loops back to itself)',
				args: {
					patterns:
						'[{"channels":[0,1,2,3],"loopStart":true},{"channels":[0,1,2,3],"loopBack":true}]',
				},
			},
			{
				description: 'A pattern with channel 2 OFF (silent), not sfx 0',
				args: {patterns: '[{"channels":[0,1,null,3]}]'},
				options: {cart: 'game.p8'},
			},
			{
				description: 'Read a longer song from a file',
				args: {},
				options: {file: 'song.json'},
			},
		],
		run({args, options, error, ok}) {
			// Resolve the pattern-list source: the `patterns` arg OR `--file` (exactly
			// one). Pure text, shrinko-free + PICO-8-free (mirrors `sfx from-mml`).
			let text: string;
			if (options.file !== undefined) {
				if (args.patterns !== undefined) {
					return error({
						code: 'ambiguous-input',
						message:
							'pass EITHER the patterns argument OR --file, not both (they are two ways to give the same source).',
						exitCode: 1,
					});
				}
				const filePath = resolvePath(options.file);
				if (!existsSync(filePath)) {
					return error({
						code: 'patterns-file-not-found',
						message: `no pattern-list file at ${filePath}`,
						exitCode: 1,
					});
				}
				text = readFileSync(filePath, 'utf8');
			} else if (args.patterns !== undefined) {
				text = args.patterns;
			} else {
				return error({
					code: 'no-patterns',
					message:
						'no pattern list: pass it as the `patterns` argument (JSON) or via --file.',
					exitCode: 1,
				});
			}

			const parsed = parsePatterns(text);
			if (!parsed.ok) {
				return error({code: parsed.code, message: parsed.message, exitCode: 1});
			}

			// Transpile FIRST: a bad list is a caller error and must never touch the
			// cart (no bytes change on a refusal), mirroring `sfx from-mml`.
			let result: ReturnType<typeof patternsToMusic>;
			try {
				result = patternsToMusic(parsed.patterns);
			} catch (e) {
				if (e instanceof MusicError) {
					const cta =
						e.code === 'audio-music-sfx-out-of-range'
							? {
									description: `SFX indices are a hard range (0..${SFX_INDEX_MAX}); to silence a channel use null, not an out-of-range index:`,
									commands: [
										{
											command: 'sfx from-mml <slot> "<mml>"',
											description: `Author the SFX you reference first (slots 0..${SFX_INDEX_MAX}), then arrange them here.`,
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

			// Replace __music__ ONLY, through the cart model, so every other section
			// (and __sfx__) stays byte-identical.
			setMusicSection(loaded.cart, result.section);
			writeFileSync(cartPath, loaded.cart.serialize());

			const warnings = result.warnings.map((w) => w.message);

			// CTA toward the verify/hear loop: a merged song is next confirmed by
			// verify (static integrity) and heard via `audio render`.
			return ok(
				{
					cart: cartPath,
					patterns: result.patterns,
					section: result.section,
					warnings,
				},
				{
					cta: {
						description: 'The song is merged. Confirm it, then hear it:',
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

	return music;
}

/**
 * Registers the `music` command group (`music from-patterns`) on the root CLI.
 *
 * `music` is a shrinko-FREE and PICO-8-FREE command group: it assembles a
 * structural pattern list into `__music__` and merges it through the cart model
 * entirely in TS, so it works with both absent and never spawns a child process.
 * Music is STRUCTURAL (ADR-0005 + the audio spike finding A.5/B.6): a pattern
 * list of SFX references, NOT a notation. "Off" (bit6) is distinct from "sfx 0",
 * and pattern length is inherited from the referenced SFX (stored nowhere here).
 */
export function registerMusic(cli: Cli.Cli): void {
	cli.command(buildMusicGroup());
}
