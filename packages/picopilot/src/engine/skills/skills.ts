import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Cli, SyncSkills} from 'incur';

/**
 * The engine behind `picopilot init --install-skills`: the ONE picopilot path
 * that writes to a SHARED/GLOBAL location. incur's `skills add` defaults to a
 * GLOBAL install (into `~/.agents/skills` plus symlinks into detected agent
 * dirs like `~/.claude/skills`), so this module is where the work-contract's
 * shared-write isolation obligation is discharged: every knob that decides the
 * install TARGET (`global`, `cwd`) is a parameter a test can redirect to a temp
 * dir, so installing skills can never pollute the real environment in tests.
 *
 * The install runs IN-PROCESS through incur's `SyncSkills.sync`. NOTE (incur
 * 0.4.10): `SyncSkills.sync` / the `skills add` built-in resolve their target
 * from `os.homedir()` and `process.env` captured AT MODULE LOAD, NOT from the
 * `env` DI you can pass to `cli.serve(argv, { env })`, so overriding the serve
 * env does NOT move the install target. The effective in-process lever is
 * `global: false` + `cwd: <temp dir>`, which installs under `<cwd>/.agents/skills`
 * (and `<cwd>/.claude/skills` etc.) and leaves the real dirs byte-untouched.
 */

/**
 * The five picopilot discipline skills (US #20), authored as SKILL.md files
 * under {@link skillsSourceDir}. They load on-demand by concern and carry the
 * hard-won workflow knowledge (the `#include` discipline, the token breakdown,
 * the `gfx render`→look→`gfx set`→fix loop incl. the non-multimodal fallback,
 * composing in picopilot-MML) so an agent gets it without bloating every turn.
 *
 * They ship ALONGSIDE the per-command skills incur auto-generates from the
 * command surface (`sync: { depth: 1 }`), pulled in via an `include` glob; the
 * command surface is still growing, so the named discipline skills are authored
 * rather than tied to a command-group shape that does not exist yet.
 */
export const SKILL_NAMES = [
	'picopilot-overview',
	'picopilot-code',
	'picopilot-art',
	'picopilot-audio',
	'picopilot-debug',
] as const;

/**
 * Resolves the on-disk directory that holds the authored `picopilot-*` SKILL.md
 * files (`<packageRoot>/src/skills`). The files ship in the npm package (the
 * package `files` includes `src`), so the same path works from the built
 * `dist/` runtime and from `src/` under tsx: we walk up from THIS module to the
 * package root (the nearest ancestor with a `package.json`) and join `src/skills`,
 * rather than a `dist`-relative path that would not exist (SKILL.md is not
 * compiled).
 */
export function skillsSourceDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	const seen = new Set<string>();
	while (!seen.has(dir)) {
		seen.add(dir);
		if (existsSync(join(dir, 'package.json'))) {
			return join(dir, 'src', 'skills');
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// Fallback: two levels up from src/engine/skills is the package root.
	return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
}

/** One agent whose skill dir picopilot's install wired up (from incur's result). */
export interface WiredAgent {
	readonly agent: string;
	readonly path: string;
	readonly mode: string;
}

/** The outcome of installing picopilot's skills. */
export interface InstallSkillsResult {
	/** Canonical install paths (one per skill, under `<base>/.agents/skills`). */
	readonly paths: string[];
	/** Non-universal agents whose dirs were symlinked/copied to the canonical skills. */
	readonly agents: WiredAgent[];
	/** The skill names that were installed. */
	readonly skills: string[];
}

/** Options controlling WHERE and HOW picopilot's skills are installed. */
export interface InstallSkillsOptions {
	/**
	 * The picopilot CLI whose command surface the per-command skills are generated
	 * from. Its command map (via {@link Cli.toCommands}) is handed to incur.
	 */
	readonly cli: Cli.Cli;
	/**
	 * Install globally (the real default, into `~/.agents/skills` + detected agent
	 * dirs) when true; install project-locally (into `<cwd>/.agents/skills`) when
	 * false. This is the shared-write isolation lever: tests pass `false`.
	 */
	readonly global: boolean;
	/**
	 * The install base for a project-local (`global: false`) install and, when a
	 * non-universal agent is detected, the base its symlinks are written under.
	 * Ignored for a global install (that goes to the real home). Tests point this
	 * at a temp dir.
	 */
	readonly cwd?: string;
	/**
	 * Override the authored-skills source dir. Defaults to {@link skillsSourceDir}.
	 * Exists so a test can prove isolation using its own fixture skills.
	 */
	readonly sourceDir?: string;
}

/**
 * Installs picopilot's skills (the authored `picopilot-*` discipline skills plus
 * the per-command skills incur generates from the CLI) via incur's
 * `SyncSkills.sync`. This is the real work `init --install-skills` performs.
 *
 * The authored skills are pulled in with an ABSOLUTE `include` glob into
 * {@link skillsSourceDir}, DECOUPLED from `cwd` on purpose: `cwd` selects the
 * install TARGET, the include glob selects the skills SOURCE. That decoupling is
 * what lets a test install to a temp `cwd` while still reading the real authored
 * skills (or its own fixtures), the crux of the isolation contract.
 */
export async function installSkills(
	options: InstallSkillsOptions,
): Promise<InstallSkillsResult> {
	const commands = Cli.toCommands.get(options.cli);
	if (commands === undefined) {
		throw new Error(
			'installSkills: the given CLI has no command map (was it built by Cli.create?)',
		);
	}

	const source = options.sourceDir ?? skillsSourceDir();

	const result = await SyncSkills.sync('picopilot', commands, {
		depth: 1,
		description: 'An agent-first toolchain for PICO-8 game development.',
		global: options.global,
		cwd: options.cwd,
		// Absolute glob → resolves against `source`, independent of `cwd`.
		include: [join(source, '*')],
	});

	return {
		paths: result.paths,
		agents: result.agents.map((a) => ({
			agent: a.agent,
			path: a.path,
			mode: a.mode,
		})),
		skills: result.skills.map((s) => s.name),
	};
}
