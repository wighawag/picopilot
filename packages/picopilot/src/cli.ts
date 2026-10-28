import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
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

/** The config files picopilot searches (first existing wins), relative to the cwd. */
const CONFIG_FILES = ['picopilot.json'];

/**
 * What one `serve` invocation said at the top level, captured BEFORE incur sees
 * the argv: the `--display` flag (taken out of argv, so it works before or after
 * the command name and on `--mcp`), and for `--mcp` the config flags. incur's
 * MCP transport passes no global flags to a tool call and loads no config file,
 * so picopilot carries both itself.
 */
interface Invocation {
	display?: string;
	mcp: boolean;
	/** MCP only: the config tree picopilot loaded itself (undefined = none). */
	mcpConfig?: Record<string, unknown>;
}

/**
 * Removes every `--display <v>` / `--display=<v>` from argv and returns the last
 * value. A `--display` with no value (last token, or followed by another flag)
 * stays in argv, so incur rejects it instead of it silently eating the next flag.
 */
function takeDisplayFlag(argv: string[]): {argv: string[]; display?: string} {
	const rest: string[] = [];
	let display: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		const next = argv[i + 1];
		if (a === '--display' && next !== undefined && !next.startsWith('-')) {
			display = next;
			i++;
		} else if (a.startsWith('--display=') && a.length > '--display='.length) {
			display = a.slice('--display='.length);
		} else {
			rest.push(a);
		}
	}
	return {argv: rest, display};
}

/** Resolves a config path the way incur does: `~` is the home dir, else relative to the cwd. */
function resolveConfigPath(path: string): string {
	return path === '~' || path.startsWith('~/')
		? join(homedir(), path.slice(1))
		: resolve(path);
}

/**
 * For `--mcp`: the config file incur would have loaded on the CLI. Mirrors
 * incur's own parsing: `--config <p>` / `--config=<p>` / `--no-config`, the last
 * one wins, a missing value is an error; else the first existing default file.
 */
function loadMcpConfig(argv: string[]): Record<string, unknown> | undefined {
	let explicit: string | undefined;
	let disabled = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		let value: string | undefined;
		if (a === '--config') value = argv[++i];
		else if (a.startsWith('--config=')) value = a.slice('--config='.length);
		else if (a === '--no-config') {
			explicit = undefined;
			disabled = true;
			continue;
		} else continue;
		if (value === undefined || value === '') {
			throw new Error('Missing value for flag: --config');
		}
		explicit = value;
		disabled = false;
	}
	if (disabled) return undefined;
	const sink: {display?: unknown} = {};
	if (explicit !== undefined) {
		return loadConfig(resolveConfigPath(explicit), sink);
	}
	for (const file of CONFIG_FILES) {
		const path = resolveConfigPath(file);
		if (existsSync(path)) return loadConfig(path, sink);
	}
	return undefined;
}

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
			files: CONFIG_FILES,
			loader: async (path) => loadConfig(path, configSink),
		},
		// The display mode (ADR-0017): `--display` (a per-command option on the
		// commands that use it, also accepted anywhere on the command line and on
		// `--mcp`) > PICOPILOT_DISPLAY > picopilot.json `display` > auto.
		env: z.object({
			[DISPLAY_ENV_VAR]: z
				.string()
				.optional()
				.describe('Display mode: auto | xvfb | native (below --display).'),
		}),
		vars: z.object({
			display: z.enum(DISPLAY_MODES).default(DEFAULT_DISPLAY_MODE),
			displayError: z.string().optional(),
			mcpConfig: z.record(z.string(), z.unknown()).optional(),
		}),
		mcp: {
			// One MCP tool per command (incur's default is progressive discovery
			// behind search/call meta-tools); picopilot's surface is small, and the
			// skills name commands directly.
			tools: {discovery: 'direct'},
		},
	});

	const invocation: Invocation = {mcp: false};

	cli.use(async (c, next) => {
		const configured = invocation.mcp
			? invocation.mcpConfig?.[DISPLAY_CONFIG_KEY]
			: configSink.display;
		configSink.display = undefined; // never leak into a later invocation
		const resolved = resolveDisplayMode({
			flag: invocation.display,
			env: (c.env as Record<string, string | undefined>)[DISPLAY_ENV_VAR],
			config: configured,
		});
		if (resolved.ok) {
			c.set('display', resolved.mode);
		} else {
			// Not an error here: only the commands that USE the display mode fail
			// on a bad value (see resolveCommandDisplay); the rest run as usual.
			const where =
				resolved.source === 'flag'
					? '--display'
					: resolved.source === 'env'
						? DISPLAY_ENV_VAR
						: `picopilot.json "${DISPLAY_CONFIG_KEY}"`;
			c.set(
				'displayError',
				`${where} is "${resolved.value}"; expected one of: ${DISPLAY_MODES.join(', ')}.`,
			);
		}
		if (invocation.mcp && invocation.mcpConfig !== undefined) {
			c.set('mcpConfig', invocation.mcpConfig);
		}
		await next();
	});

	// Capture the top-level `--display` (and, for `--mcp`, the config) before
	// incur parses argv; see {@link Invocation}.
	const serve = cli.serve.bind(cli);
	cli.serve = async (argv = process.argv.slice(2), options) => {
		const taken = takeDisplayFlag(argv);
		invocation.display = taken.display;
		invocation.mcp = taken.argv.includes('--mcp');
		invocation.mcpConfig = undefined;
		if (invocation.mcp) {
			try {
				invocation.mcpConfig = loadMcpConfig(taken.argv);
			} catch (e) {
				// A broken config must stop the server visibly, not serve without it.
				process.stderr.write(
					`picopilot --mcp: ${e instanceof Error ? e.message : String(e)}\n`,
				);
				process.exitCode = 1;
				return;
			}
		}
		return serve(taken.argv, options);
	};

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
