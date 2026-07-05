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

## The two structured boundaries

Both dependency boundaries are soft and well-signposted, so read the result, do
not guess:

- `shrinko-not-found` (remedy `uv pip install shrinko`): gates the token/lint
  commands and therefore `verify`.
- `pico8-not-found` (remedy `set PICO8_PATH or install PICO-8`): gates `run`,
  `audio render`, and binary/PNG exports.

Each is a structured `{ ok: false, reason, remedy }` envelope with a nonzero
exit, telling you exactly which capability is gated and how to enable it.
