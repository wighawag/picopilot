---
title: incur SyncSkills.sync copies only SKILL.md, dropping bundled skill resource files
slug: incur-syncskills-drops-skill-resource-files
spotted: 2026-07-05
---

# incur `SyncSkills.sync` drops skill resource files (only SKILL.md ships)

Spotted while shipping per-game-type PICO-8 code references as skill RESOURCES (the Anthropic skill-standard idiom: a `SKILL.md` plus supporting files in the same skill directory, loaded on demand). incur's install path copies ONLY the `SKILL.md` and silently drops every sibling file, so bundled resources never reach the installed skill dir. Recorded with full detail so a bug report + PR can be filed against incur.

## Environment

- incur `0.4.10` (`node_modules/.pnpm/incur@0.4.10/.../incur/dist/SyncSkills.js`).
- Consumer: picopilot's `installSkills` (`src/engine/skills/skills.ts`), which calls `SyncSkills.sync('picopilot', commands, { depth:1, global, cwd, include:[join(source,'*')] })` to ship its authored `picopilot-*` skills.

## Expected vs actual

- EXPECTED: a skill authored as a DIRECTORY (`picopilot-code/SKILL.md` + `picopilot-code/reference/platformer.md` + ...) installs the whole directory, so `SKILL.md` can reference its bundled resources (the standard "progressive disclosure" skill pattern: keep big/optional material out of the always-loaded body, load it on demand).
- ACTUAL: only `SKILL.md` is installed. Any sibling file or subdirectory is dropped.

## Minimal reproduction (verified 2026-07-05)

```js
import { SyncSkills } from 'incur';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = mkdtempSync(join(tmpdir(), 'restest-src-'));
const tgt = mkdtempSync(join(tmpdir(), 'restest-tgt-'));
const sk = join(src, 'picopilot-restest');
mkdirSync(join(sk, 'reference'), { recursive: true });
writeFileSync(join(sk, 'SKILL.md'), '---\nname: picopilot-restest\ndescription: test.\n---\n# test\n');
writeFileSync(join(sk, 'reference', 'platformer.md'), '# platformer ref\n');

await SyncSkills.sync('picopilot', new Map(), { depth: 1, global: false, cwd: tgt, include: [join(src, '*')] });

const dest = join(tgt, '.agents', 'skills', 'picopilot-restest');
console.log('skill installed:', existsSync(join(dest, 'SKILL.md')));                 // true
console.log('resource shipped:', existsSync(join(dest, 'reference', 'platformer.md'))); // FALSE  <-- bug
console.log('dest contents:', readdirSync(dest));                                     // ["SKILL.md"]
```

Output observed:
```
skill installed: true
resource shipped: false
dest contents: ["SKILL.md"]
```

## Root cause (exact, from dist/SyncSkills.js in 0.4.10)

In the `options.include` branch of `sync()`:

```js
if (options.include) {
  for (const pattern of options.include) {
    const globPattern = pattern === '_root' ? 'SKILL.md' : path.join(pattern, 'SKILL.md');
    for await (const match of fs.glob(globPattern, { cwd })) {   // <-- globs ONLY */SKILL.md
      const content = await fs.readFile(path.resolve(cwd, match), 'utf8');
      const meta = parseSkillFrontmatter(content);
      const skillName = ... path.basename(path.dirname(match));
      const dest = path.join(tmpDir, skillName, 'SKILL.md');      // <-- writes ONLY SKILL.md
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
      ...
    }
  }
}
const { paths, agents } = Agents.install(tmpDir, { global, cwd });  // installs whatever is in tmpDir
```

Two coupled facts cause the drop:
1. The glob is hard-coded to `<pattern>/SKILL.md`, so only the manifest file is ever matched; sibling files in the source skill dir are never enumerated.
2. Only `content` (the SKILL.md text) is written into `tmpDir/<skillName>/SKILL.md`. The source skill directory is never recursively copied, so `Agents.install(tmpDir, ...)` has nothing but SKILL.md to install.

The same shape exists in `list()` (glob `*/SKILL.md`), but `list()` is read-only so it is not the bug, just the parallel code path.

## Suggested fix (for the PR)

After locating each matched `SKILL.md`, copy the ENTIRE containing skill directory into `tmpDir/<skillName>/`, not just the manifest. Minimal change in the `include` loop:

```js
for await (const match of fs.glob(globPattern, { cwd })) {
  const srcDir = path.dirname(path.resolve(cwd, match));       // the skill's source dir
  const skillName = pattern === '_root' ? (meta.name ?? name) : path.basename(srcDir);
  const destDir = path.join(tmpDir, skillName);
  // NEW: recursively copy the whole skill dir (resources + SKILL.md), not just SKILL.md
  await fs.cp(srcDir, destDir, { recursive: true });
  // (still parse frontmatter from the copied SKILL.md for the skills[] metadata)
}
```

Notes for the PR author:
- `_root` pattern (single top-level `SKILL.md`, no containing skill dir) must keep the SKILL.md-only behaviour, so branch on `pattern === '_root'`.
- The generated-from-commands path (the `files`/`Skill.split` loop earlier in `sync`) has no resources and is unaffected; only the authored-skill `include` path needs the recursive copy.
- Consider excluding obvious non-resources if desired (e.g. `.DS_Store`), but a plain recursive `fs.cp` is the smallest correct fix. `Agents.install` already treats `tmpDir/<skillName>/` as the unit, so copying more files into it "just works" downstream.
- Add a test: author a fixture skill with a sibling resource file, sync to a temp target, assert the resource lands next to SKILL.md.

## picopilot workaround (until incur is fixed)

picopilot's `installSkills` will, AFTER `SyncSkills.sync`, recursively copy each authored skill's non-`SKILL.md` files from `skillsSourceDir()/<skill>/` into every install path returned by the sync (`result.paths` + each wired agent path). This keeps the resources shipping regardless of incur's SKILL.md-only behaviour, and can be removed once incur copies full skill dirs. The workaround stays inside the already-isolated `installSkills` seam, so the shared-write isolation test still governs it.
