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

## The immediate one-off fix (for the sample entry)

`bench/out/one-button` was repaired by hand for viewing: drew a bird into sprite 1 with `gfx set 1` (a yellow bird, eye, beak), so the sample is now actually playable/visible. The FINDING (the benchmark gap) is what matters for (i).
