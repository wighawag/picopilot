---
title: incur CLI skeleton + build/test/verify gate + .dorfl.json
slug: cli-skeleton-and-verify-gate
prd: picopilot
blockedBy: []
covers: [16]
---

## What to build

The greenfield project skeleton EVERY other task builds on: a TypeScript package whose entry point is a single `incur` `Cli.create('picopilot', …)` with `.serve()`, wired so subcommand groups can be mounted later. It must build, test, lint/format, and expose incur's free surface (TOON output by default, `--json`/`--format`, `--llms`, MCP via `--mcp`, `skills add`/`mcp add`). Establish the package layout the prd names (`engine/` for codecs/adapters, the command layer), the test runner, and the format/lint tooling.

Then REPLACE the placeholder `.dorfl.json` `verify` (currently a TODO string) with the real acceptance gate for this stack, cheap-first: `pnpm format:check && pnpm build && pnpm test` (adjust to the actual package-manager/scripts you set up), and set `prepare` to the install step (e.g. `pnpm install --frozen-lockfile`) now that a lockfile exists. Add one trivial command (e.g. a `version`/`hello` or the eventual `init` stub) so the CLI runs end-to-end and the gate has something to build+test.

This is a thin vertical: package manifest + build config + one runnable incur command + a passing test + the real `verify`/`prepare` gate.

## Acceptance criteria

- [ ] `npx picopilot --help` (or the built binary) runs and lists the incur built-ins (`skills add`, `mcp add`, `--llms`, `--mcp`, `--format`).
- [ ] A minimal command runs end-to-end and returns a structured result in TOON by default, JSON under `--json`.
- [ ] `.dorfl.json` `verify` is the real cheap-first gate (format → build → test), `prepare` is the install step, and running `verify` from a fresh `prepare`d tree is GREEN (no more TODO placeholder).
- [ ] Package layout established for `engine/` (codecs/adapters) + a command layer, so later tasks mount groups without restructuring.
- [ ] Tests cover the new behaviour (the runnable command's output/exit), mirroring an idiomatic TS test setup.

## Blocked by

- None — can start immediately. (This is the foundation; all other v1-core tasks depend on it.)

## Prompt

> Goal: stand up the picopilot TypeScript CLI on the `incur` framework as the skeleton every later task builds on, and replace the placeholder `.dorfl.json` `verify` gate with the real one so the repo's own acceptance gate is live.
>
> FIRST, check this task against current reality (launch snapshot; may have drifted): confirm the repo is still greenfield (no `package.json`/source yet) and `.dorfl.json` still carries a TODO `verify`. If code already landed, reconcile rather than clobber.
>
> Domain: `incur` (github.com/wevm/incur) is a TS CLI framework where ONE `Cli.create(name, {...}).command(...).serve()` definition yields the CLI + an MCP server + auto-installable skills + TOON output + Zod arg/output schemas + CTAs + a structured `error({code, message, retryable, cta})` envelope. See `CONTEXT.md` for the picopilot glossary (cart, char grid, shrinko8, `picopilot verify` vs the runner's own `verify` gate). Read the incur README/SKILL for the exact API (`Cli.create`, `.command`, `.serve`, `sync:` for skill grouping, `config:` for the config file, `cli.serve(argv, {stdout, exit, env})` DI for tests).
>
> Where to look: this is greenfield, so you are creating the package. Use pnpm (the repo's `.dorfl.json` assumes it). Establish `engine/` for the later codecs/adapters and a command layer. Keep the first command trivial — its job is to prove the CLI runs and give the gate something to build+test.
>
> The verify gate: order it cheap-first (`format:check` → `build` → `test`) and put the install in `prepare` (NOT in `verify`) — `prepare` = env-ready, `verify` = tree-green. Run `verify` once from a fresh state and confirm green before finishing; a red gate here bites every future task.
>
> Done = the CLI runs end-to-end, emits TOON/JSON, the real `verify`/`prepare` gate is in `.dorfl.json` and passes, and the package layout is ready for command groups. RECORD any non-obvious in-scope decision (package manager, test runner, module layout) briefly in the done record; if a choice is hard-to-reverse + surprising + a real trade-off, write an ADR in `docs/adr/`.
