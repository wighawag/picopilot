import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {Cli, z} from 'incur';

import {
	analyzeAudio,
	type AudioAnalysis,
	AudioAnalyzeError,
	decodeWav,
	THRESHOLDS,
} from '../engine/audio/index.js';
import {
	buildRecordHarness,
	buildRenderHarness,
	DONE_SENTINEL,
	HarnessError,
	type Pico8RecordResult,
	type RenderTarget,
} from '../engine/pico8/index.js';
import {makeReadInclude} from './cart-includes.js';
import {
	createShellAdapterFactory,
	DISPLAY_OPTION,
	displayUnavailableError,
	PICO8_ENV,
	type Pico8AdapterFactory,
	pico8NotFoundError,
	resolveCommandDisplay,
} from './pico8-env.js';

/**
 * Injects the PICO-8 adapter the audio commands use (defaults to the shell
 * adapter over native `pico8 -run`). Mirrors `run`'s `Pico8AdapterFactory` seam:
 * a test passes a fake to drive the record orchestration + the absent path
 * WITHOUT the paid binary.
 */
export type {Pico8AdapterFactory} from './pico8-env.js';

const defaultAdapterFactory: Pico8AdapterFactory = createShellAdapterFactory();

/**
 * The startup margin added to the record window for the default backstop. A
 * recording is real time, so the backstop must cover PICO-8 startup (a virtual
 * display, loading the cart) PLUS the whole record window. A fixed 30 s backstop
 * used to kill any window of ~24 s or more before `audio_end`.
 */
export const RECORD_STARTUP_MARGIN_MS = 30_000;

/** The least startup time an explicit backstop must leave beyond the window. */
export const RECORD_MIN_STARTUP_MS = 5_000;

/**
 * The backstop for a record window: the explicit `--backstop-ms` when it leaves
 * at least {@link RECORD_MIN_STARTUP_MS} for startup, else a refusal; or, when
 * none is given, the window plus {@link RECORD_STARTUP_MARGIN_MS}.
 */
export function resolveRecordBackstop(
	seconds: number,
	explicit: number | undefined,
): {ok: true; ms: number} | {ok: false; message: string} {
	const windowMs = Math.ceil(seconds * 1000);
	if (explicit === undefined) {
		return {ok: true, ms: windowMs + RECORD_STARTUP_MARGIN_MS};
	}
	const least = windowMs + RECORD_MIN_STARTUP_MS;
	if (explicit < least) {
		return {
			ok: false,
			message: `--backstop-ms ${explicit} is too small for a ${seconds} s record window: PICO-8 would be killed before the recording ends (it also needs a few seconds to start). Use at least ${least}, or omit --backstop-ms (the default is the window + ${RECORD_STARTUP_MARGIN_MS / 1000} s).`,
		};
	}
	return {ok: true, ms: explicit};
}

/** The `--backstop-ms` option both audio subcommands share. */
const BACKSTOP_OPTION = z
	.number()
	.int()
	.positive()
	.optional()
	.describe(
		`Safety backstop: kill PICO-8 after this many ms if it never signals. Default: the record window + ${RECORD_STARTUP_MARGIN_MS / 1000} s of startup margin. An explicit value smaller than the window + ${RECORD_MIN_STARTUP_MS / 1000} s is refused.`,
	);

/** The honest one-liner both `record` and `render` carry (ADR-0009): not offline. */
const HONEST_CAVEAT =
	'This is a REAL-TIME recording of playback in a -run session, NOT a deterministic offline export. Works headless: with no display, picopilot runs the session on a private virtual display (ADR-0017, --display).';

/** Resolves a path argument to an absolute path (relative to cwd). */
function resolvePath(p: string): string {
	return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/**
 * Chooses (and creates) the isolated dir PICO-8 records the WAV into. Because
 * `extcmd("audio_end", 1)` writes to PICO-8's CURRENT folder (steered via
 * `-root_path`), the WAV MUST land here, never `~/Desktop` or the carts root
 * (the shared-write discipline, the `audio_end(1)` trap). A user-given path is
 * honoured; otherwise a fresh temp dir.
 */
function chooseWavDir(given: string | undefined): string {
	const dir =
		given !== undefined
			? isAbsolute(given)
				? given
				: resolve(process.cwd(), given)
			: mkdtempSync(join(tmpdir(), 'picopilot-audio-'));
	if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
	return dir;
}

/** The env schema both audio subcommands share (locates the binary). */
const AUDIO_ENV = PICO8_ENV;

/** The structured analysis of a recording (`audio analyze`, `--analyze`). */
const ANALYSIS_OUTPUT = z.object({
	sampleRate: z.number(),
	durationSeconds: z.number(),
	skippedSeconds: z
		.number()
		.describe('Seconds skipped at the start (PICO-8 startup).'),
	analyzedSeconds: z.number(),
	loudness: z.object({
		meanRms: z
			.number()
			.describe(
				`Mean RMS of 2048-sample frames (0-1). Accepted game music: 0.07-0.10; over ${THRESHOLDS.loudMeanRms} warns.`,
			),
		medianRms: z.number(),
		peakFrameRms: z.number().describe('The loudest frame.'),
		peakFrameAtSeconds: z
			.number()
			.describe('When the loudest frame starts (s from file start).'),
		peakSample: z.number().describe('99.9th-percentile absolute sample.'),
		silentPercent: z.number().describe('Share of silent frames (%).'),
	}),
	brightness: z.object({
		centroidHz: z
			.number()
			.describe(
				`Median spectral centroid (Hz). Accepted: under 500; over ${THRESHOLDS.shrillCentroidHz} is shrill.`,
			),
		above2kHzPercent: z
			.number()
			.describe(
				`Share of energy above 2 kHz (%). Accepted: about 0.2; over ${THRESHOLDS.shrillAbove2kHzPercent} is shrill.`,
			),
	}),
	dynamicRangeDb: z
		.number()
		.describe(
			`p90 - p10 of frame level, silence excluded (dB). Accepted: 7-8; under ${THRESHOLDS.flatRangeDb} is monotonous.`,
		),
	profile: z.object({
		stepSeconds: z.number(),
		rms: z.array(z.number()),
		sparkline: z.string().describe('The loudness profile as a bar chart.'),
	}),
	loop: z
		.object({
			seconds: z.number().nullable(),
			confidence: z.number().optional(),
			reason: z.string().optional(),
		})
		.describe(
			'The repetition length (needs the loop to appear twice in the recording).',
		),
	against: z
		.object({referenceRms: z.number(), musicOverReferenceDb: z.number()})
		.optional(),
	warnings: z
		.array(z.object({code: z.string(), message: z.string()}))
		.describe('Plain-language findings; empty = nothing flagged.'),
});

/** The `--analyze` option of record/render. */
const ANALYZE_OPTION = z
	.boolean()
	.default(false)
	.describe(
		'Also analyze the captured WAV (loudness, brightness, dynamic range, profile, loop length, warnings), as `audio analyze` does.',
	);

/**
 * Analyzes a captured WAV for `--analyze`, or explains why it could not. Never
 * fails the recording itself.
 */
function analyzeCapture(
	wavPath: string | undefined,
	kind: 'music' | 'sfx',
): {analysis: AudioAnalysis} | {analysisError: string} | undefined {
	if (wavPath === undefined) return undefined;
	try {
		// An SFX render starts recording on the frame the SFX starts: skip
		// nothing, or a short SFX would be measured on its silent tail only.
		return {
			analysis: analyzeAudio(decodeWav(readFileSync(wavPath)), {
				kind,
				skipSeconds: kind === 'sfx' ? 0 : 1,
			}),
		};
	} catch (e) {
		return {analysisError: e instanceof Error ? e.message : String(e)};
	}
}

/** The structured output shape shared by `record` and `render`. */
const AUDIO_OUTPUT = z.object({
	wav: z
		.string()
		.optional()
		.describe(
			'Absolute path of the recorded WAV, or omitted if no audio was captured (see noAudioReason).',
		),
	captured: z
		.boolean()
		.describe(
			'Whether a non-empty WAV was captured (false = silent/empty run).',
		),
	exitReason: z
		.enum(['sentinel', 'timeout', 'exit'])
		.describe(
			'sentinel = the harness signalled done; timeout = backstop fired; exit = PICO-8 quit.',
		),
	target: z
		.string()
		.describe('What was recorded (the running cart, or the render target).'),
	seconds: z
		.number()
		.describe('The record window in seconds the capture ran for.'),
	printh: z.string().describe('Captured stdout from the session.'),
	display: z
		.enum(['native', 'Xvfb', 'xvfb-run'])
		.optional()
		.describe(
			'Which display the -run session used: native, or a private virtual display (Xvfb / xvfb-run).',
		),
	noAudioReason: z
		.string()
		.optional()
		.describe(
			'When no WAV was captured: why (backstop fired / PICO-8 exited before the done-sentinel / empty capture).',
		),
	pico8LogTail: z
		.string()
		.optional()
		.describe(
			"When no WAV was captured: the tail of PICO-8's own log.txt (load errors, SDL init failures).",
		),
	analysis: ANALYSIS_OUTPUT.optional().describe(
		'With --analyze: the analysis of the captured WAV.',
	),
	analysisError: z
		.string()
		.optional()
		.describe('With --analyze: why the WAV could not be analyzed.'),
});

/**
 * The advisory CTA when a record/render run captured NO audio. The report's
 * `noAudioReason` + `pico8LogTail` say why; this points at the next step.
 */
function noAudioCta(reason: string | undefined) {
	return {
		description: `No audio was captured${reason !== undefined ? ` (${reason})` : ''}. Next:`,
		commands: [
			{
				command: 'verify',
				description:
					'Run the static gate: a cart that fails to load or errors never reaches audio_end.',
			},
			{
				command: 'doctor',
				description: 'Check PICO-8 and display capabilities on this machine.',
			},
		],
	};
}

/** Maps a failed record result onto the structured `error(...)` payload. */
function recordFailure(
	what: string,
	result: Exclude<Pico8RecordResult, {ok: true}>,
) {
	return result.reason === 'display-unavailable'
		? displayUnavailableError(what, result)
		: pico8NotFoundError(result);
}

/** Shapes an adapter record report into the structured output object. */
function recordOutput(
	report: Extract<Pico8RecordResult, {ok: true}>['value'],
	harness: {seconds: number; description: string},
) {
	return {
		wav: report.wavPath,
		captured: report.wavPath !== undefined,
		exitReason: report.exitReason,
		target: harness.description,
		seconds: harness.seconds,
		printh: report.printh,
		...(report.display !== undefined ? {display: report.display} : {}),
		...(report.noWavReason !== undefined
			? {noAudioReason: report.noWavReason}
			: {}),
		...(report.pico8LogTail !== undefined
			? {pico8LogTail: report.pico8LogTail}
			: {}),
	};
}

/**
 * Builds the `audio` command group: `audio record <cart>` (the record primitive)
 * and `audio render` (US #13, the convenience harness over it). Both are
 * PICO-8-gated (ADR-0009): PICO-8 absent returns the structured `pico8-not-found`
 * + nonzero exit. Both are record-based, real-time captures, NOT offline exports.
 */
function buildAudioGroup(adapterFactory: Pico8AdapterFactory): Cli.Cli {
	const audio = Cli.create('audio', {
		description:
			'Get a WAV out of a cart by RECORDING a running session (ADR-0009), and measure it. PICO-8 has no working offline WAV export, so `record` and `render` are REAL-TIME recordings of a -run session, NOT deterministic offline exports; they work headless (with no display, picopilot runs the session on a private virtual display, ADR-0017) and require PICO-8. `analyze` measures a WAV (loudness, brightness, dynamics, loop length) and needs nothing.',
	});

	// --- audio record <cart> ---------------------------------------------------
	audio.command('record', {
		description: `Record a running cart's own audio to a WAV. Injects a throwaway cooperative recorder (audio_rec/audio_end) around the cart, runs it in a real A/V session, and returns the WAV path. ${HONEST_CAVEAT} Requires PICO-8.`,
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart to run and record. Defaults to main.p8 in the current folder.',
				),
		}),
		options: z.object({
			seconds: z.coerce
				.number()
				.positive()
				.default(8)
				.describe('How long (seconds) to record the running cart.'),
			wavDir: z
				.string()
				.optional()
				.describe(
					'Where PICO-8 writes the WAV. Defaults to an isolated temp dir; NEVER ~/Desktop or the carts root.',
				),
			sentinel: z
				.string()
				.default(DONE_SENTINEL)
				.describe('The stdout line that ends the recording.'),
			backstopMs: BACKSTOP_OPTION,
			analyze: ANALYZE_OPTION,
			display: DISPLAY_OPTION,
		}),
		env: AUDIO_ENV,
		output: AUDIO_OUTPUT,
		examples: [
			{description: 'Record 8 seconds of main.p8'},
			{
				description: 'Record a specific cart for 4 seconds',
				args: {cart: 'game.p8'},
				options: {seconds: 4},
			},
		],
		async run({args, options, env, error, ok, var: vars}) {
			const cartPath = resolvePath(args.cart);
			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			let harness: ReturnType<typeof buildRecordHarness>;
			try {
				// `#include`s are inlined against the SOURCE cart's folder: the harness
				// runs from the isolated wavDir, where `main.lua` does not exist.
				harness = buildRecordHarness(readFileSync(cartPath, 'utf8'), {
					seconds: options.seconds,
					sentinel: options.sentinel,
					readInclude: makeReadInclude(cartPath),
				});
			} catch (e) {
				if (e instanceof HarnessError) {
					return error({code: e.code, message: e.message, exitCode: 1});
				}
				throw e;
			}

			const backstop = resolveRecordBackstop(
				harness.seconds,
				options.backstopMs,
			);
			if (!backstop.ok) {
				return error({
					code: 'audio-backstop-too-small',
					message: backstop.message,
					exitCode: 1,
				});
			}

			// The throwaway harness cart + the WAV both live in the isolated dir, so a
			// record run never mutates the user's cart or writes outside the temp dir.
			const wavDir = chooseWavDir(options.wavDir);
			const harnessCart = join(wavDir, 'record-harness.p8');
			writeFileSync(harnessCart, harness.cartText);

			const display = resolveCommandDisplay(options.display, vars);
			if (!display.ok) return error(display.error);
			const adapter = adapterFactory(env as NodeJS.ProcessEnv, {
				display: display.mode,
			});
			const result = await adapter.record({
				cartPath: harnessCart,
				wavDir,
				wavBasename: harness.wavBasename,
				sentinel: options.sentinel,
				backstopMs: backstop.ms,
			});

			if (!result.ok) return error(recordFailure('audio record', result));

			const out = {
				...recordOutput(result.value, harness),
				...(options.analyze
					? analyzeCapture(result.value.wavPath, 'music')
					: {}),
			};
			return ok(
				out,
				out.captured ? undefined : {cta: noAudioCta(out.noAudioReason)},
			);
		},
	});

	// --- audio render ----------------------------------------------------------
	audio.command('render', {
		description: `Render an authored target (sfx / music pattern / the whole song) to a WAV by injecting a play-harness, recording it, and returning the WAV path (US #13). The author writes NO playback code. ${HONEST_CAVEAT} With no --sfx/--pattern it renders the whole song (music 0). Requires PICO-8.`,
		args: z.object({
			cart: z
				.string()
				.default('main.p8')
				.describe(
					'The .p8 cart whose authored __sfx__/__music__ to render. Defaults to main.p8.',
				),
		}),
		options: z.object({
			sfx: z.coerce
				.number()
				.int()
				.min(0)
				.max(63)
				.optional()
				.describe(
					'Render this SFX slot (0-63). Mutually exclusive with --pattern.',
				),
			pattern: z.coerce
				.number()
				.int()
				.min(0)
				.max(63)
				.optional()
				.describe(
					'Render this music pattern (0-63). Mutually exclusive with --sfx.',
				),
			seconds: z.coerce
				.number()
				.positive()
				.optional()
				.describe(
					'Override the record window (seconds). Default: derived from the SFX speed+rows for --sfx, else 8s for a pattern/song.',
				),
			wavDir: z
				.string()
				.optional()
				.describe(
					'Where PICO-8 writes the WAV. Defaults to an isolated temp dir; NEVER ~/Desktop or the carts root.',
				),
			sentinel: z
				.string()
				.default(DONE_SENTINEL)
				.describe('The stdout line that ends the recording.'),
			backstopMs: BACKSTOP_OPTION,
			analyze: ANALYZE_OPTION,
			display: DISPLAY_OPTION,
		}),
		env: AUDIO_ENV,
		output: AUDIO_OUTPUT,
		examples: [
			{description: 'Render the whole song (music 0) of main.p8'},
			{description: 'Render SFX slot 5', options: {sfx: 5}},
			{
				description: 'Render music pattern 2 of a cart for 6 seconds',
				args: {cart: 'game.p8'},
				options: {pattern: 2, seconds: 6},
			},
		],
		async run({args, options, env, error, ok, var: vars}) {
			if (options.sfx !== undefined && options.pattern !== undefined) {
				return error({
					code: 'ambiguous-target',
					message:
						'pass EITHER --sfx OR --pattern, not both (a render targets one of: an SFX slot, a music pattern, or the whole song).',
					exitCode: 1,
				});
			}
			const target: RenderTarget =
				options.sfx !== undefined
					? {kind: 'sfx', index: options.sfx}
					: options.pattern !== undefined
						? {kind: 'pattern', index: options.pattern}
						: {kind: 'song'};

			const cartPath = resolvePath(args.cart);
			if (!existsSync(cartPath)) {
				return error({
					code: 'cart-not-found',
					message: `no cart at ${cartPath}`,
					exitCode: 1,
				});
			}

			let harness: ReturnType<typeof buildRenderHarness>;
			try {
				harness = buildRenderHarness(readFileSync(cartPath, 'utf8'), target, {
					seconds: options.seconds,
					sentinel: options.sentinel,
				});
			} catch (e) {
				if (e instanceof HarnessError) {
					// A target refusal (out-of-range / empty slot / bad cart): structured,
					// never a silent recording of silence.
					return error({code: e.code, message: e.message, exitCode: 1});
				}
				throw e;
			}

			const backstop = resolveRecordBackstop(
				harness.seconds,
				options.backstopMs,
			);
			if (!backstop.ok) {
				return error({
					code: 'audio-backstop-too-small',
					message: backstop.message,
					exitCode: 1,
				});
			}

			const wavDir = chooseWavDir(options.wavDir);
			const harnessCart = join(wavDir, 'render-harness.p8');
			writeFileSync(harnessCart, harness.cartText);

			const display = resolveCommandDisplay(options.display, vars);
			if (!display.ok) return error(display.error);
			const adapter = adapterFactory(env as NodeJS.ProcessEnv, {
				display: display.mode,
			});
			const result = await adapter.record({
				cartPath: harnessCart,
				wavDir,
				wavBasename: harness.wavBasename,
				sentinel: options.sentinel,
				backstopMs: backstop.ms,
			});

			if (!result.ok) return error(recordFailure('audio render', result));

			const out = {
				...recordOutput(result.value, harness),
				...(options.analyze
					? analyzeCapture(
							result.value.wavPath,
							target.kind === 'sfx' ? 'sfx' : 'music',
						)
					: {}),
			};
			return ok(
				out,
				out.captured ? undefined : {cta: noAudioCta(out.noAudioReason)},
			);
		},
	});

	// --- audio analyze <wav> ----------------------------------------------------
	audio.command('analyze', {
		description: `Measure a WAV (from \`audio render\` / \`audio record\`) so a model that cannot hear can judge it: loudness (mean/peak RMS, loudest moment), brightness (spectral centroid, energy above 2 kHz), dynamic range, a loudness profile per half second, and the loop length, plus plain-language warnings (loud, shrill, monotonous, spikes, repetitive). Skips the first second by default (as the calibration did); thresholds are for music, \`--kind sfx\` keeps only the checks that apply to a one-shot sound. --against <sfx.wav> compares the music's loudness with a rendered SFX, so the music sits under the SFX. Pure TypeScript: needs neither PICO-8 nor Python.`,
		args: z.object({
			wav: z.string().describe('The WAV file to analyze.'),
		}),
		options: z.object({
			skip: z.coerce
				.number()
				.min(0)
				.default(1)
				.describe(
					'Seconds to skip at the start (default 1, as in the calibration; use 0 for an SFX render). Ignored when the WAV is too short for it.',
				),
			kind: z
				.enum(['music', 'sfx'])
				.default('music')
				.describe(
					'music: every warning; sfx: a one-shot sound, only near-silent / near-clipping (the music thresholds do not apply).',
				),
			against: z
				.string()
				.optional()
				.describe(
					'A reference SFX WAV (e.g. from `audio render --sfx 7`): report the music level relative to it and warn when the music is not quieter.',
				),
		}),
		output: ANALYSIS_OUTPUT,
		examples: [
			{
				description: 'Analyze a rendered song',
				args: {wav: '/tmp/picopilot-audio-x/picopilot-audio.wav'},
			},
			{
				description: 'Check the music sits under an SFX',
				args: {wav: 'music.wav'},
				options: {against: 'explosion.wav'},
			},
		],
		run({args, options, error, ok}) {
			const read = (p: string) => {
				const abs = resolvePath(p);
				if (!existsSync(abs)) {
					throw new AudioAnalyzeError(
						'audio-analyze-bad-wav',
						`no WAV at ${abs}`,
					);
				}
				return decodeWav(readFileSync(abs));
			};
			let analysis: AudioAnalysis;
			try {
				analysis = analyzeAudio(read(args.wav), {
					skipSeconds: options.skip,
					kind: options.kind,
					...(options.against !== undefined
						? {against: read(options.against)}
						: {}),
				});
			} catch (e) {
				if (e instanceof AudioAnalyzeError) {
					return error({code: e.code, message: e.message, exitCode: 1});
				}
				throw e;
			}
			return ok(
				analysis,
				analysis.warnings.length > 0
					? {
							cta: {
								description:
									'Fix the flagged issues in the score, then measure again:',
								commands: [
									{
										command: 'music from-score --file <score.json>',
										description: 'Rewrite the music.',
									},
									{
										command: 'audio render --pattern <n> --analyze',
										description: 'Record and analyze it again.',
									},
								],
							},
						}
					: undefined,
			);
		},
	});

	return audio;
}

/**
 * Registers the `audio` command group (`audio record`, `audio render`, `audio
 * analyze`) on the root CLI. PICO-8-gated (ADR-0009): audio-to-WAV is a record of a running
 * session, never an offline export. `adapterFactory` is injected so tests drive
 * the orchestration against a fake runner (no paid binary in CI).
 */
export function registerAudio(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
): void {
	cli.command(buildAudioGroup(adapterFactory));
}
