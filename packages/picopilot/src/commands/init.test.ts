import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli, z} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Cart} from '../engine/cart/index.js';
import {readAllowMapOverlap} from '../engine/config/index.js';
import type {
	InstallSkillsOptions,
	InstallSkillsResult,
} from '../engine/skills/index.js';
import {createCli} from '../cli.js';
import {type SkillsInstaller, registerInit} from './init.js';

/**
 * Drives `picopilot init <dir>` through incur's `serve` DI, capturing stdout and
 * the exit code without touching the real process env. The command writes only
 * inside `dir` (a temp dir here), so this exercises the real scaffold I/O in
 * isolation.
 */
async function runInit(argv: string[]) {
	let stdout = '';
	let exitCode = 0;
	await createCli().serve(argv, {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		// An EMPTY env: proves init needs nothing from the environment and, with a
		// real command, that no shared-dir env (HOME/skills) is consulted.
		env: {},
	});
	return {stdout, exitCode};
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-init-'));
});

afterEach(() => {
	// Best-effort cleanup; a leftover temp dir must never fail the suite.
	try {
		execFileSync('rm', ['-rf', dir]);
	} catch {
		// ignore
	}
});

describe('picopilot init: scaffold output', () => {
	it('writes EXACTLY the four scaffold files, nothing else', async () => {
		const {exitCode} = await runInit(['init', dir]);
		expect(exitCode).toBe(0);
		expect(readdirSync(dir).sort()).toEqual(
			['AGENTS.md', 'main.lua', 'main.p8', 'picopilot.json'].sort(),
		);
	});

	it('reports the written files and the absolute dir', async () => {
		const {stdout} = await runInit(['init', dir]);
		expect(stdout).toContain('main.p8');
		expect(stdout).toContain('main.lua');
		expect(stdout).toContain('AGENTS.md');
		expect(stdout).toContain('picopilot.json');
		expect(stdout).toContain(dir);
	});

	it('main.p8 is a valid cart whose only code is `#include main.lua`', async () => {
		await runInit(['init', dir]);
		const text = readFileSync(join(dir, 'main.p8'), 'utf8');
		const cart = Cart.parse(text);
		// Round-trips through the cart model (identity).
		expect(cart.serialize()).toBe(text);
		// __lua__ holds exactly the include line and nothing else.
		expect(cart.getSection('lua')?.trim()).toBe('#include main.lua');
		// No hand-written binary sections in a fresh cart.
		expect(cart.hasSection('gfx')).toBe(false);
		expect(cart.hasSection('map')).toBe(false);
	});

	it('main.lua is the plain-Lua edit surface with the _init/_update/_draw loop', async () => {
		await runInit(['init', dir]);
		const lua = readFileSync(join(dir, 'main.lua'), 'utf8');
		expect(lua).toContain('function _init()');
		expect(lua).toContain('function _update()');
		expect(lua).toContain('function _draw()');
		// main.lua must NOT be a .p8 (no cart header / section markers).
		expect(lua).not.toContain('pico-8 cartridge');
		expect(lua).not.toContain('__lua__');
	});
});

describe('picopilot init: AGENTS.md carries the curated PICO-8 reference', () => {
	let agents: string;

	beforeEach(async () => {
		await runInit(['init', dir]);
		agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
	});

	it('carries the execution loop', () => {
		expect(agents).toContain('_init()');
		expect(agents).toContain('_update()');
		expect(agents).toContain('_draw()');
	});

	it('carries the build loop with a MANDATORY see-it-run step (not just static verify)', () => {
		// The loop names verify AND run/playtest, and is explicit that a green
		// static gate is not "done": the weak-model failure was shipping on verify.
		expect(agents).toContain('picopilot verify');
		expect(agents).toContain('picopilot run');
		expect(agents).toContain('picopilot playtest run');
		expect(agents.toLowerCase()).toContain('definition of done');
		// It hands the model the concrete probe recipe so "see it" is actionable.
		expect(agents).toContain('extcmd("screen")');
		expect(agents).toContain('__PICOPILOT_DONE__');
		// A bare timeout is explicitly NOT proof it works.
		expect(agents.toLowerCase()).toContain('timeout');
		// Done means BEHAVIOUR verified, not just a rendered frame: drive the core
		// loop and confirm state transitions (the bugs a screenshot hides).
		const lower = agents.toLowerCase();
		expect(lower).toContain('state');
		expect(lower).toMatch(/behave|behaviour|behavior/);
		// GENERIC, not a fixed mechanic checklist: it must tell the agent to
		// enumerate ITS OWN game's transitions, so it neither assumes mechanics the
		// game lacks nor checks only a canned list and misses the rest.
		expect(lower).toContain('enumerate');
		expect(lower).toMatch(/your (specific )?game/);
		expect(lower).toContain('do not check a fixed checklist');
		// Two named checks: distinct-outcome correctness (sign of the effect) and
		// is-it-a-game / can-the-player-lose (the too-easy check), both generic.
		expect(lower).toContain('distinct');
		expect(lower).toMatch(/sign|direction/);
		expect(lower).toMatch(/can the player lose|player.*(lose|fail)/);
		expect(lower).toContain('too easy');
	});

	it('warns against guessing the API and points at the shipped pico8-api reference', () => {
		const lower = agents.toLowerCase();
		expect(lower).toContain('do not guess');
		expect(agents).toContain('reference/pico8-api.md');
		// Names the exact traps from the observed run: rnd-not-rand, no collision.
		expect(agents).toContain('rnd(x)');
		expect(agents).toContain('rand');
		expect(agents.toLowerCase()).toContain('no built-in collision');
	});

	it('hands the finished cart off via `pico8 -run`, NOT `serve`', () => {
		// The user runs the cart with pico8 -run; serve is not the self-verify path.
		expect(agents).toContain('pico8 -run');
		// serve is called out as sharing-only (browser build), not proof-of-build.
		expect(agents).toContain('picopilot serve');
		expect(agents.toLowerCase()).toContain('do not emit extra deliverables');
	});

	it('carries the fixed 16-colour palette with real RGB values', () => {
		// A palette entry the gfx render encoder depends on (red = 255,0,77).
		expect(agents).toMatch(/red/);
		expect(agents).toContain('255');
		expect(agents).toContain('77');
		// The transparent/index legend.
		expect(agents).toMatch(/`\.`\s*=\s*transparent/);
	});

	it('carries the memory map AND the gfx/map overlap warning', () => {
		expect(agents).toContain('0x1000');
		expect(agents).toContain('0x6000');
		expect(agents.toLowerCase()).toContain('overlap');
		expect(agents).toContain('128..255');
		expect(agents).toMatch(/__map__` rows 32\.\.63/);
	});

	it('carries the most-used, grouped API', () => {
		expect(agents).toContain('spr(');
		expect(agents).toContain('btn(');
		expect(agents).toContain('sfx(');
		expect(agents).toContain('printh');
	});

	it('carries the silent-gotcha section (turns-not-radians, integer divide, draw-state persists)', () => {
		// sin/cos take turns and sin is inverted (the #1 math trap).
		expect(agents).toContain('TURNS');
		expect(agents.toLowerCase()).toContain('inverted');
		// Integer divide is backslash, not `/`.
		expect(agents).toContain('5\\2');
		// Draw state persists across frames.
		expect(agents.toLowerCase()).toContain('persists');
		// del-by-value vs deli-by-index.
		expect(agents).toContain('deli(');
		// Points the agent at the code skill's genre references.
		expect(agents).toContain('picopilot-code');
	});

	it('carries the token discipline (8192 budget + shorthands)', () => {
		expect(agents).toContain('8192');
		expect(agents).toContain('picopilot tokens');
		expect(agents).toContain('picopilot minify');
		// A PICO-8 shorthand the reference teaches.
		expect(agents).toContain('+=');
	});

	it('carries the `#include` discipline (edit main.lua, not the binary sections)', () => {
		expect(agents).toContain('#include main.lua');
		expect(agents).toContain('main.lua');
	});
});

describe('picopilot init: INSTRUCT, not mutate (no VCS, prints tips)', () => {
	it('does NOT run git init: no .git in the scaffolded folder', async () => {
		await runInit(['init', dir]);
		expect(existsSync(join(dir, '.git'))).toBe(false);
	});

	it('PRINTS a skills-discovery tip and a git init tip', async () => {
		const {stdout} = await runInit(['init', dir]);
		expect(stdout.toLowerCase()).toContain('skills');
		expect(stdout).toContain('--install-skills');
		expect(stdout).toContain('git init');
	});
});

describe('picopilot init: shared-write isolation (default has no shared write)', () => {
	it('writes NOTHING outside the target folder', async () => {
		// Sentinels OUTSIDE the cart dir: a sibling temp dir standing in for the
		// real home / a shared config location. Default `init` must not touch them.
		const outside = mkdtempSync(join(tmpdir(), 'picopilot-outside-'));
		const sentinel = join(outside, 'DO-NOT-TOUCH');
		writeFileSync(sentinel, 'untouched');
		const beforeOutside = readdirSync(outside).sort();

		try {
			await runInit(['init', dir]);
			// The sentinel folder is byte-for-byte the same (no new files, sentinel intact).
			expect(readdirSync(outside).sort()).toEqual(beforeOutside);
			expect(readFileSync(sentinel, 'utf8')).toBe('untouched');
			// And the only new entries are inside the cart dir.
			expect(readdirSync(dir).sort()).toEqual(
				['AGENTS.md', 'main.lua', 'main.p8', 'picopilot.json'].sort(),
			);
		} finally {
			execFileSync('rm', ['-rf', outside]);
		}
	});

	it('refuses to overwrite an existing scaffold file (nonzero exit, no clobber)', async () => {
		const existing = join(dir, 'main.lua');
		writeFileSync(existing, 'MY WORK, do not clobber');
		const {exitCode} = await runInit(['init', dir]);
		expect(exitCode).not.toBe(0);
		// The pre-existing file is untouched.
		expect(readFileSync(existing, 'utf8')).toBe('MY WORK, do not clobber');
	});

	it('DEFAULT init calls NO installer (the shared write is opt-in only)', async () => {
		// The regression guard for the isolation scoping: the shared-write path must
		// be reachable ONLY via --install-skills. A default `init` must never invoke
		// the installer, so a spy installer that fails the test if called proves it.
		let called = false;
		const spy: SkillsInstaller = async () => {
			called = true;
			return {paths: [], agents: [], skills: []};
		};
		const {exitCode} = await runInitWith(['init', dir], spy);
		expect(exitCode).toBe(0);
		expect(called).toBe(false);
	});
});

/**
 * Builds a picopilot-shaped CLI whose `init` uses an INJECTED installer, then
 * drives it through incur's `serve` DI. This is how the --install-skills tests
 * exercise the opt-in shared write without ever performing a real global
 * install: the injected installer redirects the target (or records the call).
 */
async function runInitWith(argv: string[], installer: SkillsInstaller) {
	const cli = Cli.create('picopilot', {version: '0.0.0', description: 'test'});
	registerInit(cli, installer);
	let stdout = '';
	let exitCode = 0;
	await cli.serve(argv, {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		env: {},
	});
	return {stdout, exitCode};
}

describe('picopilot init --install-skills: the opt-in shared write', () => {
	it('runs the installer and reports the installed skills + wired agents', async () => {
		const calls: InstallSkillsOptions[] = [];
		const installer: SkillsInstaller = async (
			opts,
		): Promise<InstallSkillsResult> => {
			calls.push(opts);
			return {
				paths: [join(dir, '.agents', 'skills', 'picopilot-overview')],
				agents: [
					{
						agent: 'Claude Code',
						path: join(dir, '.claude', 'skills'),
						mode: 'symlink',
					},
				],
				skills: ['picopilot-overview', 'picopilot-art'],
			};
		};

		const {stdout, exitCode} = await runInitWith(
			['init', dir, '--install-skills', '--json'],
			installer,
		);
		expect(exitCode).toBe(0);
		// The installer WAS invoked (default is a GLOBAL install, so global=true).
		expect(calls).toHaveLength(1);
		expect(calls[0]?.global).toBe(true);

		const out = JSON.parse(stdout) as {
			installedSkills?: string[];
			wiredAgents?: string[];
			tips: string[];
		};
		expect(out.installedSkills).toEqual([
			'picopilot-overview',
			'picopilot-art',
		]);
		expect(out.wiredAgents).toEqual(['Claude Code']);
		// The scaffold still happened alongside the install.
		expect(readdirSync(dir).sort()).toEqual(
			['AGENTS.md', 'main.lua', 'main.p8', 'picopilot.json'].sort(),
		);
	});

	it('DEDUPES wiredAgents (incur returns one entry per skill x agent)', async () => {
		// incur's install.agents has one entry per (skill, agent) symlink, so a
		// multi-skill install repeats each agent name (see
		// work/notes/observations/incur-install-agents-duplicated-per-skill.md).
		// wiredAgents is the SET of agent names, so it must collapse duplicates.
		const installer: SkillsInstaller = async () => ({
			paths: [
				join(dir, '.agents', 'skills', 'picopilot-overview'),
				join(dir, '.agents', 'skills', 'picopilot-code'),
			],
			// Two skills x two agents = four entries, agent names repeated.
			agents: [
				{agent: 'Claude Code', path: join(dir, 'a1'), mode: 'symlink'},
				{agent: 'Kilo', path: join(dir, 'a2'), mode: 'symlink'},
				{agent: 'Claude Code', path: join(dir, 'a3'), mode: 'symlink'},
				{agent: 'Kilo', path: join(dir, 'a4'), mode: 'symlink'},
			],
			skills: ['picopilot-overview', 'picopilot-code'],
		});
		const {stdout, exitCode} = await runInitWith(
			['init', dir, '--install-skills', '--json'],
			installer,
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout) as {wiredAgents?: string[]};
		// Deduped to the unique set, order preserved.
		expect(out.wiredAgents).toEqual(['Claude Code', 'Kilo']);
	});

	it('--no-global redirects the install into THIS project folder (the temp cart dir)', async () => {
		const calls: InstallSkillsOptions[] = [];
		const installer: SkillsInstaller = async (opts) => {
			calls.push(opts);
			return {paths: [], agents: [], skills: ['picopilot-overview']};
		};
		const {exitCode} = await runInitWith(
			['init', dir, '--install-skills', '--no-global'],
			installer,
		);
		expect(exitCode).toBe(0);
		// --no-global → project install; cwd is the scaffolded cart folder, so a
		// project install can never escape to a shared dir.
		expect(calls[0]?.global).toBe(false);
		expect(calls[0]?.cwd).toBe(dir);
	});

	it('prints the manual/symlink FALLBACK when no agent was wired', async () => {
		const installer: SkillsInstaller = async () => ({
			paths: [join(dir, '.agents', 'skills', 'picopilot-overview')],
			agents: [],
			skills: ['picopilot-overview'],
		});
		const {stdout, exitCode} = await runInitWith(
			['init', dir, '--install-skills'],
			installer,
		);
		expect(exitCode).toBe(0);
		// No known agent detected → tell the user how to wire it manually (symlink),
		// the printed-instructions fallback for unsupported agents.
		expect(stdout.toLowerCase()).toContain('symlink');
	});

	it('surfaces a STRUCTURED failure (nonzero) when the install fails, not a crash', async () => {
		const installer: SkillsInstaller = async () => {
			throw new Error('boom from incur');
		};
		const {stdout, exitCode} = await runInitWith(
			['init', dir, '--install-skills'],
			installer,
		);
		expect(exitCode).not.toBe(0);
		// The scaffold still succeeded and the message points at the manual path.
		expect(readdirSync(dir)).toContain('main.p8');
		expect(stdout.toLowerCase()).toMatch(/skills add|symlink/);
	});
});

describe('picopilot.json: schema shape + incur config read (argv > config > default)', () => {
	it('scaffolds a valid picopilot.json carrying allowMapOverlap = false', async () => {
		await runInit(['init', dir]);
		const raw = readFileSync(join(dir, 'picopilot.json'), 'utf8');
		const parsed = JSON.parse(raw);
		// The gfx/map-overlap authorisation key lives where incur's config layer
		// reads a `gfx set` option default.
		expect(parsed.commands.gfx.commands.set.options.allowMapOverlap).toBe(
			false,
		);
		// The reader helper agrees.
		expect(readAllowMapOverlap(parsed)).toBe(false);
	});

	it('feeds incur config → option default (config overrides zod default)', async () => {
		await runInit(['init', dir]);
		// Hand-set the config to true, mirroring an agent authorising overlap.
		const cfgPath = join(dir, 'picopilot.json');
		const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
		cfg.commands.gfx.commands.set.options.allowMapOverlap = true;
		writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

		const seen = await readOverlapViaIncur(cfgPath);
		// zod default is false; the config file wins.
		expect(seen).toBe(true);
	});

	it('argv beats config (argv > config)', async () => {
		await runInit(['init', dir]);
		// Scaffolded config is false; --no-allow-map-overlap-style not needed:
		// pass the flag true on argv while config stays false, argv must win... and
		// the reverse: config true, flag false.
		const cfgPath = join(dir, 'picopilot.json');
		const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
		cfg.commands.gfx.commands.set.options.allowMapOverlap = true;
		writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

		// config = true, but argv explicitly disables -> argv wins (false).
		const seen = await readOverlapViaIncur(cfgPath, ['--no-allowMapOverlap']);
		expect(seen).toBe(false);
	});
});

/**
 * Builds a throwaway CLI whose only command mirrors how `gfx set` will read
 * `allowMapOverlap`: a boolean option defaulting to false, resolved through
 * incur's config layer against the scaffolded `picopilot.json`. Proves the
 * scaffolded file's SHAPE actually drives incur's `argv > config > default`
 * precedence, not just that a helper can parse it.
 */
async function readOverlapViaIncur(
	configPath: string,
	extraArgv: string[] = [],
): Promise<boolean> {
	const cli = Cli.create('picopilot', {
		version: '0.0.0',
		config: {flag: 'config', files: ['picopilot.json']},
	});
	// Mount `gfx set` so its config path is commands.gfx.commands.set.options.
	const gfx = Cli.create('gfx');
	gfx.command('set', {
		description: 'test stand-in for the real gfx set',
		options: z.object({
			allowMapOverlap: z.boolean().default(false),
		}),
		output: z.object({allowMapOverlap: z.boolean()}),
		run({options}) {
			return {allowMapOverlap: options.allowMapOverlap};
		},
	});
	cli.command(gfx as never);

	let stdout = '';
	await cli.serve(
		['gfx', 'set', '--config', configPath, ...extraArgv, '--json'],
		{
			stdout(s) {
				stdout += s;
			},
			exit() {},
			env: {},
		},
	);
	const parsed = JSON.parse(stdout) as {allowMapOverlap: boolean};
	return parsed.allowMapOverlap;
}
