---
title: shrinko absent-detection misses the "python present, shrinko8 module missing" case
slug: shrinko-absent-detection-python-no-module
date: 2026-07-04
---

Spotted while building `verify-static-gate`. The `ShellShrinkoAdapter` (from `shrinko-adapter-tokens`, `src/engine/shrinko/shell.ts`) equates "the invocation SPAWNED" with "shrinko is present": `python3 -m shrinko8` spawns fine on a box with Python but no `shrinko8` module, exits nonzero printing `No module named shrinko8`, and the adapter feeds that to `parseCount` → `ShrinkoParseError`/`shrinko-failed`, NOT the structured `shrinko-not-found`.

Effect on `picopilot verify` in the real world: on such a machine verify returns `shrinko-failed` (exit 1), not the `gate-incapable` outcome. It still never reports green (good, the honesty invariant holds), but the DISTINCT gate-incapable signal is only produced when the adapter itself returns `shrinkoNotFound()` (every candidate ENOENTs, or a native-TS stub). Reproduced here: `node --import tsx src/bin.ts verify <cart>` with python3 present and shrinko absent → `code: shrinko-failed`.

Out of scope for this task (the presence-detection lives in the shrinko adapter, and this task's acceptance mocks at the adapter seam per instruction). Likely fix belongs in the adapter: treat a `No module named shrinko8` exit from a `-m shrinko8` invocation as absence (`shrinkoNotFound`), not as ran-and-failed.
