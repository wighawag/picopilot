---
name: game-jam
description: Build a complete, original, playable PICO-8 game against a deadline and a theme. Use for a game jam, a timed game-build, or a jam benchmark run. Carries the clock discipline; applies the universal design principles via game-design-reference.
---

# game jam

A jam is building a GOOD game (the universal part) UNDER A CLOCK and to a THEME (the jam part). This skill carries only the jam-specific part; the design principles live in `game-design-reference`.

**Read and apply `game-design-reference` throughout this jam.** It is the shared body of universal principles (fairness / no dead state, human reaction budget, visibility, readability, difficulty curve, and the originality method). This skill does not repeat them; it tells you the calls they force when you are racing a clock. Use the picopilot loop skills as you go: `picopilot-overview` (the `#include` layout + verify loop), `picopilot-code` (the token budget), `picopilot-art` / `picopilot-audio` (assets), and `picopilot-debug` (run + playtest, your eyes on the running game).

## Interpret the theme yourself

The theme is a seed, not a brief. YOU interpret it into a game. Run `game-design-reference`'s originality method and self-check on the bare theme and commit to your OWN idea, do not wait to be told what to build, and do not settle for the obvious version. This is where the jam is won or lost: a fresh, well-chosen idea sets your ceiling.

## The clock: slice, deepen, triage

Three phases you map onto whatever time budget you are given, not a rigid schedule:

- **SLICE (first third).** Get to a PLAYABLE slice fast. A playable slice = it boots, responds to input (the button actually changes what happens), and has a goal with a win/lose, and `verify` is green. Scope tiny: one screen, one mechanic, one goal. A rough playable game scores; a broken ambitious one scores zero.
- **DEEPEN (middle).** Improve the game that already works, without breaking it. Add readability/feedback, a difficulty ramp that introduces mechanics (not more-of-the-same), audio, content, juice, gated behind a green `verify` each step. Keep it playable at every checkpoint.
- **TRIAGE (last stretch).** Stop adding features. Confirm it boots and is playable, finalise the writeup. But "stop adding features" is NOT "stop improving": if you have found a real design DEFECT (below), fixing it beats holding, and beats gold-plating. Do not idle a proven build if it still has a fairness or playability flaw.

## The design calls the clock forces

When you find one of these under time pressure, this is the jam-time decision (the principle is in `game-design-reference`):

- **A dead state (unfair forced-loss).** You found a spot where the player has no non-losing move. FIX IT even late: a dead state tanks the playability/fairness a judge and a player feel far more than a missing feature costs. This outranks polish.
- **A superhuman level (frame-perfect tuning).** You tuned a level against your own frame-perfect `--input` scripts and only YOU can clear it. Budget a reaction margin (widen the window, add telegraphing) before you call it done. If a human with ~250ms reaction cannot clear it, it is not done, it is broken.
- **An invisible entity.** You `spr()` something that is an empty slot, or the player cannot tell player from hazard from goal. Fix visibility/readability before anything else; an unreadable game is unplayable.

Do not declare "done, holding" while any of these is unfixed. The plateau trap is stopping because you cannot SEE what to improve, run the `game-design-reference` self-checks (fairness: test hazard-avoidability from every rest state, not just reachability; reaction: could a human clear this) precisely to find the work that remains.

## Finish

At the deadline you ship: a playable `main.p8` (boots, responds, has win/lose, `verify` green) and a short `JAM.md` (theme interpretation, the mechanic, controls, and the honest calls you made under the clock). A rough playable game with a fresh idea beats a broken ambitious one, every time.
