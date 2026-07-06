---
title: A picopilot playtest REPLAY — record a run's exact input timeline so it can be deterministically re-driven and watched
slug: playtest-replay-record-and-replay
status: proposed
---

# playtest replay: save what the agent (or a human) actually played, and replay it

## The observation that prompts this

After the 50-minute jam run, the user played the entry and found real design defects (a forced-loss trap, superhuman difficulty). To reason about WHY the agent shipped them, we had to reconstruct what the agent played by reading its playtest `--input` strings out of the pi session log. There is no first-class artifact that says "here is exactly the run: this input timeline, on this cart, producing these frames." The user asked for a replay feature: "save the run in a folder so later we can inspect exactly what the agent played."

## The idea

`playtest` already DRIVES a cart via a scripted input timeline (btn/btnp -> serial transform, harness-owned frame loop, ADR-0011) and captures screenshots. A REPLAY is the natural next capability on top of that same transform:

- **Record.** On any `playtest run` / live session, persist the full run as a self-contained REPLAY artifact in a folder: the exact input timeline (frame -> button events), the cart identity (path + hash), the frame count / seed / any determinism inputs, and the captured shots. Enough to re-drive it identically.
- **Replay.** `picopilot playtest replay <artifact>` re-drives the SAME cart with the SAME input timeline deterministically, reproducing the run (and re-capturing shots / a strip / a gif). So a human, a judge agent, or a later debugging session can watch exactly what happened, not a paraphrase.

This directly attacks the root cause behind the two design defects: the agent currently treats playtest as a throwaway PROBE. A durable, replayable run turns a play into an inspectable artifact — closer to seeing the game as a played thing, and a substrate for a future "fairness probe" (drive every rest state, assert a non-fatal move exists) and for the game-design self-checks.

## Scope forks to decide (grill before PRD)

- **Minimal vs rich.** Minimal = record the input timeline + cart hash + a way to re-drive it deterministically (re-capture shots on replay). Rich = also emit a video/gif/frame-strip of the run as a watchable artifact. Determinism caveat: PICO-8 `rnd()` without a seeded state is not reproducible; a faithful replay may need the cart to be seed-controllable, or we accept "same inputs, possibly divergent RNG" and document it. Decide how hard the determinism guarantee is.
- **Where it lives.** A new `playtest replay` verb + a `--record <dir>` on `playtest run`/session? Or is record always-on into the shot-dir? The jam harness would opt in so every bench entry carries its replay.
- **Relationship to the existing capture.** The bench already saves shots-play/*.png + driven.p8 + drive.json. Replay generalizes drive.json into a re-drivable format. Don't duplicate; extend.
- **Reuse.** This is the same drive-transform + block transport (ADR-0011/0012); replay should be a thin layer, not a second engine. Confirm the seam.

## How it gets built

Product code -> a proper PRD (grill it: scope, determinism guarantee, verb shape, artifact format), then tasks, then build via the dorfl drive-tasks conductor (propose mode, no gate-2; the user does gate-3 review + merge). NOT a jam-prompt tweak.

## When to pick it up

After the game-design/game-jam skill-method pass + fresh jam run (the user's stated order). Capture now so it is not lost; PRD it once the skill experiment has run and the replay shape is clearer (the fairness-probe angle may sharpen the requirements).
