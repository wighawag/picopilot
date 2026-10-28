import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type Cli, z} from 'incur';
import {
	DISPLAY_MODES,
	type DisplayMode,
	detectVirtualDisplayBackend,
	findExecutable,
	hasNativeDisplay,
	needsVirtualDisplay,
	pico8Candidates,
	pico8ChildEnv,
	type VirtualDisplayBackend,
} from '../engine/pico8/index.js';
import {
	createShellAdapterFactory,
	displayModeOf,
	PICO8_ENV,
	type Pico8AdapterFactory,
} from './pico8-env.js';
import {
	createShellShrinkoFactory,
	type ShrinkoAdapterFactory,
} from './shrinko-env.js';

/** The marker the version-probe cart prints in front of `stat(5)`. */
const VERSION_MARKER = '__PICOPILOT_PICO8_VERSION__';

/** The probe cart: print PICO-8's version id, then the done-sentinel. */
const PROBE_SENTINEL = '__PICOPILOT_DOCTOR_DONE__';
const PROBE_CART = `pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
printh("${VERSION_MARKER}"..stat(5))
printh("${PROBE_SENTINEL}")
`;

/** A tiny cart for the shrinko probe (a real `--count` run). */
const SHRINKO_PROBE_CART = `pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
print("hi")
`;

/** The doctor's backstop for the headless PICO-8 probe. */
const PROBE_BACKSTOP_MS = 15_000;

/** What a command needs to run (beyond picopilot itself). */
type Need = 'pico8' | 'shrinko8' | 'display';

/**
 * The capability table: every command (or command mode) and what it needs.
 * `display` means a PICO-8 `-run` session: a native display or a virtual one.
 * The `-x` paths (run screenshots, playtest, export, serve) are headless and
 * need PICO-8 only.
 */
const COMMAND_NEEDS: readonly {command: string; needs: readonly Need[]}[] = [
	{command: 'init', needs: []},
	{command: 'gfx show / set / render', needs: []},
	{command: 'sfx', needs: []},
	{command: 'music', needs: []},
	{command: 'gfx import / export', needs: ['shrinko8']},
	{command: 'tokens', needs: ['shrinko8']},
	{command: 'lint', needs: ['shrinko8']},
	{command: 'minify', needs: ['shrinko8']},
	{command: 'verify', needs: ['shrinko8']},
	{command: 'run', needs: ['pico8']},
	{command: 'playtest', needs: ['pico8']},
	{command: 'export', needs: ['pico8']},
	{command: 'serve', needs: ['pico8']},
	{command: 'run --record-audio', needs: ['pico8', 'display']},
	{command: 'audio record', needs: ['pico8', 'display']},
	{command: 'audio render', needs: ['pico8', 'display']},
];

/** The PICO-8 version from its install path (e.g. `.../pico-8-0.2.7/...`), if it names one. */
function versionFromPath(path: string): string | undefined {
	const m = /pico-?8[-_ ]v?(\d+\.\d+\.\d+[a-z]?)/i.exec(path);
	return m?.[1];
}

/** How a `-run` session would get its display here. */
type RunSessionDisplay = 'native' | 'xvfb' | 'none';

/** Dependencies for {@link registerDoctor}, injectable for tests. */
export interface DoctorDeps {
	readonly pico8?: Pico8AdapterFactory;
	readonly shrinko?: ShrinkoAdapterFactory;
	/** The parent environment (defaults to `process.env`): DISPLAY etc. are read from it. */
	readonly parentEnv?: NodeJS.ProcessEnv;
	/** Executable lookup (defaults to a PATH search). */
	readonly find?: (name: string, env: NodeJS.ProcessEnv) => string | undefined;
}

/**
 * Registers `picopilot doctor`: what can THIS machine do? It reports whether
 * PICO-8 is found (and runs headless, with its version), whether shrinko8 is
 * found, how a PICO-8 `-run` session would get a display (native, a private
 * virtual one via Xvfb, or none), and therefore which commands are available.
 * An agent calls it first instead of discovering limits by failing. It never
 * fails itself: a missing dependency is data in the report.
 */
export function registerDoctor(cli: Cli.Cli, deps: DoctorDeps = {}): void {
	const pico8Factory =
		deps.pico8 ?? createShellAdapterFactory({parentEnv: deps.parentEnv});
	const shrinkoFactory: ShrinkoAdapterFactory =
		deps.shrinko ?? createShellShrinkoFactory({parentEnv: deps.parentEnv});
	const find = deps.find ?? findExecutable;

	cli.command('doctor', {
		description:
			'Report what this machine can do: PICO-8 (found, runs headless, version), shrinko8, the display a PICO-8 -run session would use (native / virtual Xvfb / none), and which picopilot commands are therefore available. Call this first on a new machine.',
		env: PICO8_ENV,
		output: z.object({
			pico8: z.object({
				found: z.boolean().describe('Whether the PICO-8 binary was found.'),
				path: z.string().optional().describe('The resolved binary path.'),
				runs: z
					.boolean()
					.describe('Whether a headless -x probe run actually worked.'),
				version: z
					.string()
					.optional()
					.describe('The PICO-8 version, when its install path names it.'),
				versionId: z
					.number()
					.optional()
					.describe("PICO-8's internal version number (stat(5))."),
			}),
			shrinko8: z.object({
				found: z
					.boolean()
					.describe('Whether shrinko8 ran (token count on a probe cart).'),
			}),
			display: z.object({
				mode: z
					.enum(DISPLAY_MODES)
					.describe('The resolved display mode (--display / env / config).'),
				native: z
					.boolean()
					.describe('Whether DISPLAY or WAYLAND_DISPLAY is set.'),
				virtual: z
					.enum(['Xvfb', 'xvfb-run'])
					.optional()
					.describe('The virtual-display backend available, if any.'),
				runSessions: z
					.enum(['native', 'xvfb', 'none'])
					.describe(
						'How a PICO-8 -run session (audio record/render, run --record-audio) gets a display here.',
					),
			}),
			available: z
				.array(z.string())
				.describe('Commands that work on this machine.'),
			unavailable: z
				.array(
					z.object({
						command: z.string(),
						missing: z.array(z.string()),
					}),
				)
				.describe('Commands that do not, and what they are missing.'),
		}),
		async run({env, ok, var: vars}) {
			const display: DisplayMode = displayModeOf(vars);
			const childEnv = pico8ChildEnv(
				env as Record<string, string | undefined>,
				deps.parentEnv ?? process.env,
			);

			// --- PICO-8: locate, then a real headless probe for the version.
			const [pico8File] = pico8Candidates(childEnv) as [string, ...string[]];
			const pico8Path = find(pico8File, childEnv);
			let runs = false;
			let versionId: number | undefined;
			let version: string | undefined;
			const probeDir = mkdtempSync(join(tmpdir(), 'picopilot-doctor-'));
			try {
				const cartPath = join(probeDir, 'probe.p8');
				writeFileSync(cartPath, PROBE_CART);
				const result = await pico8Factory(env as NodeJS.ProcessEnv, {
					display,
				}).run({
					cartPath,
					shotDir: probeDir,
					sentinel: PROBE_SENTINEL,
					backstopMs: PROBE_BACKSTOP_MS,
				});
				if (result.ok) {
					const m = new RegExp(`${VERSION_MARKER}(\\d+)`).exec(
						result.value.printh,
					);
					if (m !== null) {
						runs = true;
						versionId = Number(m[1]);
					}
				}
			} finally {
				rmSync(probeDir, {recursive: true, force: true});
			}
			if (pico8Path !== undefined) {
				let real = pico8Path;
				try {
					real = realpathSync(pico8Path);
				} catch {
					// keep the unresolved path
				}
				version = versionFromPath(real) ?? versionFromPath(pico8Path);
			}
			const pico8Found = pico8Path !== undefined || runs;

			// --- shrinko8: a real --count on a tiny cart.
			let shrinkoFound = false;
			const shrinkoDir = mkdtempSync(join(tmpdir(), 'picopilot-doctor-'));
			try {
				const cartPath = join(shrinkoDir, 'probe.p8');
				writeFileSync(cartPath, SHRINKO_PROBE_CART);
				try {
					const count = await shrinkoFactory(env as NodeJS.ProcessEnv).count(
						cartPath,
					);
					shrinkoFound = count.ok;
				} catch {
					// ran but did not parse: present, yet not usable for us
					shrinkoFound = false;
				}
			} finally {
				rmSync(shrinkoDir, {recursive: true, force: true});
			}

			// --- display: how a -run session would get one here.
			const native = hasNativeDisplay(childEnv);
			const virtual: VirtualDisplayBackend | undefined =
				detectVirtualDisplayBackend(childEnv, find);
			const runSessions: RunSessionDisplay = needsVirtualDisplay(
				display,
				childEnv,
			)
				? virtual !== undefined
					? 'xvfb'
					: 'none'
				: native
					? 'native'
					: 'none';

			const have: Record<Need, boolean> = {
				pico8: runs,
				shrinko8: shrinkoFound,
				display: runSessions !== 'none',
			};
			const available: string[] = [];
			const unavailable: {command: string; missing: string[]}[] = [];
			for (const {command, needs} of COMMAND_NEEDS) {
				const missing = needs.filter((n) => !have[n]);
				if (missing.length === 0) available.push(command);
				else unavailable.push({command, missing});
			}

			return ok({
				pico8: {
					found: pico8Found,
					...(pico8Path !== undefined ? {path: pico8Path} : {}),
					runs,
					...(version !== undefined ? {version} : {}),
					...(versionId !== undefined ? {versionId} : {}),
				},
				shrinko8: {found: shrinkoFound},
				display: {
					mode: display,
					native,
					...(virtual !== undefined ? {virtual} : {}),
					runSessions,
				},
				available,
				unavailable,
			});
		},
	});
}
