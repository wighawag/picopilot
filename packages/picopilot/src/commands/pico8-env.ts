import {z} from 'incur';
import {
	DEFAULT_DISPLAY_MODE,
	DISPLAY_MODES,
	type DisplayMode,
	isDisplayMode,
	type Pico8Adapter,
	pico8ChildEnv,
	ShellPico8Adapter,
	type SpawnRunner,
	type VirtualDisplayDeps,
} from '../engine/pico8/index.js';

/**
 * The env schema every PICO-8-gated command declares. These are the values
 * picopilot itself RESOLVES (incur reads them from its env source, which tests
 * override); they are NOT the whole child environment. The child gets the
 * parent environment with these overlaid ({@link pico8ChildEnv}), so PICO-8
 * still sees DISPLAY, HOME, XDG_RUNTIME_DIR, SDL_* and the rest.
 */
export const PICO8_ENV = z.object({
	PICO8_PATH: z
		.string()
		.optional()
		.describe('Explicit path to the PICO-8 binary (else `pico8` on PATH).'),
	PATH: z.string().optional().describe('Used to locate `pico8`.'),
});

/** What a command knows beyond the env when it builds an adapter. */
export interface Pico8AdapterContext {
	/** The resolved display mode for `-run` sessions (ADR-0017). */
	readonly display: DisplayMode;
}

/**
 * Injects the PICO-8 adapter a command uses. A test passes a stub to drive the
 * sentinel/backstop/absent paths without the paid binary; the default is
 * {@link createShellAdapterFactory}.
 */
export type Pico8AdapterFactory = (
	env: NodeJS.ProcessEnv,
	context?: Pico8AdapterContext,
) => Pico8Adapter;

/** Dependencies for {@link createShellAdapterFactory}, injectable for tests. */
export interface ShellAdapterFactoryDeps {
	/** The parent environment PICO-8 inherits (defaults to `process.env`). */
	readonly parentEnv?: NodeJS.ProcessEnv;
	/** The PICO-8 spawn seam (defaults to the real spawn). */
	readonly spawn?: SpawnRunner;
	/** The virtual-display seam (Xvfb lookup + spawn). */
	readonly virtualDisplay?: VirtualDisplayDeps;
}

/**
 * The default adapter factory: the shell adapter over the user's PICO-8, with
 * the child env = parent env + the command's resolved values, and the display
 * mode from the context.
 */
export function createShellAdapterFactory(
	deps: ShellAdapterFactoryDeps = {},
): Pico8AdapterFactory {
	return (env, context) =>
		new ShellPico8Adapter({
			env: pico8ChildEnv(
				env as Record<string, string | undefined>,
				deps.parentEnv ?? process.env,
			),
			spawn: deps.spawn,
			display: context?.display ?? DEFAULT_DISPLAY_MODE,
			virtualDisplay: deps.virtualDisplay,
		});
}

/**
 * The `display` option of the commands that use the display mode (`run`,
 * `audio record`, `audio render`, `doctor`). A per-command option, not an incur
 * global, because incur's MCP transport passes no globals: as an option it is
 * also an argument of the MCP tool. Unset = the invocation-level value.
 */
export const DISPLAY_OPTION = z
	.enum(DISPLAY_MODES)
	.optional()
	.describe(
		'How a PICO-8 -run session (audio recording) gets a display: auto (default: a private virtual display only when there is none), xvfb (always virtual), native (as-is). Else PICOPILOT_DISPLAY, else picopilot.json "display".',
	);

/**
 * The display mode the root middleware in `createCli` resolved for this
 * invocation (top-level `--display` > PICOPILOT_DISPLAY > picopilot.json >
 * auto). A command mounted on a bare CLI (some tests) has no var and gets the
 * default.
 */
export function displayModeOf(vars: unknown): DisplayMode {
	const value =
		vars !== null && typeof vars === 'object'
			? (vars as {display?: unknown}).display
			: undefined;
	return isDisplayMode(value) ? value : DEFAULT_DISPLAY_MODE;
}

/**
 * The display mode a command uses: its own `display` option (a per-call MCP
 * argument) wins, else the invocation-level value. An invalid invocation-level
 * value (a typo in PICOPILOT_DISPLAY, say) is an `invalid-display-mode` error
 * here, so only the commands that use the mode fail on it.
 */
export function resolveCommandDisplay(
	option: DisplayMode | undefined,
	vars: unknown,
):
	| {ok: true; mode: DisplayMode}
	| {
			ok: false;
			error: {code: 'invalid-display-mode'; message: string; exitCode: number};
	  } {
	if (option !== undefined) return {ok: true, mode: option};
	const problem =
		vars !== null && typeof vars === 'object'
			? (vars as {displayError?: unknown}).displayError
			: undefined;
	if (typeof problem === 'string') {
		return {
			ok: false,
			error: {code: 'invalid-display-mode', message: problem, exitCode: 1},
		};
	}
	return {ok: true, mode: displayModeOf(vars)};
}

/**
 * Under `--mcp`, incur loads no config file, so picopilot loads picopilot.json
 * itself and hands the tree to commands as the `mcpConfig` var. A command whose
 * option can come from the config reads its fallback here (CLI runs get it from
 * incur as the option's default, so this is undefined there).
 */
export function mcpConfigOption(
	vars: unknown,
	commandPath: readonly string[],
	key: string,
): unknown {
	let node: unknown =
		vars !== null && typeof vars === 'object'
			? (vars as {mcpConfig?: unknown}).mcpConfig
			: undefined;
	for (const part of commandPath) {
		node = (node as {commands?: Record<string, unknown>} | undefined)
			?.commands?.[part];
	}
	return (node as {options?: Record<string, unknown>} | undefined)?.options?.[
		key
	];
}

/**
 * The `error(...)` payload for a `display-unavailable` result (ADR-0017): the
 * session needs a display, there is none, and no Xvfb is installed to provide a
 * virtual one. The message and CTA name the fix, so the agent never has to
 * discover it by a silent timeout.
 */
export function displayUnavailableError(
	what: string,
	result: {detail: string; remedy: string},
) {
	return {
		code: 'display-unavailable' as const,
		message: `${what} needs a display (a real audio+video -run session): ${result.detail}. Remedy: ${result.remedy}.`,
		exitCode: 1,
		cta: {
			description: `No display and no Xvfb on this machine. Fix: ${result.remedy}. Then re-run; picopilot starts a private virtual display by itself (--display auto). Check what this machine can do:`,
			commands: [
				{
					command: 'doctor',
					description:
						'Report PICO-8, shrinko8 and display capabilities, and which commands are available here.',
				},
			],
		},
	};
}

/** The `error(...)` payload for a `pico8-not-found` result (the exact remedy + needs). */
export function pico8NotFoundError(result: {
	remedy: string;
	needs: readonly string[];
}) {
	return {
		code: 'pico8-not-found' as const,
		message: `PICO-8 is not installed. ${result.remedy} (needs: ${result.needs.join(', ')})`,
		exitCode: 1,
	};
}
