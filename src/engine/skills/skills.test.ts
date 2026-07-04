import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCli } from '../../cli.js'
import { installSkills, SKILL_NAMES, skillsSourceDir } from './index.js'

/**
 * Reads an authored skill's SKILL.md straight from the on-disk source dir, the
 * same files incur's `include` glob ships. Skill GENERATION output is these
 * files, so the generation tests assert against them directly.
 */
function readSkill(name: string): string {
  return readFileSync(join(skillsSourceDir(), name, 'SKILL.md'), 'utf8')
}

describe('picopilot skills: generation output (the authored discipline skills)', () => {
  it('ships exactly the five named US #20 skills, each with valid frontmatter', () => {
    expect([...SKILL_NAMES].sort()).toEqual(
      [
        'picopilot-art',
        'picopilot-audio',
        'picopilot-code',
        'picopilot-debug',
        'picopilot-overview',
      ].sort(),
    )
    for (const name of SKILL_NAMES) {
      const md = readSkill(name)
      // incur discovers a skill by its `name:` frontmatter line; a `description:`
      // is what makes it load on-demand. Both must be present and match.
      expect(md).toMatch(new RegExp(`^name:\\s*${name}$`, 'm'))
      expect(md).toMatch(/^description:\s*.+/m)
    }
  })

  it('picopilot-overview carries the #include discipline', () => {
    const md = readSkill('picopilot-overview')
    expect(md).toContain('#include main.lua')
    expect(md).toContain('main.lua')
    // Edit the Lua, never the binary sections (allow line wrapping between words).
    expect(md).toMatch(/never\s+hand-write/i)
    expect(md).toContain('__gfx__')
  })

  it('picopilot-code carries the token-breakdown discipline', () => {
    const md = readSkill('picopilot-code')
    expect(md).toContain('8,192')
    expect(md).toContain('picopilot tokens')
    expect(md).toContain('picopilot minify')
    // A PICO-8 shorthand the skill teaches for reclaiming budget.
    expect(md).toContain('+=')
  })

  it('picopilot-art carries the render→look→set→render loop AND the non-multimodal fallback', () => {
    const md = readSkill('picopilot-art')
    // The art loop.
    expect(md).toContain('gfx render')
    expect(md).toContain('gfx set')
    expect(md).toContain('gfx show')
    // The load-bearing non-multimodal fallback: view the PNG if you can read
    // images, else reason over the grid.
    expect(md.toLowerCase()).toContain('cannot read images')
    expect(md.toLowerCase()).toMatch(/reason(ing)?\s+over the[\s\S]*grid/i)
    // The gfx/map overlap smart-refuse discipline.
    expect(md.toLowerCase()).toContain('overlap')
    expect(md).toContain('allowMapOverlap')
  })

  it('picopilot-audio carries the picopilot-MML authoring model (and scopes the v2 commands)', () => {
    const md = readSkill('picopilot-audio')
    expect(md).toContain('picopilot-MML')
    // ABC is explicitly NOT used.
    expect(md).toContain('ABC')
    // Music is assembled structurally from SFX references.
    expect(md.toLowerCase()).toContain('structural')
    // Honest scoping: the audio commands are v2 / land later.
    expect(md.toLowerCase()).toContain('v2')
  })

  it('picopilot-debug carries the static-gate + run loop and the dependency boundaries', () => {
    const md = readSkill('picopilot-debug')
    expect(md).toContain('picopilot verify')
    expect(md).toContain('picopilot run')
    expect(md).toContain('printh')
    expect(md).toContain('gate-incapable')
    expect(md).toContain('pico8-not-found')
    expect(md).toContain('shrinko-not-found')
  })
})

/**
 * Recursively snapshots a directory tree as a sorted list of `relpath:mtimeMs`
 * for files and `relpath/` for dirs, so a before/after comparison catches ANY
 * new/removed entry AND any modified file. Returns `['<absent>']` when the dir
 * does not exist (so "absent stays absent" is also asserted).
 */
function snapshot(root: string): string[] {
  if (!existsSync(root)) return ['<absent>']
  const out: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        out.push(`${relPath}/`)
        walk(abs, relPath)
      } else {
        // lstat, not stat: never follow a symlink out of the snapshotted tree.
        out.push(`${relPath}:${statSync(abs, { throwIfNoEntry: false })?.mtimeMs ?? 'gone'}`)
      }
    }
  }
  walk(root, '')
  return out
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
]

describe('picopilot skills: isolated --install-skills (the load-bearing shared-write test)', () => {
  let target: string
  let before: Map<string, string[]>

  beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'picopilot-skills-install-'))
    // Snapshot the REAL dirs before the install so we can prove they never moved.
    before = new Map(REAL_DIRS.map((d) => [d, snapshot(d)]))
  })

  afterEach(() => {
    try {
      execFileSync('rm', ['-rf', target])
    } catch {
      // ignore
    }
  })

  it('installs into the redirected temp target, NOT a real dir', async () => {
    // The lever: global=false + cwd=temp installs under <cwd>/.agents/skills.
    const result = await installSkills({ cli: createCli(), global: false, cwd: target })

    // Every named discipline skill landed (plus the per-command skills).
    for (const name of SKILL_NAMES) {
      expect(result.skills).toContain(name)
      expect(existsSync(join(target, '.agents', 'skills', name, 'SKILL.md'))).toBe(true)
    }
    // Every reported canonical path is INSIDE the temp target.
    for (const p of result.paths) {
      expect(p.startsWith(target)).toBe(true)
    }
    // Any wired non-universal agent dir is also inside the temp target, never a
    // real home dir (the symlinks go under cwd for a project install).
    for (const a of result.agents) {
      expect(a.path.startsWith(target)).toBe(true)
    }
  })

  it('leaves the REAL agent skill dirs BYTE-UNTOUCHED', async () => {
    await installSkills({ cli: createCli(), global: false, cwd: target })

    // The real dirs are identical before and after: no new entry, nothing
    // modified, and an absent dir stays absent. This is the pollution guard.
    for (const dir of REAL_DIRS) {
      expect(snapshot(dir)).toEqual(before.get(dir))
    }
  })

  it('a custom sourceDir proves the source is decoupled from the install target', async () => {
    // Point the include SOURCE at a fixture with a single skill; install TARGET
    // stays the temp dir. Only that fixture's authored skill (plus the
    // per-command skills) should appear, proving cwd and source are independent.
    const source = mkdtempSync(join(tmpdir(), 'picopilot-skills-src-'))
    try {
      const skillDir = join(source, 'picopilot-fixture')
      execFileSync('mkdir', ['-p', skillDir])
      execFileSync('sh', [
        '-c',
        `printf '%s\\n' '---' 'name: picopilot-fixture' 'description: A fixture skill.' '---' '# fixture' > ${JSON.stringify(join(skillDir, 'SKILL.md'))}`,
      ])

      const result = await installSkills({
        cli: createCli(),
        global: false,
        cwd: target,
        sourceDir: source,
      })

      expect(result.skills).toContain('picopilot-fixture')
      // The real authored discipline skills are NOT pulled in from this source.
      expect(result.skills).not.toContain('picopilot-overview')
      // Still installed into the temp target, and the real dirs stay untouched.
      expect(existsSync(join(target, '.agents', 'skills', 'picopilot-fixture', 'SKILL.md'))).toBe(
        true,
      )
      for (const dir of REAL_DIRS) {
        expect(snapshot(dir)).toEqual(before.get(dir))
      }
    } finally {
      execFileSync('rm', ['-rf', source])
    }
  })
})
