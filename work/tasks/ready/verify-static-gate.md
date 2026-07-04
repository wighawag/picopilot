---
title: picopilot verify — static gate (tokens + integrity), gate-incapable when shrinko absent
slug: verify-static-gate
prd: picopilot
blockedBy: [shrinko-adapter-tokens]
covers: [15, 18]
---

## What to build

The stable STATIC acceptance gate an agent drives each iteration toward. `picopilot verify` runs tokens + cart-integrity (lint folds in when the lint task lands in v1-rest — in v1-core, verify = tokens + integrity) and returns ONE structured pass/fail envelope. It is STATIC BY DESIGN: it does NOT execute the cart. Its envelope MUST self-scope ("static gate: tokens + integrity; passing does NOT mean the cart runs"), and a green `picopilot verify` CTAs toward `picopilot run` ("static checks pass — now confirm it boots").

The gate-incapable contract (DECIDED, Q1): because verify's token check is shrinko-backed, when shrinko is ABSENT verify returns a DISTINCT `gate-incapable` result (nonzero exit, NEVER green) — categorically separate from `pass` and from `fail`. It must NEVER report green by skipping its most important check (token bloat, the #1 failure mode). This is the gate-as-theatre regression the whole contract exists to prevent.

"cart-integrity" = the cart parses/round-trips cleanly via the cart model (well-formed sections), not a run.

## Acceptance criteria

- [ ] `picopilot verify` runs tokens + integrity and returns ONE structured envelope with an overall pass/fail.
- [ ] The envelope SELF-SCOPES: it states it is static and that passing does NOT mean the cart runs.
- [ ] Green verify CTAs to `picopilot run`.
- [ ] shrinko ABSENT → distinct `gate-incapable` outcome (nonzero exit), NOT `pass` and NOT a silent skip. A test that lets verify report green without shrinko is the regression guard.
- [ ] verify works with PICO-8 absent (it never runs the cart) — no PICO-8 dependency.
- [ ] Tests cover: pass, fail (e.g. over-budget / malformed cart), and gate-incapable (shrinko absent), mocking the shrinko adapter; mirror the repo's test style.

## Blocked by

- `shrinko-adapter-tokens` — verify's token check goes through the shrinko adapter (and reuses its absent-detection for gate-incapable). (In v1-core, verify = tokens + integrity; integrity uses the cart model, already available via the shrinko task's own chain. verify does NOT need the gfx codec.)

## Prompt

> Goal: build `picopilot verify`, the static cart-acceptance gate — honest by design: it never runs the cart, says so, and can never pass hollowly when it cannot check tokens.
>
> FIRST, drift-check: confirm `shrinko-adapter-tokens` landed (reuse its adapter + absent-detection) and the cart model exists.
>
> Domain + decisions (DECIDED, Q1/Q3): `picopilot verify` is the tool's cart gate for the USER's cart — DISTINCT from the runner's own `.dorfl.json` `verify` gate that gates picopilot's development (same word, different level — always write `picopilot verify`). It is STATIC (tokens + integrity; NO run). Envelope self-scopes ("passing ≠ the cart runs") and green-CTAs to `picopilot run`. shrinko absent = `gate-incapable` (nonzero, never green) — the token check is the #1 failure mode; skipping it and reporting green is the gate-as-theatre regression this exists to prevent. In v1-core, verify = tokens + integrity; lint joins when the lint task lands (do not block on it).
>
> Where to look: `engine/shrinko` (token check + absent-detection), the cart model (integrity = clean round-trip), incur's structured envelope + CTAs. `CONTEXT.md` has the `gate-incapable` and `picopilot verify` glossary entries.
>
> Seam to test at: three outcomes — pass, fail, and gate-incapable (shrinko mocked absent). The gate-incapable-never-green test is the load-bearing regression guard. Done = a stable, honest static gate the agent can drive on and that refuses to lie when it can't check. Record the `gate-incapable` exit code you choose in the done record.
