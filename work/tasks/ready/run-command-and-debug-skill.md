---
title: picopilot run (thin sentinel-watch + screenshot collect) + picopilot-debug skill
slug: run-command-and-debug-skill
prd: picopilot
blockedBy: []
covers: [14]
---

## What to build

`picopilot run <cart>` — a THIN orchestration command (ADR-0006) that launches the user's PICO-8 on a cart, watches its stdout for a done-sentinel, kills it on the sentinel (with a timeout backstop), and collects the results into ONE structured envelope. It is NOT a fat `pico8` wrapper; its value is the sentinel-watch + collect glue.

End-to-end behaviour (a thin vertical: engine/pico8 launch+capture -> command -> structured result -> tests):

- Launch `pico8 -x <cart>` with stdin detached (`</dev/null`), redirecting screenshots to a run-controlled dir via `-desktop <dir>` (so the agent gets deterministic PNG paths).
- Stream stdout; when a line equals the done-sentinel (e.g. `__PICOPILOT_DONE__`), kill the pico8 process tree immediately. A `timeout --signal=KILL <backstop>` is the safety net for a cart that hangs/errors before signalling.
- Return a structured envelope: `{ screenshots: [paths], stdout/printh: string, exitReason: "sentinel" | "timeout" | "exit", pico8Present: bool }`.
- PICO-8 ABSENT -> the structured `{ok:false, reason:"pico8-not-found", remedy:"set PICO8_PATH or install PICO-8", needs:["pico8"]}` + nonzero exit (mirror the shrinko boundary; NEVER a crash/hang). This is the ONE thing testable in CI without PICO-8.
- CTA wiring: `run` (fail) -> `lint`/`tokens`; and `picopilot verify` (green) already CTAs to `picopilot run` (close that loop).

ALSO update the `picopilot-debug` skill to teach the underlying recipe (so an agent understands what `run` does and can drive PICO-8 by hand when needed): the `pico8 -x` launch, `extcmd("screen")` for screenshots (NOT `"screenshot"` — that errors), `extcmd("set_filename",...)` for deterministic frame names, the screenshot-on-timer pattern for animation, `printh` + the done-sentinel for termination, `-desktop`/`-screenshot_scale`, and the hard constraint that a cart cannot self-quit the app.

## Acceptance criteria

- [ ] `picopilot run <cart>` returns a structured envelope with screenshot paths, captured printh/stdout, and an exit reason (sentinel / timeout / natural exit).
- [ ] Termination is sentinel-driven: a cart printing the done-sentinel ends the run promptly (not after the full backstop); the `timeout --signal=KILL` backstop still fires for a cart that never signals.
- [ ] PICO-8 absent -> structured `pico8-not-found` + nonzero exit (not a crash/hang). **This is the CI-testable path** (PICO-8 is a paid binary, not on CI).
- [ ] Live PICO-8 runs are a MANUAL/opt-in test tier (mirror the existing `engine/pico8` runner-absent test discipline).
- [ ] The `picopilot-debug` skill documents the tested recipe (the `extcmd("screen")`-not-`"screenshot"` warning, the sentinel termination, the can't-self-quit constraint).
- [ ] **Shared-write note:** `run` writes screenshots to a dir it controls (a temp/scratch dir by default, or a user-given path); tests that exercise the dir must isolate it (temp) and not pollute `~/Desktop`. The `-desktop` flag is the lever.

## Blocked by

- None — can start immediately. The `engine/pico8` seam already exists (the runner-absent path from `verify-static-gate`/the layered engine); extend it. Read `work/notes/findings/pico8-run-and-screenshot.md` and `docs/adr/0006-run-is-a-thin-orchestration-command.md` FIRST — they are the tested spec.

## Prompt

> Goal: build `picopilot run` as a THIN sentinel-watch + screenshot-collect orchestration command (NOT a `pico8` wrapper), and teach the underlying recipe in the `picopilot-debug` skill.
>
> FIRST, read the two source docs — they are the LIVE-TESTED spec:
> - `work/notes/findings/pico8-run-and-screenshot.md` — the exact recipe (verified against PICO-8 v0.2.7): `pico8 -x <cart>`, `extcmd("screen")` (NOT `"screenshot"`, which errors), `-desktop <dir>` to redirect screenshots, `printh` -> stdout, the stdout done-sentinel + kill-on-match (better than a blind timeout), and the hard constraint that a cart CANNOT self-quit the app (shutdown is exported-binary-only, so external kill is mandatory).
> - `docs/adr/0006-run-is-a-thin-orchestration-command.md` — the decision + why (thin command owns sentinel-watch+collect; the mechanics are PICO-8's CLI; blind-timeout rejected in favour of the sentinel).
>
> Also drift-check: this task supersedes the prd's US #14 framing ("launch headless, capture printh + exit") — the command is that idea reshaped by the spike. Confirm the `engine/pico8` seam / the pico8-not-found structured result already exists (from the layered engine + verify work) and extend it; don't re-invent the absent-detection.
>
> Domain: `CONTEXT.md` glossary; the pico8-not-found boundary mirrors shrinko-not-found (structured, nonzero, never crash). incur's `error({code,message,cta})` envelope for the failure shape; incur CTAs for the run->lint/tokens loop.
>
> Where to look: `engine/pico8` (the PICO-8 launch+capture home); the command layer for `run`; `src/skills/picopilot-debug/SKILL.md` for the recipe doc. The CI-testable path is PICO-8-absent (structured result); live runs are a manual/opt-in tier.
>
> Seam to test at: (1) pico8-absent -> structured `pico8-not-found` + nonzero (the CI test); (2) the sentinel-watch logic unit-tested against a FAKE stdout stream (feed it lines incl. the sentinel, assert it signals kill promptly; feed it no sentinel, assert the backstop path) — do NOT require a real pico8 in CI; (3) screenshot-dir isolation (temp dir, ~/Desktop untouched). Done = an agent can run a cart and get back screenshots + printh + exit in one structured result, and the skill teaches the recipe. Record any envelope-shape / sentinel-string / exit-code choice in the done record.
>
> EXPANDABLE (note, not this task): two fast-follows the design should stay OPEN to (both SPIKED + tested — see `work/notes/findings/pico8-driving-input-into-a-running-cart.md`): (1) auto-inject/strip a standard screenshot+sentinel harness so the agent doesn't add debug lines by hand; (2) DRIVING INPUT into the running cart for scripted gameplay testing — `-p param_str`+`stat(6)` (one-shot canned input) or LIVE input piped to stdin + read via `serial(0x804, addr, len)` (the powerful one; GPIO is a desktop dead end). The full vision is `picopilot run --input "→→z"` (feed input) + screenshots-out = automated agent-driven playtests. Build this task OUTPUT-first (run + screenshot + printh + pico8-not-found); keep the envelope/flags open to an input arg later. Don't build input now, but don't design it out.
