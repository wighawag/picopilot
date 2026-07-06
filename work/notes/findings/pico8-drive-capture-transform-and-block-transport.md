---
title: Driving an ARBITRARY PICO-8 cart title->play and capturing LIVE gameplay (the btn/btnp->serial transform + fixed-block transport)
slug: pico8-drive-capture-transform-and-block-transport
source: 'SPIKE + PROMOTED-TO-BUILD. The transform + serial-input facts were spike-verified on PICO-8 v0.2.7 (headless -x) on 2026-07-05 (see work/notes/observations/game-jam-bench-misses-invisible-player-and-empty-sprites.md, the "SOLVED: headless live-gameplay capture" section) and in the game-jam prototype bench/game-jam/drive-capture.sh. The fixed-block + budget-drain + ACK transport was grilled + spiked to resolution on 2026-07-06 (ADR-0011). RE-VERIFIED end-to-end on 2026-07-06 while promoting the prototype into the tested picopilot playtest command: an arbitrary btnp(4) cart was driven title->play and a LIVE-gameplay screenshot (blue ball + moving HUD, past the title) captured headless, and the btnp-edge/held signals were read back frame-by-frame over printh.'
---

# Driving an arbitrary cart title->play + capturing live gameplay (the tested recipe)

This is the durable ground truth behind `picopilot playtest` (ADR-0011). It closes the run-test loop's most valuable rung: `run` boots a cart and screenshots whatever it draws on its own (a title-screen game screenshots the TITLE); `playtest` DRIVES an arbitrary cart through scripted input and captures it during ACTUAL gameplay, with NO change to the cart. It builds on the input-channel finding (`pico8-driving-input-into-a-running-cart.md`, serial `0x804` is the live host->cart channel) and the capture finding (`pico8-run-and-screenshot.md`, `-x` + `-desktop` + `extcmd("screen")` + the stdout sentinel). The NEW facts (all verified) are the three below.

## 1. Input by TRANSFORM: redefine `btn`/`btnp` to a serial channel, reconstruct `btnp` EDGES

An arbitrary game reads REAL buttons (`btn`/`btnp`); a host input channel (`stat(6)`, serial) only reaches the cart if the cart cooperates, which an arbitrary entry does not. So DON'T inject buttons, TRANSFORM the cart (on a throwaway copy): PREPEND a shim that REDEFINES the global `btn`/`btnp` (they are plain globals; shadowing overrides the built-ins, VERIFIED) to read a per-frame HELD-buttons byte the harness pipes over `serial(0x804)`. Bit `i` of the byte = button `i` held this frame (0=L 1=R 2=U 3=D 4=O 5=X).

The load-bearing subtlety is `btnp` (press) EDGES. `btnp(i)` must be true only on the frame the button TRANSITIONS 0->1, or a single scripted "press start" becomes a held-repeat that skips past menus. Reconstruct the edge from the held LEVEL: track the held value at the PREVIOUS tick and emit `btnp = held & ~prev`. VERIFIED frame-by-frame over printh: a single scripted press produces exactly ONE `btnp` edge; a hold produces one edge then held (no repeat); a release+press produces two edges. This makes any normally-written game drivable with no cart change.

Subtlety when the transport DECOUPLES input from stepping (below): `prev` must be the held level at the previous TICK (the previous frame the game actually advanced), NOT the previous host frame. Since an `INPUT` block and its following `STEP` block arrive on separate frames, update `prev = held` only AFTER a tick runs. Otherwise the edge is computed against the just-set level and is lost.

## 2. The harness OWNS the frame loop (explicit frame-stepping + freeze)

Wrap the cart's `_update`/`_update60`/`_draw` so the HARNESS drives the loop: advance exactly N frames on a STEP, and when the step-budget is 0 the game FREEZES (its callbacks skipped -> all state held, including logic wrongly placed in `_draw` -> a stable framebuffer). This makes captures DETERMINISTIC (land on the frame you intend) instead of timing-dependent (the prototype's title-vs-gameplay flakiness). Capture whichever of `_update`/`_update60`/`_draw` the cart defines AFTER the cart's code has run (an appended wrapper tab: `__drv_tick=_update`, then redefine `_update`), so it is no-op-safe for a draw-only cart. A SHOT renders the current (frozen) state ONCE via `_draw` and screenshots it AFTER the draw, so the PNG is the frame just rendered, never a stale pre-draw framebuffer.

## 3. Transport = FIXED-SIZE command blocks + one-per-frame drain + a stdout ACK

The naive "keep pico8 alive and pipe input to it" was FLAKY: small unpadded writes to a live `pico8 -x` stdin COALESCE/DROP in the OS pipe buffer (verified: 1-2 byte writes were lost/merged). The fix, verified reliable every time:

- **Fixed-size command blocks.** Every command is a block of exactly N bytes: `[opcode, arg, pad, pad]` (picopilot uses N=4). The cart reads exactly N bytes per frame via `serial(0x804, addr, N)` and BUFFERS a partial block across frames (a block split across two reads still decodes exactly once). Opcodes: `STEP<n>` / `INPUT<byte>` / `SHOT` / `PAUSE` / `QUIT`.
- **One block per frame, gated on the step-budget.** The cart drains one block per frame while the budget is 0; a `STEP<n>` sets the budget to n and the ticked callback advances while budget>0. Commands queue in order and none are lost.
- **A stdout ACK handshake.** The cart `printh`s an ACK per completed command; `printh`/stdout streams live and reliably (cart->host), the asymmetric-reliability twin of the flaky stdin. The RESUMABLE session waits on the ACK before sending the next command (fully deterministic, no wall-clock guessing); the ONE-SHOT sends the whole script up front and ignores the ACKs (the cart drains them in order anyway). Same cart-side machine for both.

## 4. Determinism for replay is OPT-IN via `--seed`

`srand(k)` fully determinizes `rnd()` (verified: identical sequences across runs; no `srand` auto-randomizes the seed on startup). The transform can inject `srand(n)` at cart start (opt-in `--seed`, NEVER silent, since it changes game behaviour), so an otherwise-random cart is replay-safe. It stays deterministic even for carts that reseed from DETERMINISTIC state (`srand(t)` under frame-stepping replays identically); it only breaks for the rare cart that reseeds from a NON-deterministic source (wall-clock/entropy) mid-run.

## Gotcha that bit the promotion (Lua truthiness, not a transform bug)

`0` and `""` are TRUTHY in PICO-8 Lua (only `false`/`nil` are falsy). A hand-written probe cart using `started=0` + `if not started then ...` never enters the branch (`not 0` == `false`), so a "press start" gate written that way appears broken. This is the cart's bug, not the driver's: idiomatic PICO-8 uses `started=false` or `started==0`. Verified the driver by reading the `btnp`/held signals back over printh directly (frame 4 edge fired on the scripted frame-3 press) rather than trusting a probe cart's own state flag.

## What this means for picopilot

- The MECHANICS live in a tested `engine/pico8` DRIVE-TRANSFORM (`drive.ts`): pure (cart text + spec in -> driven cart + encoded command blocks out), so the shim, the callback wrap, the btnp-edge, the fixed-block codec, and the opt-in `srand` are all unit-tested WITHOUT the paid binary. `picopilot playtest` is thin wiring: transform a copy, launch `-desktop <dir> -x` with a live stdin, pipe the blocks, collect the SHOT screenshots + printh, return one envelope. PICO-8 absent -> structured `pico8-not-found` (mirrors `run`); live drive-and-capture is the manual/opt-in tier.
- Transform-safety is best-effort (ADR-0011): a cart that reassigns `_update` at runtime or drives its own coroutine loop may not pause/step correctly. `playtest` is a jam/debug tool, not a sandbox.
- The generic input default (press-to-start + a few gentle O presses + a short hold + a right-nudge) reaches play for common one-button/runner/flappy shapes; an unusual control scheme passes an explicit per-cart `--input "frame:bit,..."`.
- The game-jam bench's bespoke `drive-capture.sh` is superseded by the command (the drive logic now lives in one tested place).
