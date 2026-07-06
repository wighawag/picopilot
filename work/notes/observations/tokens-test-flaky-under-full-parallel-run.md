# `tokens` test flaked under the full parallel run (ROOT CAUSE FOUND + FIXED: an ambient incur skills CTA, not shrinko)

2026-07-06: `src/commands/tokens.test.ts > reports {tokens, pct, chars, compressed} under budget with no minify CTA` failed intermittently (~1 in 3) during a FULL `pnpm test` run, but passed 100% in isolation.

## Root cause (the first hypothesis was WRONG)

The initial guess was shrinko subprocess contention. That was wrong: the failing test uses a STUB adapter that never spawns shrinko. The real cause: incur's **skills-freshness check**. On any non-builtin command, incur compares the CLI's current skill hash against a STORED hash it reads from `$XDG_DATA_HOME/incur/<name>.json` (keyed on the CLI `name`), and if they differ AND `hasInstalledSkills(<name>)` is true it appends a `{description:"Skills are out of date:", commands:[{command:"... skills add"}]}` CTA to the command's output.

The command tests created their CLI as `Cli.create('picopilot', ...)` , the REAL name, so the check read this machine's actual installed-`picopilot` skill hash. Under the full parallel run, `src/engine/skills/skills.test.ts` installs/removes skills concurrently (into `~/.agents/skills` etc.), so mid-run the stored `picopilot` hash intermittently mismatched, and the ambient "Skills are out of date" CTA got attached to the `tokens` output, breaking `expect(out.cta).toBeUndefined()`. It surfaced ONLY in `tokens` (and latently `verify`) because those are the only command tests that ASSERT on `cta`.

## Fix

Give the test CLI a UNIQUE name (`picopilot-tokens-test` / `picopilot-verify-test`), not the real `picopilot`. Then `readHash(<unique-name>)` finds no stored hash for it, so the skills-freshness CTA never fires, and the assertion is deterministic. A unit test of a command must not depend on the machine's installed-skills state; the unique name is the isolation. Verified: 6/6 full parallel runs pass (was ~1 in 3 failing).

## Note for later

The other command tests (`audio/gfx-io/init/lint/minify/playtest/run`) still use `name: 'picopilot'` but do NOT assert on `cta`, so they are not affected by the ambient skills CTA today. If one adds a full-output-equality or `cta` assertion, give it a unique cli name too (or globally isolate `$XDG_DATA_HOME` for the test process). The deeper option (not taken, heavier) is to point `$XDG_DATA_HOME` + the skills cwd at a temp dir for the whole test process.
