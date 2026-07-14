---
title: playtest (one-shot), drive an arbitrary cart through a scripted input and capture live gameplay
slug: playtest-one-shot-drive-capture
spec: playtest-drive-and-capture
blockedBy: []
covers: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
---

## What to build

`picopilot playtest <cart> [--input "<script>"] [--seed <n>]`, a new command that DRIVES an arbitrary cart through a scripted button sequence and captures it during ACTUAL gameplay (not the title screen), returning one structured envelope (screenshot paths + captured printh + the steps run). This is the "does it actually PLAY?" rung the run-test loop is missing, and it makes any game an agent builds drivable with NO change to that game's cart.

The whole design is DECIDED + spike-verified in the prd (`work/specs/tasked/playtest-drive-and-capture.md`, Implementation Decisions) and the game-jam prototype (`packages/picopilot/bench/game-jam/drive-capture.sh`). Build the ONE-SHOT slice: the full input/opcode script is known up front, so the driven cart runs the script to completion and exits (no live session). The resumable session is a separate later task on the same machine.

End-to-end vertical (transform seam -> command -> capture -> tests):

- **`engine/pico8` drive-transform (new, pure, TS-tested):** a function taking a cart's text + a driven-run spec and producing a THROWAWAY driven cart (the entry's own cart is UNTOUCHED). It must, per the prd's verified recipe:
  - Prepend a shim that REDEFINES the global `btn`/`btnp` to read a per-frame held-buttons byte from `serial(0x804)`, RECONSTRUCTING `btnp` edges from the level signal (a single scripted press = exactly one `btnp` true frame, not held-repeat).
  - Wrap whichever of `_update`/`_update60`/`_draw` the cart defines so the harness OWNS the frame loop: advance exactly N frames on a STEP, and when the step-budget is 0 the game is frozen (its callbacks skipped -> all state held incl. logic-in-`_draw` -> a stable framebuffer). No-op-safe when a callback is missing (the draw-only cart).
  - Decode a tagged OPCODE protocol from `serial(0x804)` in FIXED-SIZE command blocks (STEP<n> / INPUT<byte> / SHOT / PAUSE / QUIT), buffering partial blocks across frames. Fixed-size blocks are load-bearing: small unpadded writes to a live `-x` stdin coalesce/drop in the OS pipe buffer.
  - Optionally inject `srand(<n>)` at cart start iff `--seed` is given (opt-in, never silent), for deterministic replay.
- **The `playtest` command (thin wiring):** transform a copy of the cart, launch it via `engine/pico8` (reuse the launch + `-desktop` screenshot collection from the `run` work), pipe the encoded input/opcode script as fixed-size blocks, capture screenshots at the SHOT points, and return the structured envelope. Reuse the `pico8-not-found` structured-absence path (mirror `run`/`audio render`). A generic input default (press-to-start + a few gentle presses + a short hold + a right-nudge, reaching play for one-button/runner/flappy shapes) applies when `--input` is omitted; an explicit per-cart script overrides it.
- **Promote the spike facts to a finding:** turn the verified transport/transform facts (currently in `work/notes/observations/game-jam-bench-misses-invisible-player-and-empty-sprites.md`) into a proper `work/notes/findings/` doc with a `source:` line, so later work builds on cited ground truth.
- **Switch the game-jam bench to call `picopilot playtest`** instead of its bespoke `drive-capture.sh` (the bench keeps working, the drive logic now lives in one tested place).

## Acceptance criteria

- [ ] The drive-transform is unit-tested at the seam (NO binary): given a cart's Lua, the produced driven cart (i) prepends the `btn`/`btnp` shim, (ii) wraps whichever of `_update`/`_update60`/`_draw` exist and is no-op-safe when one is missing (draw-only), (iii) encodes a given script into the exact FIXED-SIZE command blocks, (iv) injects `srand(n)` iff `--seed` given, (v) leaves the entry's own cart bytes untouched.
- [ ] `btnp`-edge reconstruction is unit-tested as a pure function (single press = one edge; hold = one edge then held; release+press = two edges).
- [ ] The opcode/block codec is unit-tested (a script -> the exact blocks; a block split across two reads still decodes once).
- [ ] `--seed n` makes an otherwise-random cart's `rnd`-dependent output identical across runs (the replay precondition); no `--seed` does not inject `srand`.
- [ ] PICO-8 absent -> structured `pico8-not-found` + nonzero exit (the CI-testable path), never a crash/hang.
- [ ] Live drive-and-capture is a MANUAL/opt-in tier (mirror `run`'s live tier): verified by a real cart being driven title->play and a gameplay screenshot captured (not the title).
- [ ] The game-jam bench uses `picopilot playtest` and still produces gameplay screenshots (an opt-in integration smoke).
- [ ] **Shared-write:** the throwaway driven cart + screenshots go to a controlled/temp dir; the real `~/Desktop` / carts root are asserted untouched.

## Blocked by

- None, can start immediately. `engine/pico8` (the `Pico8Adapter` seam, launch + `-desktop` capture, `pico8-not-found`) and `engine/pico8/harness.ts` (the throwaway-harness pattern to mirror) already exist from the `run` / `audio render` work.

## Prompt

> Goal: build `picopilot playtest <cart>` (one-shot), drive an ARBITRARY cart through a scripted input and capture it during LIVE gameplay, so an agent can SEE its game being played. Backed by a tested `engine/pico8` drive-transform. The design is CLOSED and spike-verified; this is "implement the decided recipe", not open design.
>
> FIRST read the binding spec + prior art:
> - `work/specs/tasked/playtest-drive-and-capture.md`, the Implementation Decisions carry the full verified recipe (frame-stepping; the `btn`/`btnp`->`serial(0x804)` transform with btnp-edge reconstruction; the FIXED-SIZE command-block transport + one-per-frame budget drain + the stdout ACK handshake; the opt-in `--seed` determinism; transform-safety/best-effort; generic-input default). Every fact there was verified on PICO-8 v0.2.7.
> - `packages/picopilot/bench/game-jam/drive-capture.sh` + `check-playable.sh`, the working prototype of the transform + capture (the thing you are promoting into a tested command).
> - `work/notes/findings/pico8-driving-input-into-a-running-cart.md` and `pico8-run-and-screenshot.md`, the serial-input + headless-run + `-desktop` capture ground truth.
> - `work/notes/observations/game-jam-bench-misses-invisible-player-and-empty-sprites.md`, the spike results to promote into a proper finding.
>
> Drift-check: confirm `engine/pico8` still exposes the `Pico8Adapter` launch + `-desktop` screenshot collection + the `pico8-not-found` value (from `run-command-and-debug-skill`), and that `engine/pico8/harness.ts` is the throwaway-harness pattern to mirror. Build the transform as a pure `engine/pico8` module next to `harness.ts`; the command is thin wiring.
>
> KEY correctness points (get these exactly right, they are the load-bearing verified facts): (1) reconstruct `btnp` EDGES, do not just pass the held level; (2) send FIXED-SIZE command blocks (small unpadded writes to live `-x` stdin COALESCE/drop, the root cause of the prototype flakiness); (3) drain one block per frame gated on the step-budget; (4) pausing skips BOTH `_update` and `_draw` so logic-in-draw also freezes; (5) the entry's own cart is never mutated (transform a copy). This one-shot task sends the whole script up front and exits; do NOT build a live session (that is the resumable task) but DO structure the transform + protocol so the resumable task reuses it unchanged.
>
> PICO-8 CLI FOOTGUN: never run `pico8 --help`/`--version`/bare `pico8` (they launch the GUI and HANG). Only `pico8 -x <cart> </dev/null` with a `timeout` backstop; read the manual for flags. (See `pico8-gotchas.md` section 0.)
>
> Seam to test at: the pure transform + the btnp-edge + the opcode/block codec + `--seed` determinism (all no-binary CI tests) + `pico8-not-found`. Live drive-and-capture is a manual/opt-in tier. Done = an agent runs `picopilot playtest <cart>` and gets gameplay screenshots (not the title), or a clean `pico8-not-found` when PICO-8 is absent; and the game-jam bench uses the command.
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block (the exact block size + opcode encoding, the generic-input default, the command's flag surface, the finding you promoted). If any clears the ADR bar (`ADR-FORMAT.md`), write it up (the transport recipe is a strong candidate).
