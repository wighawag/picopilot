---
title: picopilot init — scaffold cart + AGENTS.md + picopilot.json, print skills tip
slug: init-scaffold
spec: picopilot
blockedBy: [cart-model-and-p8-io]
covers: [1, 2]
---

## What to build

`picopilot init` in an empty folder produces a ready-to-edit cart under a SINGLE scaffolding model: a text-format `main.p8` whose `__lua__` section is a single `#include main.lua` line, plus a separate `main.lua` (the plain-Lua file the agent actually edits, so it never hand-writes the binary sections). Also scaffold a generated `AGENTS.md`/`CLAUDE.md` carrying the curated PICO-8 API reference, and a `picopilot.json` config file (incur's `config:` mechanism).

By DEFAULT `init` does NOT run `git init` (or any VCS) and does NOT write to shared agent skill dirs — it only PRINTS a one-line tip for skills discovery (the manual/symlink path) and a one-line `git init` tip. The `--install-skills` opt-in (incur `skills add`) is a SEPARATE task; here, just print the instruction.

Include the `picopilot.json` schema + reading (the `allowMapOverlap` key the gfx task consumes) in this task — it is a simple documented shape, folded into init rather than its own task.

## Acceptance criteria

- [ ] `picopilot init` in an empty temp dir writes `main.p8` (with `__lua__` = `#include main.lua`), `main.lua`, `AGENTS.md`/`CLAUDE.md` (PICO-8 API reference), and `picopilot.json` — nothing else.
- [ ] `init` does NOT run `git init` and does NOT write outside the target folder; it PRINTS a skills-discovery tip and a `git init` tip.
- [ ] The scaffolded `main.p8` is a valid cart per the cart model (round-trips), and `#include main.lua` is the only code.
- [ ] `AGENTS.md` content is derived from `work/notes/findings/pico8-api-reference.md` (loop, palette, memory-map + overlap warning, most-used API, token discipline).
- [ ] `picopilot.json` schema is defined + read via incur `config:` (`argv > config > zod defaults`), including `allowMapOverlap`.
- [ ] **Shared-write isolation:** tests run `init` against a TEMP dir and assert NO writes outside it (no touch to the real home/git config); default `init` has no shared write, so assert absence of one.
- [ ] Tests cover the scaffold output + the "no VCS, no shared write, prints tips" behaviour, mirroring the repo's test style.

## Blocked by

- `cart-model-and-p8-io` — `init` writes a `main.p8` via the cart model.

## Prompt

> Goal: build `picopilot init` — the scaffolder that gives an agent a ready-to-edit PICO-8 cart with the highest-leverage context in place, WITHOUT mutating the user's environment (no `git init`, no auto skills-add).
>
> FIRST, drift-check: confirm `cart-model-and-p8-io` landed (you write `main.p8` through it) and that `work/notes/findings/pico8-api-reference.md` exists (the source for the `AGENTS.md` content).
>
> Domain + decisions (from the prd, DECIDED): single scaffolding model — `.p8` holds the binary sections + a `#include`, the editable Lua lives in `main.lua`; the agent never hand-writes hex. `init` is INSTRUCT-not-mutate: it prints a skills-discovery tip (Claude Code/Codex differ, so instructing is more portable than auto-installing) and a `git init` tip; the actual global skills install is the opt-in `--install-skills` (a SEPARATE task). `picopilot.json` is incur's `config:` file (precedence `argv > config > zod defaults`); define its schema here incl. `allowMapOverlap` (read by the gfx task).
>
> Where to look: `CONTEXT.md` (glossary), `work/notes/findings/pico8-api-reference.md` (curate the AGENTS.md reference from this — do not dump the whole thing; carry the loop, the palette, the memory map + overlap warning, the grouped API, the token discipline). Use the cart model from the previous task to emit `main.p8`.
>
> Seam to test at: run `init` in a TEMP dir; assert exactly the four files, a valid round-tripping `main.p8`, and NO write outside the temp dir (the shared-write isolation rule — default init has no shared write, prove it). Done = a fresh folder becomes an agent-ready cart and the tool touched nothing it shouldn't. Record any non-obvious choice (the exact AGENTS.md curation, the picopilot.json schema shape) in the done record.
