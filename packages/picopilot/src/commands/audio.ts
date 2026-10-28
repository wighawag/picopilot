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
	displayModeOf,
	displayUnavailableError,
	PICO8_ENV,
	type Pico8AdapterFactory,
	pico8NotFoundError,
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
 * The default record backstop: kill a capture that never signals after this many
 * ms. Larger than `run`'s default because a record window is a real-time playback
 * (up to several seconds) plus PICO-8 startup, not a quick screenshot pass.
 */
const DEFAULT_BACKSTOP_MS = 30_000;

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
			'Get a WAV out of a cart by RECORDING a running session (ADR-0009). PICO-8 has no working offline WAV export, so both commands are REAL-TIME recordings of a -run session, NOT deterministic offline exports. They work headless: with no display, picopilot runs the session on a private virtual display (ADR-0017). Requires PICO-8.',
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
			backstopMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_BACKSTOP_MS)
				.describe(
					'Safety backstop: kill PICO-8 after this many ms if it never signals.',
				),
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

			// The throwaway harness cart + the WAV both live in the isolated dir, so a
			// record run never mutates the user's cart or writes outside the temp dir.
			const wavDir = chooseWavDir(options.wavDir);
			const harnessCart = join(wavDir, 'record-harness.p8');
			writeFileSync(harnessCart, harness.cartText);

			const adapter = adapterFactory(env as NodeJS.ProcessEnv, {
				display: displayModeOf(vars),
			});
			const result = await adapter.record({
				cartPath: harnessCart,
				wavDir,
				wavBasename: harness.wavBasename,
				sentinel: options.sentinel,
				backstopMs: options.backstopMs,
			});

			if (!result.ok) return error(recordFailure('audio record', result));

			const out = recordOutput(result.value, harness);
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
			backstopMs: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_BACKSTOP_MS)
				.describe(
					'Safety backstop: kill PICO-8 after this many ms if it never signals.',
				),
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

			const wavDir = chooseWavDir(options.wavDir);
			const harnessCart = join(wavDir, 'render-harness.p8');
			writeFileSync(harnessCart, harness.cartText);

			const adapter = adapterFactory(env as NodeJS.ProcessEnv, {
				display: displayModeOf(vars),
			});
			const result = await adapter.record({
				cartPath: harnessCart,
				wavDir,
				wavBasename: harness.wavBasename,
				sentinel: options.sentinel,
				backstopMs: options.backstopMs,
			});

			if (!result.ok) return error(recordFailure('audio render', result));

			const out = recordOutput(result.value, harness);
			return ok(
				out,
				out.captured ? undefined : {cta: noAudioCta(out.noAudioReason)},
			);
		},
	});

	return audio;
}

/**
 * Registers the `audio` command group (`audio record`, `audio render`) on the
 * root CLI. PICO-8-gated (ADR-0009): audio-to-WAV is a record of a running
 * session, never an offline export. `adapterFactory` is injected so tests drive
 * the orchestration against a fake runner (no paid binary in CI).
 */
export function registerAudio(
	cli: Cli.Cli,
	adapterFactory: Pico8AdapterFactory = defaultAdapterFactory,
): void {
	cli.command(buildAudioGroup(adapterFactory));
}
