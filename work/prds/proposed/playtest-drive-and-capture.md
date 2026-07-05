---
title: picopilot playtest, drive an arbitrary cart through scripted input and capture gameplay (with a resumable, steppable session)
slug: playtest-drive-and-capture
taskedAfter: [picopilot]
needsAnswers: true
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/tasks/`.

<!-- open-questions -->

## Open questions

1. **The resumable-session transport + lifecycle.** The one-shot capture (drive N frames, screenshot, exit) is fully spiked and clear. The RESUMABLE model (keep PICO-8 alive + paused between agent turns, agent looks at the last frame, injects more input, resumes) needs its coordination decided: how does the harness hold the process (a backgrounded pico8 with an open stdin the command writes to across invocations? a small local daemon the command talks to?), how does the agent address a live session (a session id / handle?), and how are pause/step/resume/inject/screenshot expressed as sub-invocations against that session? The MECHANISM is verified (live stdin streaming works; pause-by-skipping-callbacks works); the SESSION LIFECYCLE + command surface for it is not yet decided. (One-shot mode does not need this and can ship first.)
2. **How much of the loop-ownership transform is safe on arbitrary carts.** Shadowing `_update`/`_update60`/`_draw` and pausing by skipping them is spike-verified on normal, logic-in-draw, and draw-only carts. Open: carts that reassign `_update` at runtime, use `flip()` manually, or drive their own loop in a coroutine, do those break the wrapper, and is a documented "best-effort, may not pause exotic carts" caveat acceptable, or do we detect + refuse?
3. **Default generic input vs. per-cart input spec.** The generic driver (press-to-start + gentle presses + a hold + a right-nudge) reaches play for one-button/runner/flappy shapes. Is a generic default worth shipping, or should `playtest` always require an explicit input spec (and the generic one live only in the game-jam bench)?

<!-- /open-questions -->

## Problem Statement

An agent building a PICO-8 game with picopilot can render sprites and boot the cart (`picopilot run` captures whatever the cart draws), but it CANNOT drive the game through actual play to see it working. Today's gap, concretely:

- `run` boots the cart and screenshots what it does on its own; a game sitting on its title screen (waiting for a button) screenshots the TITLE, not gameplay. The agent never sees the game being played.
- `run --input` passes a one-shot `stat(6)` string, which only works if the CART was written to read `stat(6)`; an arbitrary game reads real buttons (`btn`/`btnp`), which `stat(6)` does not feed. So there is no way to drive an arbitrary entry.
- There is no way to advance a game deterministically, pause it on a chosen frame for a clean screenshot, or run a scripted playtest ("press right x5 then jump, did the player clear the gap?").

This blocks the run-test loop's most valuable rung (does it actually PLAY?) and it blocks any automated playtest / benchmark judging. It surfaced hard in the game-jam benchmark, where the judge could only ever see the title screen and had to infer playability from code.

## Solution

`picopilot playtest`: a command that DRIVES an arbitrary cart through scripted input and captures it during actual gameplay, by transforming the cart (on a throwaway copy) so the harness owns its input and frame loop:

- **Input transform (verified):** redefine the cart's global `btn`/`btnp` to read a per-frame held-buttons byte piped over serial stdin (`serial(0x804)`), reconstructing `btnp` edges from the level signal. The agent's scripted input (frame -> buttons) then drives the game as if a player were pressing buttons, with no cooperation required from the entrant.
- **Loop ownership (verified):** shadow the cart's `_update`/`_update60`/`_draw` so the harness steps the game deterministically (advance exactly N frames), PAUSE it (skip the game's callbacks -> all state freezes, including logic wrongly placed in `_draw` -> a stable framebuffer), and screenshot at exact steps. This makes capture reproducible instead of timing-dependent.
- **Two modes:**
  - **One-shot (ships first):** `playtest <cart> --input "<script>"` drives the cart through the script, captures screenshots at chosen steps + printh, returns one structured envelope. Great for scripted playtests and benchmark judging.
  - **Resumable session (the richer one):** keep PICO-8 alive and PAUSED between turns; the agent looks at the last frame, then injects more input and resumes/steps. This turns `playtest` into an interactive, agent-driven controller for a running game (see Open question 1 for the lifecycle).

The value is the tested orchestration (the transform + serial-pipe + step/pause/capture), which an agent should not hand-roll each time. Consistent with ADR-0006 (`run` is a thin orchestration command; the mechanics are PICO-8's own): `playtest` owns the drive+step+capture glue, and this is exactly the scripted-playtest fast-follow the `run` spike explicitly left open (`work/notes/findings/pico8-driving-input-into-a-running-cart.md`).

## User Stories

1. As an agent, I want `picopilot playtest <cart> --input "<script>"` to drive an arbitrary cart through a scripted button sequence and return screenshots of it during ACTUAL gameplay (not the title screen), so I can SEE my game being played and judge whether it works.
2. As an agent, I want the input to drive games written the normal way (reading `btn`/`btnp`), with NO change to my own cart, so any game I build is drivable without adding a harness by hand. (picopilot transforms a throwaway copy; my `main.p8` is untouched.)
3. As an agent, I want the input script to express per-frame button presses (e.g. "at frame 3 press O; hold O frames 20-28; press Right at 40") with correct `btnp` EDGE semantics, so a single scripted press triggers exactly one `btnp` (menus/start/single-actions behave), not a held-repeat.
4. As an agent, I want to advance the game a DETERMINISTIC number of frames and screenshot at exact steps, so my captures are reproducible and land on the frames I intend (not wherever a 30fps timer happened to be).
5. As an agent, I want to PAUSE the game on a chosen frame (freezing all state, including logic in `_draw`) and get a clean, stable screenshot of that frozen frame, so I can inspect a specific moment.
6. As an agent, I want a RESUMABLE playtest session: keep the game alive and paused, let me look at the last frame, then inject more input and resume/step, so I can play the game interactively across turns (look -> decide -> input -> look), like a human at the controls. (Lifecycle is Open question 1.)
7. As an agent, I want `playtest` to return one structured envelope (screenshot paths, captured printh/`serial(0x805)` output, the steps run, the final state), the same shape family as `run`, so I consume it uniformly.
8. As an agent, I want `playtest` to require PICO-8 and return the structured `pico8-not-found` (remedy + nonzero exit) when it is absent, mirroring `run`/`audio render`, never a crash or hang.
9. As an agent whose cart uses an unusual control scheme, I want to pass an explicit per-cart input spec (frame:button pairs), and I want a documented note that the generic driver targets common shapes (one-button/runner/flappy), so I know when to script it myself.
10. As a benchmark / eval author, I want the game-jam harness (and any future eval) to call `picopilot playtest` for its gameplay capture instead of a bespoke script, so the drive+capture logic lives in ONE tested place and the judge always sees real gameplay.
11. As a developer, I want the drive-transform to be a tested `engine/pico8` seam (cart text in -> driven cart out), so its correctness (shim injection, `_update`/`_draw` wrapping, btnp-edge reconstruction) is unit-tested without the paid binary, and the live capture is a manual/opt-in tier (mirroring `run`).

### Autonomy notes

- `humanOnly`: omitted (no part is never-for-agents by nature; the tasking is normal).
- `needsAnswers`: **true**. The resumable-session lifecycle (Open question 1) and the transform-safety + generic-input scope (2, 3) are not yet decided. The ONE-SHOT mode is fully specified and could be tasked alone; the resumable mode blocks on Q1. Task the one-shot slice first if the questions are not resolved together.

## Implementation Decisions

- **Backed by an `engine/pico8` drive-transform (TS, tested).** A pure function: cart text + input script -> a throwaway driven cart (prepend the `btn`/`btnp`->serial shim; inject the poll + wrap `_update`/`_update60`/`_draw` for step/pause; add the capture hooks). Mirrors `engine/pico8/harness.ts` (the audio-render harness) in shape and testability. The command is thin wiring over it + the existing launch/collect machinery.
- **A NEW `picopilot playtest` command, not a flag on `run` (DECIDED).** `run` = "boot it, capture what it does on its own"; `playtest` = "drive it through a script, step/pause, capture gameplay". Distinct intents and a substantially heavier mechanism; keep `run` thin. (`run --input` stays as the simple one-shot `stat(6)` path it already is.)
- **The input transform + loop ownership are VERIFIED (spikes, PICO-8 v0.2.7, headless -x):** (a) shadowing global `btn`/`btnp` overrides the built-ins; (b) `serial(0x804)` delivers one held-buttons byte/frame, frame-synced; (c) `btnp` edges reconstruct from the level signal (N presses -> N edges, not repeat); (d) pausing by skipping the game's `_update` AND `_draw` freezes ALL state (incl. logic-in-draw) and the framebuffer holds for a clean screenshot; (e) works on normal, logic-in-draw, and draw-only carts. These are the load-bearing facts; promote them from the game-jam observation to a proper finding as part of the build.
- **One-shot mode first; resumable session second.** One-shot (drive a fixed script -> capture -> exit) needs no session state and ships as the first task. The resumable session (Open question 1) is a second task blocked on that lifecycle decision.
- **PICO-8-gated, structured absence.** Same boundary as `run`/`audio render`: `pico8-not-found` structured + nonzero when absent; the CI-testable path is the transform + the absence handling, live drive is a manual/opt-in tier.
- **Reuse, do not re-invent.** Reuse `engine/pico8`'s launch + sentinel-watch + `-desktop` screenshot collection (from the `run` work); `playtest` adds the transform + the input pipe + the step/pause capture on top.

## Testing Decisions

- **Unit-test the drive-transform at the seam (no binary):** given a cart's Lua, assert the produced driven cart (i) prepends the shim defining `btn`/`btnp`, (ii) wraps whichever of `_update`/`_update60`/`_draw` exist (and is a no-op-safe when one is missing, the draw-only case), (iii) encodes a given input script into the right per-frame byte stream, and (iv) the entry's own cart bytes are untouched.
- **Unit-test btnp-edge reconstruction** as a pure function: a held-buttons-per-frame sequence -> the exact `btnp` edges it should yield (single press = one edge; hold = one edge then held; release+press = two edges).
- **pico8-not-found** structured + nonzero when PICO-8 absent (the CI path); live drive-and-capture is a manual/opt-in tier (mirror `run`'s live tier), verified by a real cart being driven title->play and a gameplay screenshot captured.
- **The game-jam bench** switches from `drive-capture.sh` to calling `picopilot playtest`; assert the bench still gets gameplay screenshots (an integration smoke, opt-in).
- **Shared-write:** screenshots + the throwaway driven cart go to a controlled/temp dir; the real `~/Desktop` / carts root are untouched (the `audio_end`/`-desktop` discipline).

## Out of Scope

- **Automated "is it FUN" judging.** `playtest` produces the gameplay capture; whether the game is good is a judge-agent's / human's call (the game-jam bench owns the rubric). `playtest` is the eyes, not the critic.
- **A general input-recording/replay format or a TAS-style tool.** The scripted input is a simple per-frame button spec, not a full input-recording ecosystem.
- **Web-export / browser playtest path.** The native `pico8 -x` + serial path is the target (ADR-0006's native-first); the web path (browser canvas + GPIO input) stays a non-foreclosed alternative, not built here.
- **Replacing `run` or `run --input`.** Those keep their simple boot/one-shot roles; `playtest` is the heavier driven-playtest sibling.

## Further Notes

- Origin: this grew out of the game-jam benchmark (`packages/picopilot/bench/game-jam`), where the drive+capture was prototyped in `drive-capture.sh` and the judge could otherwise only see the title screen. The observation `work/notes/observations/game-jam-bench-misses-invisible-player-and-empty-sprites.md` records the spike results; promote them to a finding during the build.
- The resumable-session model (US #6, Open question 1) is the most novel and highest-value piece: it makes an agent a live player of its own game (look at a frame, decide, input, look again). It also composes with the existing `printh`/`serial(0x805)` output channel for the cart to report state back. Worth its own grilling pass before tasking.
- Relationship to `run`: `run` should probably grow a CTA to `playtest` ("it boots, now drive it and watch it play"), closing the boot -> play loop the way `verify` -> `run` closes the static -> boots loop.
