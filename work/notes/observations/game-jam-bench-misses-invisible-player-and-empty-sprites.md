---
title: The game-jam benchmark's Tier-0/1 capture misses "player is invisible" (spr() of an empty sprite) and other playability-but-not-visible defects
slug: game-jam-bench-misses-invisible-player-and-empty-sprites
spotted: 2026-07-05
---

# Game-jam bench: "boots + verify green" is not "playable"; the invisible-player gap

Spotted while inspecting the first game-jam benchmark smoke-test entry (`bench/out/one-button`, theme "one button", 3-minute budget). The agent shipped a working flappy-style game (physics, walls, collision, score, states) that PASSES verify (420 tokens) and BOOTS headless, but **the player character is INVISIBLE**: the draw code does `spr(1, ...)` for the bird, but sprite 1 is an all-transparent (empty) `__gfx__` slot, so the player never appears on screen. A human immediately said "I cannot see where I am as a player." The game is unplayable in practice despite passing every automated gate.

## Why the benchmark missed it

The v1 harness's Tier-0/1 capture checks: `verify` (static: tokens + lint + integrity), `run` boots (headless, screenshots exist), `run --input` (screens differ = responds). NONE of these catches "a referenced sprite is empty" or "the entity the player controls is not visible", because:
- `verify` is static and does not know `spr(1)` needs a non-empty sprite 1.
- "boots + screenshots exist" is satisfied by a game whose player is invisible.
- the input-response heuristic can pass on wall movement / state changes even if the avatar is unseen.

So "boots + verify green" is demonstrably NOT "playable". This is the ADR-0003 lesson (static gate != runs) extended one level: even "runs" != "playable/visible".

## Fixes for the proper build (i)

- **A "referenced-sprite is non-empty" static check.** Grep the Lua for `spr(<n>` / `sspr` sprite ids and assert each referenced `__gfx__` slot is non-empty (a cheap, high-value playability lint; could even land in `picopilot verify`/`lint` generally, not just the bench). Same idea for `sfx(<n>)`/`music(<p>)` referencing empty slots (a WARN, since silence is legal).
- **Judge must LOOK for the avatar.** The Tier-2 judge rubric should explicitly check "can you see the player / the thing you control in the gameplay screenshots?" as part of the PLAYABLE axis, not just "does something render". The judge is multimodal; make it look.
- **Better gameplay screenshots.** The v1 capture often catches the title or game-over screen (the scripted `--input` did not reliably drive the cart into active play), so the judge may never see actual gameplay. The harness should force the cart into its play state for the capture (e.g. auto-press start + hold an input), or capture a longer sequence, so "is the player visible DURING PLAY" is actually observable.
- **Persist entries.** (Separate rough edge:) v1 wrote entries into a `mktemp` dir that got cleaned up, losing the game; entries should land in a persistent `bench/out/<theme>-<ts>/` by default so nothing is lost.

## FIXED in the harness (run 2, verified)

The invisible-player class is now prevented + caught: (1) `prompt.md` tells the agent every `spr(n)` id must be a drawn sprite, and offers the safe alternative of drawing the player with primitives (`circfill`/`rectfill`); (2) `check-playable.sh` greps the Lua for `spr(n)`/`sfx(n)` and asserts non-empty slots, emitting `PLAYABLE-CHECK: ok|issues`; (3) the harness runs it BETWEEN turns and folds any `INVISIBLE` finding into the steering message, and again at capture. Verified: a re-run on the same theme produced a game whose player is a `circfill` ball (the agent explicitly followed the primitives nudge), `PLAYABLE-CHECK: ok`, and the judge scored it 74/100.

## SOLVED: headless live-gameplay capture via an input-transform (drive-capture)

The live-gameplay capture gap (below) is now SOLVED and spike-verified. `drive-capture.sh` transforms a THROWAWAY copy of the entry: it PREPENDS a shim that redefines the global `btn`/`btnp` to read a per-frame held-buttons byte piped over serial stdin (`serial(0x804, ...)`), reconstructing `btnp` EDGES from the level signal (track previous frame, emit true only on 0->1); inserts `__drv_poll()` at the top of the cart's `_update`; and pipes a scripted input byte-stream. Spike results (PICO-8 v0.2.7, headless `-x`): (1) shadowing `btn`/`btnp` overrides the built-ins; (2) serial `0x804` delivers one byte/frame frame-synced (verified `f3 held=16` matched the scripted press at frame 3); (3) btnp-edge reconstruction is correct (2 scripted presses -> `btnp==true` exactly twice, not held-repeat); (4) END-TO-END: transformed run-2's real `btnp(4)` game, drove it from title into play (`started=1` at f4), and captured a LIVE-gameplay screenshot (blue ball + scrolling spike + score HUD, past the title). Wired into `run-jam.sh` as the `shots-play/` capture, and the judge now reads those. The generic input (press to start + a few gentle O presses + a short hold + a right-nudge) reaches play for one-button/runner/flappy shapes; a per-entry input spec can be passed if needed.

## (superseded) The original open problem

The judge (run 2) correctly noted the capture screenshots showed the TITLE screen, not live gameplay, so responsiveness had to be read from the code. Root cause (cross-checked against `pico8-driving-input-into-a-running-cart.md`): a jam game reads REAL buttons (`btnp(4)`), but headless input channels (`stat(6)` via `-p`, serial `0x804`) only work if the CART COOPERATES by reading them, which an arbitrary entry does not. Poking the button-state memory at `0x5f4c` (8 bytes, documented) DOES make `btn(i)` read as pressed when poked before the game reads it (verified: `poke(0x5f4c,0x10)` -> `btn(4)==true`), but reliably producing `btnp` (edge) transitions that drive a specific game from title into active play is game-specific and did not work generically in-session. So: automated capture reliably proves BOOTS + PLAYER-VISIBLE + title/menu renders; proving LIVE gameplay is not yet automatable for arbitrary entries. Mitigations for (i): (a) tell entrants (in the prompt) to auto-start into play after N idle frames (or expose a debug auto-play), so the capture sees gameplay; (b) drive `btnp` by pulsing `0x5f4c` with released frames in between and tune timing; (c) accept the judge reading code + the title shot for the loop, and only require the player-visible-on-some-screen check. Lower-priority than the invisible-player fix, which is done.

## The immediate one-off fix (for the sample entry)

`bench/out/one-button` was repaired by hand for viewing: drew a bird into sprite 1 with `gfx set 1` (a yellow bird, eye, beak), so the sample is now actually playable/visible. The FINDING (the benchmark gap) is what matters for (i).
