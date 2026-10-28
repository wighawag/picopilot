import {readFileSync} from 'node:fs';
import {Cli, z} from 'incur';
import {registerAudio} from './commands/audio.js';
import {registerDoctor} from './commands/doctor.js';
import {registerExport} from './commands/export.js';
import {registerGfx} from './commands/gfx.js';
import {registerInit} from './commands/init.js';
import {registerLint} from './commands/lint.js';
import {registerMinify} from './commands/minify.js';
import {registerMusic} from './commands/music.js';
import {registerPlaytest} from './commands/playtest.js';
import {registerRun} from './commands/run.js';
import {registerServe} from './commands/serve.js';
import {registerSfx} from './commands/sfx.js';
import {registerTokens} from './commands/tokens.js';
import {registerVerify} from './commands/verify.js';
import {registerVersion} from './commands/version.js';
import {
	DEFAULT_DISPLAY_MODE,
	DISPLAY_CONFIG_KEY,
	DISPLAY_ENV_VAR,
	DISPLAY_MODES,
	resolveDisplayMode,
} from './engine/pico8/display.js';
import {VERSION} from './version.js';

/** The commands that use the display mode (they start a `-run` session, or report on it). */
const DISPLAY_COMMANDS: ReadonlySet<string> = new Set([
	'run',
	'audio record',
	'audio render',
	'doctor',
]);

/**
 * Reads a picopilot.json for incur's config layer AND captures its top-level
 * {@link DISPLAY_CONFIG_KEY}. incur only maps per-command `options` from the
 * config file; the display mode is a GLOBAL setting, so the loader hands the
 * value to the display middleware through `sink`.
 */
function loadConfig(
	path: string | undefined,
	sink: {display?: unknown},
): Record<string, unknown> | undefined {
	sink.display = undefined;
	if (path === undefined) return undefined;
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (e) {
		// incur only hands the loader an existing file unless --config named one.
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(`Config file not found: ${path}`);
		}
		throw e;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Invalid JSON config file: ${path}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`Config file must hold a JSON object: ${path}`);
	}
	sink.display = (parsed as Record<string, unknown>)[DISPLAY_CONFIG_KEY];
	return parsed as Record<string, unknown>;
}

/**
 * Builds the root picopilot CLI.
 *
 * One `Cli.create()` definition yields the CLI, an MCP server, auto-installable
 * skills, TOON output, Zod schemas, CTAs, and the structured error envelope.
 * Command groups are mounted here through their `register*` helpers; each group
 * owns its own module under `src/commands/` and its engine under `src/engine/`,
 * so later tasks add a line here without restructuring.
 *
 * Exposed as a factory (not a module-level singleton) so tests can build a fresh
 * CLI and drive it with `cli.serve(argv, { stdout, exit, env })` DI overrides.
 */
export function createCli(): Cli.Cli {
	const configSink: {display?: unknown} = {};
	const cli = Cli.create('picopilot', {
		version: VERSION,
		description: 'An agent-first toolchain for PICO-8 game development.',
		// `depth: 1` yields one skill file per top-level command group (US #20).
		sync: {
			depth: 1,
		},
		// Per-cart policy config (e.g. `allowMapOverlap`); precedence argv > config > defaults.
		config: {
			flag: 'config',
			files: ['picopilot.json'],
			loader: async (path) => loadConfig(path, configSink),
		},
		// The display mode (ADR-0017) is global: it applies to every command that
		// starts a PICO-8 `-run` session. Precedence: --display > PICOPILOT_DISPLAY
		// > picopilot.json `display` > auto.
		globals: z.object({
			display: z
				.enum(DISPLAY_MODES)
				.optional()
				.describe(
					'How PICO-8 -run sessions (audio record/render, run --record-audio) get a display: auto (default: a private virtual display only when there is none), xvfb (always virtual), native (as-is). Also PICOPILOT_DISPLAY or picopilot.json "display" (under --mcp, only PICOPILOT_DISPLAY applies).',
				),
		}),
		env: z.object({
			[DISPLAY_ENV_VAR]: z
				.string()
				.optional()
				.describe('Display mode: auto | xvfb | native (below --display).'),
		}),
		vars: z.object({
			display: z.enum(DISPLAY_MODES).default(DEFAULT_DISPLAY_MODE),
		}),
	});

	cli.use(async (c, next) => {
		const configured = configSink.display;
		configSink.display = undefined; // never leak into a later invocation
		const resolved = resolveDisplayMode({
			// incur's MCP transport passes no globals (and loads no config file), so
			// under `--mcp` only PICOPILOT_DISPLAY applies.
			flag: c.globals?.display,
			env: (c.env as Record<string, string | undefined>)[DISPLAY_ENV_VAR],
			config: configured,
		});
		if (!resolved.ok) {
			// A bad value only fails the commands that use it; the rest run as usual.
			if (!DISPLAY_COMMANDS.has(c.command)) return next();
			// (An invalid --display never gets here: incur's enum rejects it first.)
			const where =
				resolved.source === 'env'
					? DISPLAY_ENV_VAR
					: `picopilot.json "${DISPLAY_CONFIG_KEY}"`;
			return c.error({
				code: 'invalid-display-mode',
				message: `${where} is "${resolved.value}"; expected one of: ${DISPLAY_MODES.join(', ')}.`,
				exitCode: 1,
			});
		}
		c.set('display', resolved.mode);
		await next();
	});

	// The register* helpers take the untyped Cli: the display var is read through
	// `displayModeOf`, so they do not depend on this CLI's generics.
	const root = cli as unknown as Cli.Cli;
	registerVersion(root);
	registerDoctor(root);
	registerInit(root);
	registerGfx(root);
	registerTokens(root);
	registerLint(root);
	registerMinify(root);
	registerVerify(root);
	registerRun(root);
	registerExport(root);
	registerServe(root);
	registerPlaytest(root);
	registerSfx(root);
	registerMusic(root);
	registerAudio(root);

	return root;
}
