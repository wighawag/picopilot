import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createCli} from '../../cli.js';
import {installSkills, SKILL_NAMES, skillsSourceDir} from './index.js';

/**
 * Reads an authored skill's SKILL.md straight from the on-disk source dir, the
 * same files incur's `include` glob ships. Skill GENERATION output is these
 * files, so the generation tests assert against them directly.
 */
function readSkill(name: string): string {
	return readFileSync(join(skillsSourceDir(), name, 'SKILL.md'), 'utf8');
}

describe('picopilot skills: generation output (the authored discipline skills)', () => {
	it('ships exactly the named authored skills, each with valid frontmatter', () => {
		expect([...SKILL_NAMES].sort()).toEqual(
			[
				'picopilot-art',
				'picopilot-audio',
				'picopilot-code',
				'picopilot-debug',
				'picopilot-overview',
				'game-design-reference',
				'game-jam',
			].sort(),
		);
		for (const name of SKILL_NAMES) {
			const md = readSkill(name);
			// incur discovers a skill by its `name:` frontmatter line; a `description:`
			// is what makes it load on-demand. Both must be present and match.
			expect(md).toMatch(new RegExp(`^name:\\s*${name}$`, 'm'));
			expect(md).toMatch(/^description:\s*.+/m);
		}
	});

	it('game-design-reference is a USER-INVOKED reference body (no per-turn context load)', () => {
		const md = readSkill('game-design-reference');
		// The invocation stance: only game-design-reference disables model
		// invocation, so it is reached by pointer (from game-jam), never fired on a
		// vague trigger, and costs no context every turn. game-jam stays
		// model-invoked (no such line).
		expect(md).toMatch(/^disable-model-invocation:\s*true$/m);
		expect(readSkill('game-jam')).not.toMatch(/^disable-model-invocation:/m);
	});

	it('game-design-reference carries the universal principles + method-not-menu originality', () => {
		const md = readSkill('game-design-reference');
		// Fairness: BOTH reachability AND the skipped hazard-avoidability check.
		expect(md.toLowerCase()).toContain('reachability');
		expect(md.toLowerCase()).toContain('avoidability');
		// Human reaction budget in PICO-8's 30fps terms.
		expect(md).toContain('200-300ms');
		expect(md).toContain('frame-perfect');
		// Visibility (draw what you spr()).
		expect(md).toContain('spr(');
		// Originality is a METHOD with a self-check, and lists NO concrete
		// mechanics (the answer-menu trap). Assert the caveat that guards it.
		expect(md.toLowerCase()).toContain('self-check');
		expect(md.toLowerCase()).toMatch(/no (example |concrete )?mechanic/);
	});

	it('game-jam carries the clock discipline and POINTS AT game-design-reference (does not re-teach it)', () => {
		const md = readSkill('game-jam');
		// Composition: it points at the reference body by name.
		expect(md).toContain('game-design-reference');
		// REGRESSION GUARD (see the FLIPRUN observation + re-grill): a
		// disable-model-invocation reference skill is NOT auto-loaded by pi, so a
		// bare-name "read and apply X" pointer gets SKIPPED (the agent never opens
		// the file). The reliable pattern (Matt's, verified on pi + Claude Code) is
		// an EXPLICIT relative path resolved against THIS skill's dir + an
		// imperative to read/load it. Assert the pointer has both, so it never
		// regresses to the weak wording that made the reference body unreachable.
		expect(md).toContain('../game-design-reference/SKILL.md');
		expect(md.toLowerCase()).toMatch(/\b(read|load)\b/);
		// And game-design-reference stays user-invoked (the reason the explicit
		// pointer is REQUIRED): if someone flips it to model-invoked, this pairing
		// assumption changes and the pointer guard should be revisited.
		expect(readSkill('game-design-reference')).toMatch(
			/^disable-model-invocation:\s*true$/m,
		);
		// The jam-specific clock discipline (the slice/deepen/triage phases).
		expect(md.toLowerCase()).toContain('playable slice');
		expect(md.toLowerCase()).toContain('triage');
		// The situated design calls the clock forces (jam-specific, live nowhere
		// else): the dead state and the frame-perfect superhuman level.
		expect(md.toLowerCase()).toContain('dead state');
		expect(md).toContain('frame-perfect');
		// It interprets the theme itself (decision B) and ships JAM.md.
		expect(md).toContain('JAM.md');
	});

	it('picopilot-overview carries the #include discipline', () => {
		const md = readSkill('picopilot-overview');
		expect(md).toContain('#include main.lua');
		expect(md).toContain('main.lua');
		// Edit the Lua, never the binary sections (allow line wrapping between words).
		expect(md).toMatch(/never\s+hand-write/i);
		expect(md).toContain('__gfx__');
	});

	it('picopilot-code carries the token-breakdown discipline', () => {
		const md = readSkill('picopilot-code');
		expect(md).toContain('8,192');
		expect(md).toContain('picopilot tokens');
		expect(md).toContain('picopilot minify');
		// A PICO-8 shorthand the skill teaches for reclaiming budget.
		expect(md).toContain('+=');
	});

	it('picopilot-art carries the render→look→set→render loop AND the non-multimodal fallback', () => {
		const md = readSkill('picopilot-art');
		// The art loop.
		expect(md).toContain('gfx render');
		expect(md).toContain('gfx set');
		expect(md).toContain('gfx show');
		// The load-bearing non-multimodal fallback: view the PNG if you can read
		// images, else reason over the grid.
		expect(md.toLowerCase()).toContain('cannot read images');
		expect(md.toLowerCase()).toMatch(/reason(ing)?\s+over the[\s\S]*grid/i);
		// The gfx/map overlap smart-refuse discipline.
		expect(md.toLowerCase()).toContain('overlap');
		expect(md).toContain('allowMapOverlap');
	});

	it('picopilot-audio carries the picopilot-MML authoring model + the honest record-based render framing', () => {
		const md = readSkill('picopilot-audio');
		expect(md).toContain('picopilot-MML');
		// ABC is explicitly NOT used.
		expect(md).toContain('ABC');
		// Music is assembled structurally from SFX references.
		expect(md.toLowerCase()).toContain('structural');
		// Honest scoping (ADR-0009): audio-to-WAV is a RECORDING, NOT an offline
		// export, and needs a real audio session (a developer machine).
		expect(md.toLowerCase()).toContain('recording');
		expect(md.toLowerCase()).toContain('offline export');
	});

	it('picopilot-debug carries the static-gate + run loop and the dependency boundaries', () => {
		const md = readSkill('picopilot-debug');
		expect(md).toContain('picopilot verify');
		expect(md).toContain('picopilot run');
		expect(md).toContain('printh');
		expect(md).toContain('gate-incapable');
		expect(md).toContain('pico8-not-found');
		expect(md).toContain('shrinko-not-found');
	});
});

/**
 * Recursively snapshots a directory tree as a sorted list of `relpath:mtimeMs`
 * for files and `relpath/` for dirs, so a before/after comparison catches ANY
 * new/removed entry AND any modified file. Returns `['<absent>']` when the dir
 * does not exist (so "absent stays absent" is also asserted).
 */
function snapshot(root: string): string[] {
	if (!existsSync(root)) return ['<absent>'];
	const out: string[] = [];
	const walk = (dir: string, rel: string) => {
		for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			const relPath = rel ? `${rel}/${entry.name}` : entry.name;
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				out.push(`${relPath}/`);
				walk(abs, relPath);
			} else {
				// lstat, not stat: never follow a symlink out of the snapshotted tree.
				out.push(
					`${relPath}:${statSync(abs, {throwIfNoEntry: false})?.mtimeMs ?? 'gone'}`,
				);
			}
		}
	};
	walk(root, '');
	return out;
}

/**
 * The REAL agent skill dirs this test must prove are byte-untouched. incur
 * installs canonically to `~/.agents/skills` and symlinks detected non-universal
 * agents (e.g. `~/.claude/skills`), so those are the dirs the isolation contract
 * guards. Resolved from the real `homedir()` (which is what incur reads).
 */
const REAL_DIRS = [
	join(homedir(), '.agents', 'skills'),
	join(homedir(), '.claude', 'skills'),
	join(homedir(), '.codex', 'skills'),
	join(homedir(), '.cursor', 'skills'),
];

describe('picopilot skills: isolated --install-skills (the load-bearing shared-write test)', () => {
	let target: string;
	let before: Map<string, string[]>;

	beforeEach(() => {
		target = mkdtempSync(join(tmpdir(), 'picopilot-skills-install-'));
		// Snapshot the REAL dirs before the install so we can prove they never moved.
		before = new Map(REAL_DIRS.map((d) => [d, snapshot(d)]));
	});

	afterEach(() => {
		try {
			execFileSync('rm', ['-rf', target]);
		} catch {
			// ignore
		}
	});

	it('installs into the redirected temp target, NOT a real dir', async () => {
		// The lever: global=false + cwd=temp installs under <cwd>/.agents/skills.
		const result = await installSkills({
			cli: createCli(),
			global: false,
			cwd: target,
		});

		// Every named discipline skill landed (plus the per-command skills).
		for (const name of SKILL_NAMES) {
			expect(result.skills).toContain(name);
			expect(
				existsSync(join(target, '.agents', 'skills', name, 'SKILL.md')),
			).toBe(true);
		}
		// Every reported canonical path is INSIDE the temp target.
		for (const p of result.paths) {
			expect(p.startsWith(target)).toBe(true);
		}
		// Any wired non-universal agent dir is also inside the temp target, never a
		// real home dir (the symlinks go under cwd for a project install).
		for (const a of result.agents) {
			expect(a.path.startsWith(target)).toBe(true);
		}
	});

	it('leaves the REAL agent skill dirs BYTE-UNTOUCHED', async () => {
		await installSkills({cli: createCli(), global: false, cwd: target});

		// The real dirs are identical before and after: no new entry, nothing
		// modified, and an absent dir stays absent. This is the pollution guard.
		for (const dir of REAL_DIRS) {
			expect(snapshot(dir)).toEqual(before.get(dir));
		}
	});

	it('a custom sourceDir proves the source is decoupled from the install target', async () => {
		// Point the include SOURCE at a fixture with a single skill; install TARGET
		// stays the temp dir. Only that fixture's authored skill (plus the
		// per-command skills) should appear, proving cwd and source are independent.
		const source = mkdtempSync(join(tmpdir(), 'picopilot-skills-src-'));
		try {
			const skillDir = join(source, 'picopilot-fixture');
			execFileSync('mkdir', ['-p', skillDir]);
			execFileSync('sh', [
				'-c',
				`printf '%s\\n' '---' 'name: picopilot-fixture' 'description: A fixture skill.' '---' '# fixture' > ${JSON.stringify(join(skillDir, 'SKILL.md'))}`,
			]);

			const result = await installSkills({
				cli: createCli(),
				global: false,
				cwd: target,
				sourceDir: source,
			});

			expect(result.skills).toContain('picopilot-fixture');
			// The real authored discipline skills are NOT pulled in from this source.
			expect(result.skills).not.toContain('picopilot-overview');
			// Still installed into the temp target, and the real dirs stay untouched.
			expect(
				existsSync(
					join(target, '.agents', 'skills', 'picopilot-fixture', 'SKILL.md'),
				),
			).toBe(true);
			for (const dir of REAL_DIRS) {
				expect(snapshot(dir)).toEqual(before.get(dir));
			}
		} finally {
			execFileSync('rm', ['-rf', source]);
		}
	});

	it('ships skill RESOURCE files, not just SKILL.md (incur 0.4.10 workaround)', async () => {
		// incur's SyncSkills.sync copies only SKILL.md; installSkills backfills the
		// sibling resources. The genre code references under
		// picopilot-code/reference/ must reach the installed skill dir, or the
		// SKILL.md's on-demand pointers dangle.
		await installSkills({cli: createCli(), global: false, cwd: target});

		const codeSkill = join(target, '.agents', 'skills', 'picopilot-code');
		expect(existsSync(join(codeSkill, 'SKILL.md'))).toBe(true);
		for (const res of [
			'reference/README.md',
			'reference/platformer.md',
			'reference/puzzle-grid.md',
			'reference/twin-stick-arcade.md',
			'reference/top-down-adventure.md',
			'reference/mode7-racing.md',
			'reference/rpg-menus-dialog.md',
		]) {
			expect(existsSync(join(codeSkill, res))).toBe(true);
		}
		// The resource content is the authored source byte-for-byte (a real copy).
		expect(
			readFileSync(join(codeSkill, 'reference/platformer.md'), 'utf8'),
		).toBe(
			readFileSync(
				join(skillsSourceDir(), 'picopilot-code', 'reference/platformer.md'),
				'utf8',
			),
		);
		// The real dirs stay untouched (resource copy respects isolation).
		for (const dir of REAL_DIRS) {
			expect(snapshot(dir)).toEqual(before.get(dir));
		}
	});

	it('copies arbitrary nested resources from a custom source, isolated', async () => {
		// A fixture skill with a nested resource proves the copy is general (not
		// hard-coded to picopilot-code) and stays inside the temp target.
		const source = mkdtempSync(join(tmpdir(), 'picopilot-skills-src-'));
		try {
			const skillDir = join(source, 'picopilot-fixture');
			execFileSync('mkdir', ['-p', join(skillDir, 'reference', 'deep')]);
			execFileSync('sh', [
				'-c',
				`printf '%s\n' '---' 'name: picopilot-fixture' 'description: A fixture skill.' '---' '# fixture' > ${JSON.stringify(join(skillDir, 'SKILL.md'))}`,
			]);
			execFileSync('sh', [
				'-c',
				`printf 'RES' > ${JSON.stringify(join(skillDir, 'reference', 'deep', 'note.md'))}`,
			]);

			await installSkills({
				cli: createCli(),
				global: false,
				cwd: target,
				sourceDir: source,
			});

			const installed = join(target, '.agents', 'skills', 'picopilot-fixture');
			expect(existsSync(join(installed, 'SKILL.md'))).toBe(true);
			expect(
				readFileSync(join(installed, 'reference', 'deep', 'note.md'), 'utf8'),
			).toBe('RES');
			for (const dir of REAL_DIRS) {
				expect(snapshot(dir)).toEqual(before.get(dir));
			}
		} finally {
			execFileSync('rm', ['-rf', source]);
		}
	});
});
