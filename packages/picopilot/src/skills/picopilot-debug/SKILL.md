---
name: picopilot-debug
description: Close the run-test loop for a PICO-8 cart with picopilot. Run the cart headless and read printh output, use the static verify gate honestly (well-formed is not proven-to-run), and understand the structured pico8-not-found / shrinko-not-found boundaries. Use when a cart misbehaves or you need to confirm it boots.
---

# picopilot debug

Static checks tell you a cart is well-formed; only running it tells you it works.
picopilot gives you both a static gate and a headless run so you can drive a
closed loop. (See `picopilot-overview` for the `#include` discipline and
`picopilot-code` for the token loop.)

## Static first: `picopilot verify`

`picopilot verify` runs tokens + integrity and returns ONE structured pass/fail
envelope. It is STATIC and NEVER runs the cart, so:

- A green verify means "well-formed", NOT "it runs". The passing result points
  you at `picopilot run` to confirm the cart boots. Do not stop at green.
- A fail lists WHICH check flunked (over budget, or a malformed cart), so you fix
  the named thing.
- With shrinko absent, verify is `gate-incapable` (a distinct nonzero outcome,
  NEVER green): it cannot check token bloat, so it refuses to report pass.

## Then run it: `picopilot run`

`picopilot run <cart>` launches PICO-8 headless (`pico8 -x`), streams stdout,
ENDS the run the moment the cart prints a done-sentinel, and collects one
structured result: the screenshot PNG paths, the captured `printh` stdout, and
the exit reason (`sentinel` / `timeout` / `exit`). Read the screenshots to SEE
the running game; read printh for text traces. On a backstop `timeout` it CTAs
you to `verify`/`tokens` to catch a code fault.

`run` requires PICO-8 (a licensed, paid binary with no pip/npm path). If PICO-8
is absent, `run` returns a structured `pico8-not-found` result with a remedy
(`set PICO8_PATH or install PICO-8`) and a nonzero exit, not a crash or a hang.
Use the static `verify` loop while PICO-8 is unavailable; it never needs it.

### NEVER run `pico8 --help` / `--version` / bare `pico8` (they BLOCK your tool call)

PICO-8 is a GUI app with NO headless diagnostic mode. `pico8 --help`,
`pico8 --version`, and bare `pico8` do NOT print text and exit like a normal
CLI, they LAUNCH THE INTERACTIVE APP and hang forever (verified: `timeout 5
pico8 --help` exits 124 with zero output). Running one from an agent/automation
context STALLS your own tool call indefinitely (it has already bitten this
project's agents more than once, hanging a whole build). Do NOT invoke `pico8`
to "see its flags" or check it works. The only safe, non-blocking calls are the
automation ones, ALWAYS with `</dev/null` + a `timeout` backstop:
`pico8 -x <cart>`, `pico8 -run <cart>`, `pico8 <cart> -export foo.p8.png`. And
prefer to let picopilot (`run`, `audio render`, etc.) shell out for you rather
than calling `pico8` by hand. To learn a CLI flag, read the PICO-8 manual, never
ask the binary.

### The cart must COOPERATE (the recipe `run` orchestrates)

There is no "screenshot an arbitrary running cart" hook and a cart CANNOT quit
the PICO-8 app itself (`extcmd("shutdown")` works only in EXPORTED binaries).
So the cart takes its own screenshots and signals when it is done, and `run`
does the watch + kill + collect. Add these debug lines to the cart, run, then
remove them:

```lua
-- screenshot on a frame timer (the verb is "screen", NOT "screenshot")
if t==20 then extcmd("set_filename","frame_0") extcmd("screen") end
if t==40 then extcmd("set_filename","frame_1") extcmd("screen") end
-- signal done so run kills PICO-8 promptly (it can't self-quit)
if t==45 then printh("__PICOPILOT_DONE__") end
```

Load-bearing details (each an easy wrong guess, all tested):

- The screenshot verb is **`extcmd("screen")`**. `extcmd("screenshot")` ERRORS
  ("unknown extcmd"). `extcmd("set_filename","frame_0")` before it names the next
  shot deterministically (so you can read `frame_0.png`, `frame_1.png`, ... in
  order and PERCEIVE MOTION by comparing frames).
- The done-sentinel is the default `__PICOPILOT_DONE__` on its OWN line via
  `printh`. `run` kills PICO-8 the instant it matches, so the run lasts exactly
  as long as the cart's logic needs, no blind wait. `--sentinel` changes it.
- A cart that never prints the sentinel is killed by the backstop
  (`--backstop-ms`, default 15000) and reported as `exitReason: timeout`.
- `-x` IS genuinely headless (runs with no display); the external kill is needed
  only because a cart cannot self-quit, NOT because of a window.
- Screenshots go to a run-controlled dir (`--shot-dir`, default an isolated temp
  dir), never `~/Desktop`.

### Scripted playtests: `run --input`

To automate a gameplay check ("press right x5 then jump, screenshot, did the
player clear the gap?"), pass a one-shot input string with `--input`; it reaches
the cart as the `-p` launch parameter, which the cart reads via `stat(6)`. Same
cooperation model as screenshots: the cart decodes the string and replays it as
button presses. A minimal harness that replays one char per frame:

```lua
-- stat(6) is the -p launch param string; replay it, one char/frame
script=stat(6)
fi=0
function btn_scripted(b)
 local c=sub(script,flr(fi)+1,flr(fi)+1)
 -- map chars to buttons: l r u d z x  (adapt to your scheme)
 return (b==0 and c=="l") or (b==1 and c=="r") or (b==2 and c=="u")
     or (b==3 and c=="d") or (b==4 and c=="z") or (b==5 and c=="x")
end
-- in _update: advance fi, use btn_scripted(n) instead of btn(n); screenshot at
-- marked frames; printh the sentinel when the script is exhausted.
```

Then: `picopilot run main.p8 --input "rrrrrz"` feeds the script, captures the
screenshots, and ends on the sentinel. This is the one-shot canned channel (the
string is fixed at launch); it is enough for deterministic scripted checks.

## Actually PLAY it: `picopilot playtest`

`run --input` only works if YOUR cart decodes `stat(6)`; an arbitrary game reads
real `btn`/`btnp`. `picopilot playtest` drives ANY normally-written cart with NO
change to it: on a THROWAWAY copy it redefines `btn`/`btnp` to read a
harness-piped held-buttons byte (reconstructing `btnp` edges) and OWNS the frame
loop, so it advances an exact number of frames, PAUSES (freezing all state,
including logic in `_draw`) for a clean screenshot, and captures gameplay (not
the title). Your `main.p8` is never mutated. It handles the standard scaffold
(`main.p8` = `#include main.lua`) automatically, inlining the include so the
driven copy is self-contained (no manual pack/build step, just point it at
`main.p8`). `playtest` requires PICO-8 and returns the same structured
`pico8-not-found` boundary as `run` when it is absent. (Mechanism: ADR-0011.)

There are three ways to drive a cart; pick by how much continuity you need.

### One-shot: `picopilot playtest run <cart>`

The whole scripted input is known up front, so the cart replays it to completion
and exits, returning ONE envelope (screenshot paths + captured printh + the
steps run). Great for a scripted playtest or benchmark judging.

```
picopilot playtest run main.p8                       # generic driver (press-to-start + gentle presses)
picopilot playtest run game.p8 --input "3:4, 18-22:4, 20:1"   # frame:bit script (bit 0=L 1=R 2=U 3=D 4=O 5=X)
picopilot playtest run game.p8 --seed 1 --input "3:4"        # opt-in srand for deterministic replay
```

`--input` is a comma list of `frame:bit` (a single press, one clean `btnp`
edge) or `from-to:bit` (a hold). Omit it for the generic one-button/runner/flappy
driver. `--seed n` injects `srand(n)` at cart start (never silent) so a random
cart replays identically. Screenshots go to `--shot-dir` (default an isolated
temp dir, NEVER `~/Desktop`).

### (A) Resumable LIVE session: `start` -> `step`/`input`/`shot` -> `stop`

When you want to PLAY across turns (look at the last frame, decide, inject input,
step, look again), keep the game ALIVE and PAUSED between your turns. `start`
launches a persistent driven PICO-8 and returns a SESSION ID; every other verb
addresses that id in a SEPARATE invocation, and the game stays alive + paused in
between. Stepping is deterministic via a stdout ACK handshake (the host waits for
the cart's ack before returning), so you always act on a settled, known frame, no
wall-clock guessing.

```
ID=$(picopilot playtest start main.p8 --format json | jq -r .id)   # launch, get the id
picopilot playtest input  $ID "right o"    # hold buttons for the next steps (names: left/right/up/down/o/x)
picopilot playtest step   $ID --frames 30  # advance EXACTLY 30 frames, then pause
picopilot playtest shot   $ID              # screenshot the current frozen frame -> a PNG path
picopilot playtest status $ID              # is it alive? how many frames in?
picopilot playtest stop   $ID              # tear it down (quit PICO-8, reap the dir)
```

Lifecycle notes (each verified/handled, not a hope):

- Each verb WRITES a fixed-size command block and WAITS for the cart's ACK, so a
  `step N` advances exactly N frames and a `shot` between steps captures the
  frozen intended frame. Between verbs the game is frozen (stable framebuffer).
- ONE session per id; MULTIPLE concurrent sessions are allowed (distinct ids get
  distinct daemons/dirs). Omit `--id` for a fresh random id; pass `--id name` for
  a stable one.
- ORPHAN reaping: a session you never `stop` self-reaps after an idle window
  (`--idle-timeout-ms`, default 10 min), so a walked-away session cannot leak a
  live PICO-8 forever. `stop` is idempotent (safe on an already-dead session).
- PICO-8 dying mid-session surfaces as a STRUCTURED error on the next verb
  (`playtest-session-process-dead`), never a hang; a command with no ACK by the
  deadline is `playtest-session-ack-timeout`. `start` with PICO-8 absent is
  `pico8-not-found`, same as `run`.
- Screenshots + the throwaway driven cart live under a controlled temp session
  dir, never `~/Desktop` or your carts root.

### (C) Stateless REPLAY (the free fallback, no daemon)

You do NOT always need a live session. Because the one-shot is deterministic
under `--seed`, you can "resume" by RE-INVOKING `playtest run` with an
ACCUMULATING script each turn: re-run from frame 0 with the same seed plus the
new presses appended. It is cheap, reproducible, and daemon-free.

```
picopilot playtest run game.p8 --seed 1 --input "3:4"                 # turn 1
picopilot playtest run game.p8 --seed 1 --input "3:4, 40:1"          # turn 2 (replays turn 1, then the new press)
picopilot playtest run game.p8 --seed 1 --input "3:4, 40:1, 55:5"    # turn 3 ...
```

Prefer (C) for short, replay-safe games (it needs no live process). Use the live
session (A) for true continuity: long games, or games that reseed from a
NON-deterministic source (wall-clock/entropy) mid-run and so cannot be replayed
from frame 0. Both drive the SAME cart-side transform; only the host lifecycle
differs.

## The two structured boundaries

Both dependency boundaries are soft and well-signposted, so read the result, do
not guess:

- `shrinko-not-found` (remedy `uv pip install shrinko`): gates the token/lint
  commands and therefore `verify`.
- `pico8-not-found` (remedy `set PICO8_PATH or install PICO-8`): gates `run`,
  `playtest`, `audio render`, and binary/PNG exports.

Each is a structured `{ ok: false, reason, remedy }` envelope with a nonzero
exit, telling you exactly which capability is gated and how to enable it.
