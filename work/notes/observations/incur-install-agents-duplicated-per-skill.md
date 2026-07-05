---
title: incur Agents.install returns wired-agent entries per (skill x agent), so callers see duplicated agent names
slug: incur-install-agents-duplicated-per-skill
spotted: 2026-07-05
---

# incur `Agents.install` duplicates wired-agent entries (one per skill x agent)

Spotted while verifying `picopilot init --install-skills`: the reported `wiredAgents` list came back as `Claude Code, Kilo` repeated ten times (20 entries). Not a picopilot bug (we map `result.agents` 1:1 with no multiply/dedup); it is the shape incur's `Agents.install` returns. Recorded with detail so an issue + PR can be filed against incur. Low severity (cosmetic in the returned metadata), but it makes any "which agents did we wire?" summary wrong without caller-side dedup.

## Environment

- incur `0.4.10` (`node_modules/.pnpm/incur@0.4.10/.../incur/dist/internal/agents.js`, function `install`).
- Reached via `SyncSkills.sync` -> `Agents.install`, whose `agents` array flows out as `SyncSkills.sync(...).agents`.

## Expected vs actual

- EXPECTED: `result.agents` describes the set of non-universal agents that were wired (each agent once, or at least dedupable to a clean per-agent summary).
- ACTUAL: `result.agents` has ONE ENTRY PER (skill, agent) symlink. With 10 skills and 2 detected non-universal agents (Claude Code, Kilo), it returns 20 entries: `[Claude Code, Kilo, Claude Code, Kilo, ...]` x10.

## Reproduction (verified 2026-07-05)

`picopilot init <dir> --install-skills --no-global --json` reported:

```
installedSkills: 10  (picopilot-art, -audio, -code, -debug, -gfx, -init, -overview, -tokens, -verify, -version)
wiredAgents:     20  [Claude Code, Kilo, Claude Code, Kilo, ... x10]
```

20 = 10 skills x 2 agents. picopilot builds `wiredAgents` as `result.agents.map(a => a.agent)` (no dedup), so the duplication is entirely incur's array shape surfacing.

## Root cause (exact, from dist/internal/agents.js in 0.4.10)

`install()` loops agents INSIDE the skills loop and pushes one agent entry per symlink:

```js
const agents = [];
for (const skill of discoverSkills(sourceDir)) {
    const canonicalDir = path.join(canonicalBase, skill.name);
    ...
    paths.push(canonicalDir);                 // one path per skill  (correct)
    for (const agent of detected) {
        if (agent.universal) continue;
        const agentDir = path.join(agentSkillsDir, skill.name);
        ...
        fs.symlinkSync(rel, agentDir);
        agents.push({ agent: agent.name, path: agentDir, mode: 'symlink' });  // <-- per (skill,agent)
    }
}
return { paths, agents };
```

Each pushed entry is a REAL, DISTINCT symlink (`path` differs per skill), so the array is correct as a list of symlinks. The problem is only that the `agent` NAME repeats, so consumers treating `agents` as "the set of wired agents" over-count. There is no per-agent rollup in the return value.

## Two reasonable fixes (for the PR)

Pick one; (A) is the smaller/behaviour-preserving change:

- (A) Leave `agents` as the per-symlink list (it is accurate at that granularity) but DOCUMENT that it is per (skill, agent), and add a helper / second field `wiredAgents: string[]` that is the DEDUPED set of agent names. Non-breaking.
- (B) Change `agents` to a per-agent rollup: `{ agent, paths: string[], mode }` (one entry per unique agent, listing its symlink paths). Cleaner but a breaking shape change.

Either way, add a test: install >1 skill with >=1 non-universal agent detected, assert the reported unique-agent set has no duplicates.

## picopilot-side workaround (DONE)

picopilot now dedups when reducing incur's per-symlink `agents` to display NAMES:
`init.ts` builds `wiredAgents = [...new Set(install.agents.map(a => a.agent))]`
(order-preserving). This is the right layer: `installSkills`'s `agents` array
stays a faithful per-symlink mirror of incur (its distinct `path`s drive the
resource-copy loop), and only the name SUMMARY is deduped. Covered by an init
test that feeds 2 skills x 2 agents (4 repeated entries) and asserts
`wiredAgents == ['Claude Code','Kilo']`. This workaround is independent of the
incur fix and can stay even after incur is corrected (a `Set` over an
already-unique list is a harmless no-op).

## Cross-reference

- `notes/observations/incur-syncskills-drops-skill-resource-files.md` - the OTHER incur skills-install finding (resources dropped). Note the connection: `Agents.install` here DOES `fs.cpSync(skill.dir, canonicalDir, {recursive:true})` for non-root skills (line ~188), i.e. it would copy resources IF they were present, but `SyncSkills.sync` writes only SKILL.md into its tmpDir upstream, so `Agents.install` never sees the resource files. The two findings are independent bugs on the same code path; a full fix addresses both.
