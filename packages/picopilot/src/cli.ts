import {Cli} from 'incur';
import {registerAudio} from './commands/audio.js';
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
import {VERSION} from './version.js';

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
		},
	});

	registerVersion(cli);
	registerInit(cli);
	registerGfx(cli);
	registerTokens(cli);
	registerLint(cli);
	registerMinify(cli);
	registerVerify(cli);
	registerRun(cli);
	registerExport(cli);
	registerServe(cli);
	registerPlaytest(cli);
	registerSfx(cli);
	registerMusic(cli);
	registerAudio(cli);

	return cli;
}
