---
title: engine/shrinko shell-out adapter + picopilot tokens (structured shrinko-not-found)
slug: shrinko-adapter-tokens
prd: picopilot
blockedBy: [cart-model-and-p8-io]
covers: [3, 17]
---

## What to build

The first shrinko-backed command, and the adapter seam all shrinko commands share. Build `engine/shrinko` — a TS adapter that shells out to a user-installed Python `shrinko8` (`shrinko8` / `python -m shrinko8`), detects presence, parses its output, and returns incur-structured results. Wire `picopilot tokens`: report `{tokens, pct, chars, compressed}` against the 8192 budget (via shrinko8 `--count`), with a CTA to `minify` when over budget.

The two-tier contract (B1, DECIDED): when shrinko is ABSENT, `tokens` returns a STRUCTURED `{ok:false, reason:"shrinko-not-found", remedy:"uv pip install shrinko", needs:["python>=3.8"]}` + nonzero exit — NOT a crash, NOT a hollow success. The adapter is a well-defined seam (a typed interface) so a future native-TS implementation can drop in without changing the command layer.

This task establishes the seam that `verify`, `lint`, `minify`, and `gfx import/export` (later tasks) reuse — so design the adapter interface for them, not just `tokens`.

## Acceptance criteria

- [ ] `engine/shrinko` detects shrinko presence and, when present, parses `--count` output into `{tokens, pct, chars, compressed}`.
- [ ] `picopilot tokens` reports the budget struct with a CTA to `minify` when over 8192.
- [ ] shrinko ABSENT → structured `{ok:false, reason:"shrinko-not-found", remedy:"uv pip install shrinko", needs:["python>=3.8"]}` + nonzero exit (exact remedy string; the PyPI package is `shrinko`, the module `shrinko8`).
- [ ] The adapter is a typed seam (interface/adapter) a native-TS impl could replace without touching the command layer; a test swaps a stub adapter and asserts the command's public output/exit is unchanged.
- [ ] **Shared/external-tool isolation:** tests MOCK/STUB the shrinko binary (present AND absent) — NEVER depend on shrinko being installed on the runner; drive commands via incur's `cli.serve(argv, {stdout, exit, env})` DI. Assert the child-process env (e.g. `PATH`) is the isolation lever.
- [ ] Tests cover present (parses real sample output) and absent (structured result), mirroring the repo's test style.

## Blocked by

- `cart-model-and-p8-io` — `tokens` counts a cart the adapter reads/passes to shrinko.

## Prompt

> Goal: build the shrinko adapter seam + `picopilot tokens`, the first code-quality command, honoring the two-tier "structured failure when shrinko is absent" contract.
>
> FIRST, drift-check: confirm `cart-model-and-p8-io` landed. Note whether any other shrinko command already defined the adapter interface — if so, extend it, don't fork it.
>
> Domain + decisions (DECIDED, Q1): shrinko8 is consumed as an EXTERNAL Python CLI via shell-out (NOT ported to TS, NOT vendored as WASM — the Pyodide route was rejected as too heavy). It is a load-bearing dependency for code-quality commands. shrinko's `--count` prints lines like `tokens: 8053 98%` / `chars: 30320 46%` / `compressed: 12176 77%` (see the shrinko8 docs). ABSENT shrinko must yield a structured result with the EXACT remedy `uv pip install shrinko` + nonzero exit — never a crash or a hollow pass. Build the adapter as a typed seam so a future native-TS impl drops in without touching commands.
>
> Where to look: `engine/shrinko` (new adapter home); `CONTEXT.md` (shrinko8 glossary); incur's `error()` envelope + `cli.serve(argv,{env})` DI for tests. This adapter is REUSED by `verify`/`lint`/`minify`/`gfx import-export` — design its interface for them.
>
> Seams to test at: (1) present — feed a captured `--count` sample, assert the parsed struct; (2) absent — assert the structured `shrinko-not-found` result + nonzero exit; (3) seam-swap — a stub adapter leaves the command's public output/exit unchanged. NEVER let a test require shrinko actually installed (mock it; override child `PATH`). Done = `tokens` works with shrinko, degrades honestly without it, behind a replaceable seam. Record the adapter interface shape + any parse-format assumption in the done record.
