---
title: picopilot playtest, drive an arbitrary cart through scripted input and capture gameplay (with a resumable, steppable session)
slug: playtest-drive-and-capture
taskedAfter: [picopilot]
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/tasks/`.
>
> GRILLED 2026-07-06: the design tree (execution unit, transport, reliability, session model, determinism) was walked and resolved with spikes; the open questions are now Implementation Decisions and `needsAnswers` is cleared. The reliable transport (fixed-size command blocks + budget-gated one-per-frame drain + a stdout ACK handshake) is VERIFIED on PICO-8 v0.2.7.

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
- `needsAnswers`: omitted (cleared). The design tree was grilled + spiked to resolution (transport, session model, determinism, transform-safety); the decisions are recorded below. Task the ONE-SHOT slice first (Task 1), the RESUMABLE session second (Task 2); both build on the same verified cart-side machine, so the split does not foreclose the resumable model.

## Implementation Decisions

- **A NEW `picopilot playtest` command, not a flag on `run` (DECIDED).** `run` = "boot it, capture what it does on its own"; `playtest` = "drive it through a script, step/pause, capture gameplay". Distinct intents and a substantially heavier mechanism; keep `run` thin. (`run --input` stays as the simple one-shot `stat(6)` path it already is.)
- **Execution unit = explicit FRAME-STEPPING, harness owns the loop (DECIDED, GRILLED).** The transform gates the cart's frame advance on a step-budget the harness controls: "advance N frames" runs exactly N, then the game FREEZES (its `_update`/`_draw` are skipped, all state held, the framebuffer stable) until the next command. This makes captures DETERMINISTIC (not timing-dependent, which is why the prototype flaked title-vs-gameplay), and it makes one-shot and resumable the SAME cart-side machine: one-shot sends the whole opcode script upfront and exits; resumable sends opcodes across turns. So building one-shot cannot foreclose resumable.
- **Transport = a tagged opcode protocol over stdin, with a VERIFIED reliability recipe (DECIDED, SPIKED).** On the native `-x` path, `serial(0x804)` (stdin) is the only live host->cart channel (`printh`/stdout is the reliable cart->host channel). The reliability recipe, verified byte-for-byte on PICO-8 v0.2.7: (1) send FIXED-SIZE command blocks (e.g. 16 bytes, opcode + args + pad) - small unpadded writes to a live `-x` stdin COALESCE/drop in the OS pipe buffer (the root cause of the prototype's flakiness); a fixed block per flush delivers reliably. (2) The cart reads exactly one block per frame and drains it against the step-budget, so commands queue IN ORDER and none are lost. (3) A stdout ACK handshake: the cart `printh`s an ACK when a command completes (e.g. a STEP's frames are done), and the host WAITS for the ACK before sending the next command - fully deterministic, no wall-clock guessing. Opcodes: STEP<n>, INPUT<held-buttons-byte>, SHOT, PAUSE, QUIT. The shim buffers partial blocks across frames.
- **Backed by an `engine/pico8` drive-transform (TS, tested).** A pure function: cart text + input script -> a throwaway driven cart (prepend the `btn`/`btnp`->serial shim with btnp-edge reconstruction; wrap `_update`/`_update60`/`_draw` for budget-step/pause; inject the opcode decoder + ACK + capture hooks; optionally inject a fixed `srand`, see determinism). Mirrors `engine/pico8/harness.ts` (the audio-render harness) in shape and testability. The command is thin wiring over it + the existing launch/collect machinery. The entry's own cart is UNTOUCHED (transform runs on a throwaway copy).
- **The input transform + loop ownership are VERIFIED (spikes, PICO-8 v0.2.7, headless -x):** (a) shadowing global `btn`/`btnp` overrides the built-ins; (b) `serial(0x804)` delivers input frame-synced; (c) `btnp` EDGES reconstruct from the level signal (N presses -> N edges, not held-repeat); (d) pausing by skipping the game's `_update` AND `_draw` freezes ALL state (incl. logic wrongly placed in `_draw`) and the framebuffer holds for a clean screenshot; (e) works on normal, logic-in-draw, and draw-only (no-`_update`) carts. Promote these from the game-jam observation to a proper finding as part of the build.
- **Session model: build A (live daemon) as the resumable feature; C (stateless replay) comes FREE from one-shot (DECIDED, GRILLED).** Two ways to be "resumable": (A) a LIVE session - a persistent driven pico8 the agent addresses by a SESSION ID across turns (`playtest start <cart>` -> id; `playtest step/input/shot/stop <id>`), the true look->inject->look controller. (C) STATELESS REPLAY - re-run one-shot with an ACCUMULATING opcode script (all prior input + the new input) and screenshot the end; the "session" is just the growing script. C needs NO new command: an agent already gets it by re-invoking one-shot, so we DOCUMENT the pattern (and optionally a thin convenience) rather than build a second engine. A is the dedicated Task 2. Support both.
- **Determinism for replay (C): the transform can inject a fixed `srand(seed)` (DECIDED, SPIKED).** C is only reproducible if the cart is deterministic. Verified: `srand(k)` fully determinizes `rnd()` (identical sequences across runs); with NO `srand`, PICO-8 auto-randomizes the seed on startup (diverges run-to-run). So the transform offers an OPT-IN `--seed <n>` that injects `srand(n)` at cart start, making an otherwise-random cart replay-safe. Boundary (verified + documented): deterministic for no-`rnd` carts, fixed-seed carts, AND carts that reseed from DETERMINISTIC state (`srand(t)`, `srand(x)`) - because that state replays identically under frame-stepping. It only breaks for the rare/weird cart that reseeds from a NON-deterministic source mid-run (wall-clock/entropy); that is a documented, accepted limitation of C (A does not have it, since A keeps the live process). `--seed` is OPT-IN, never silent, because forcing a seed changes game behaviour.
- **PICO-8-gated, structured absence.** Same boundary as `run`/`audio render`: `pico8-not-found` structured + nonzero when absent; the CI-testable path is the transform + the absence handling, live drive is a manual/opt-in tier.
- **Transform-safety on exotic carts = best-effort with a documented caveat (DECIDED).** Shadowing `_update`/`_update60`/`_draw` covers the normal, logic-in-draw, and draw-only cases (verified). A cart that reassigns `_update` at runtime or drives its own loop in a coroutine may not pause/step correctly; `playtest` states it is best-effort for such exotic carts rather than trying to detect+refuse every case (a jam/debug tool, not a sandbox).
- **Generic input default + explicit override (DECIDED).** `playtest` ships a generic driver (press-to-start + a few gentle presses + a short hold + a right-nudge) that reaches play for common shapes (one-button/runner/flappy), AND accepts an explicit per-cart input script (frame:button opcodes). The generic default makes "just show me it playing" one call; the explicit script is there when the control scheme is unusual (US #9).
- **Reuse, do not re-invent.** Reuse `engine/pico8`'s launch + sentinel-watch + `-desktop` screenshot collection (from the `run` work); `playtest` adds the transform + the input pipe + the step/pause/ACK capture on top.

## Testing Decisions

- **Unit-test the drive-transform at the seam (no binary):** given a cart's Lua, assert the produced driven cart (i) prepends the shim defining `btn`/`btnp`, (ii) wraps whichever of `_update`/`_update60`/`_draw` exist (no-op-safe when one is missing, the draw-only case), (iii) encodes a given input/opcode script into the right FIXED-SIZE command blocks, (iv) injects `srand(n)` iff `--seed` is given, and (v) the entry's own cart bytes are untouched.
- **Unit-test btnp-edge reconstruction** as a pure function: a held-buttons-per-frame sequence -> the exact `btnp` edges it should yield (single press = one edge; hold = one edge then held; release+press = two edges).
- **Unit-test the opcode/block codec** as a pure function: a script of STEP/INPUT/SHOT/PAUSE/QUIT -> the exact fixed-size byte blocks; and the shim's block-buffering across frames (a block split across two reads still decodes once).
- **Determinism:** assert `--seed n` yields a driven cart that produces identical `rnd`-dependent output across runs (the C-replay precondition); no `--seed` does not inject `srand`.
- **pico8-not-found** structured + nonzero when PICO-8 absent (the CI path); live drive-and-capture is a manual/opt-in tier (mirror `run`'s live tier), verified by a real cart being driven title->play + a gameplay screenshot, and (Task 2) a live session stepped/paused/screenshotted/resumed with the ACK handshake.
- **The game-jam bench** switches from `drive-capture.sh` to calling `picopilot playtest`; assert the bench still gets gameplay screenshots (an integration smoke, opt-in).
- **Shared-write:** screenshots + the throwaway driven cart go to a controlled/temp dir; the real `~/Desktop` / carts root are untouched (the `audio_end`/`-desktop` discipline).

## Out of Scope

- **Automated "is it FUN" judging.** `playtest` produces the gameplay capture; whether the game is good is a judge-agent's / human's call (the game-jam bench owns the rubric). `playtest` is the eyes, not the critic.
- **A general input-recording/replay format or a TAS-style tool.** The scripted input is a simple per-frame button spec, not a full input-recording ecosystem.
- **Web-export / browser playtest path.** The native `pico8 -x` + serial path is the target (ADR-0006's native-first); the web path (browser canvas + GPIO input) stays a non-foreclosed alternative, not built here.
- **Replacing `run` or `run --input`.** Those keep their simple boot/one-shot roles; `playtest` is the heavier driven-playtest sibling.

## Further Notes

- Origin: this grew out of the game-jam benchmark (`packages/picopilot/bench/game-jam`), where the drive+capture was prototyped in `drive-capture.sh` and the judge could otherwise only see the title screen. The observation `work/notes/observations/game-jam-bench-misses-invisible-player-and-empty-sprites.md` records the spike results; promote them to a finding during the build.
- The resumable-session model (US #6, Task 2) is the most novel and highest-value piece: it makes an agent a live player of its own game (look at a frame, decide, input, look again). It composes with the `printh`/stdout ACK channel (the cart reports state/acks back). GRILLED 2026-07-06; the transport + lifecycle are decided (see Implementation Decisions).
- **C (stateless replay) is free from one-shot:** an agent can already "resume" by re-invoking one-shot with an accumulating opcode script (+ `--seed` for determinism), re-running from frame 0 each time. Cheap for short games, perfectly reproducible, no daemon. A (live daemon) exists for true live continuity / long or replay-unsafe games. Document C's pattern in the `picopilot-debug` skill; A is the built session command.
- Relationship to `run`: `run` should grow a CTA to `playtest` ("it boots, now drive it and watch it play"), closing the boot -> play loop the way `verify` -> `run` closes the static -> boots loop.
- Grilling record (2026-07-06): resolved execution-unit (frame-stepping), transport (fixed-size blocks + one-per-frame drain + stdout ACK handshake, the flakiness was small-write pipe coalescing), session model (build A, C is free), and determinism (opt-in `--seed`, breaks only on non-deterministic mid-run reseed). All spike-verified on PICO-8 v0.2.7.
