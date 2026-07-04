---
title: Running a PICO-8 cart headless and capturing screenshots an agent can look at
slug: pico8-run-and-screenshot
source: 'SPIKE — tested live against PICO-8 v0.2.7 (AppImage at ~/.AppImages/pico-8/pico8) on Linux, 2026-07-04, with a human confirming on-screen behaviour + screenshots read back by a multimodal agent. Cross-checked against the Lexaloffle PICO-8 manual and the PICO-8 wiki Extcmd/Shutdown pages.'
---

# Running a PICO-8 cart headless + capturing screenshots (the tested recipe)

This is the durable output of the "should `picopilot run` be a command?" spike. Conclusion: **NO command is needed** — running a cart is entirely PICO-8's own CLI. What has value (and is NOT obvious) is the exact tested recipe below, which belongs in the `picopilot-debug` SKILL, not a wrapper command. The spike also found the non-obvious details an agent would guess wrong.

## The fully-automatable recipe (verified end to end, zero human interaction)

```sh
timeout --signal=KILL <seconds> pico8 -desktop <shotdir> -x <cart.p8> </dev/null
```

- **`-x <cart>`** runs the cart headless-ish and does NOT drop to the console (verified: it runs `_update`/`_draw`, so `extcmd` fires). (`-run <cart>` also runs the cart but is more interactive-window-oriented; `-x` is the automation flag.)
- **`-desktop <shotdir>`** redirects where screenshots/gifs are saved (default is `$HOME/Desktop`; config key `desktop_path`, empty = the default). Point it at a folder the agent controls.
- **`</dev/null`** detaches stdin so it never waits for console input.
- **`timeout --signal=KILL <seconds>`** is MANDATORY as the terminator — see the self-quit constraint below. Verified: `timeout` kills pico8 after N seconds and the screenshots are already on disk.

## Screenshots from cart code (the agent adds a few debug lines)

There is NO external "screenshot the running cart" command — the CART screenshots ITSELF via `extcmd`:

- **`extcmd("screen")`** — takes a screenshot. VERIFIED. NOTE: the verb is `"screen"`, NOT `"screenshot"` — `extcmd("screenshot")` errors on-screen with "unknown extcmd screenshot" (an easy and confirmed wrong guess).
- **`extcmd("set_filename","frame_0")`** before `extcmd("screen")` names the next shot deterministically. Without it, files are auto-named `<cart>_%d.png` (auto-incrementing per run).
- For animation: call `extcmd("screen")` on a frame timer (e.g. at `t==20`, `t==40`, …) with distinct filenames → `frame_0.png`, `frame_1.png`, … The agent then reads them in sequence and PERCEIVES MOTION by comparing frames (verified: a falling circle was visibly lower between two captured frames).
- `-screenshot_scale n` sets the scale (config had `3` → 384x384 PNGs).

So the debug loop is: agent adds a screenshot-on-timer to the cart → runs the `timeout ... pico8 -x` line → reads the PNGs (and `printh` on stdout) → judges correctness + motion → removes the debug lines.

## The hard constraint: a cart CANNOT quit the PICO-8 app (but can SIGNAL done via stdout)

`extcmd("shutdown")` **only works in an EXPORTED BINARY**, not in a running cart in the PICO-8 app (confirmed by the wiki Shutdown/Extcmd pages AND by testing: it does nothing useful from a cart). `stop()` halts the cart to the console but does not quit the app. **Therefore the run must be terminated EXTERNALLY.**

### BEST termination: a stdout sentinel + kill-on-match (VERIFIED, better than a blind timeout)

Because `printh` goes to the launching terminal's stdout, the cart can SIGNAL when it is finished, and the launcher kills pico8 the moment it sees the signal — the cart effectively "self-quits" via stdout even though it cannot call shutdown:

```lua
-- in the cart, after it has taken its screenshots:
if t==45 then printh("__PICOPILOT_DONE__") end
```

```sh
# launcher: stream stdout, kill pico8 on the sentinel; timeout is only a SAFETY backstop
timeout --signal=KILL 20 pico8 -desktop <shotdir> -x <cart.p8> </dev/null 2>&1 |
  while IFS= read -r line; do
    [ "$line" = "__PICOPILOT_DONE__" ] && { pkill -KILL -f 'pico8 .*<cart>'; break; }
  done
```

VERIFIED: the stream showed `RUNNING:` then `__PICOPILOT_DONE__`, and pico8 was killed immediately — terminating on the cart's ~1.5s of logic, NOT waiting out a blind timeout. This is strictly better than `timeout <n>` alone: no guessing the duration (a blind `timeout 8` wastes wall-time if the cart finishes in 1s, and truncates it if it needs 10s). Keep `timeout --signal=KILL` as the SAFETY BACKSTOP for a cart that hangs or errors before printing the sentinel.

## `printh` (text feedback, free)

`printh(str)` from cart code writes to the terminal's stdout when run from the CLI, so the same shell-out that launches pico8 captures it. Good for logging state/values alongside the visual screenshots.

## What this means for picopilot (the design conclusion)

- **The MECHANICS are 100% PICO-8's CLI** (run + screenshot + printh) — so a command that merely wraps `pico8 -x` would add no value and belongs in a SKILL.
- **BUT the stdout-sentinel-watch + kill + collect-results is real orchestration** an agent should not hand-roll each time (stream stdout, match the sentinel, kill the process tree, gather the screenshots + printh into one structured result, with the timeout backstop). THIS is a legitimately thin but real value-add — so a SMALL `picopilot run`-like command that owns *just that orchestration* (not "wrap pico8") is now defensible, where the blind-`timeout` version was not. Decide at task time: skill-only recipe vs. a thin command that does sentinel-watch+collect. (The sentinel improvement is what tips it from "no command" toward "maybe a thin command".)
- **DO teach this recipe in the `picopilot-debug` skill** regardless: the `pico8 -desktop <dir> -x <cart>` line, the `extcmd("screen")` verb (with the "screenshot"-is-wrong warning), the screenshot-on-timer animation pattern, `printh` capture, the stdout-sentinel termination, and the "carts can't self-quit" constraint.
- **Honest limit to state in the skill:** on a normal desktop PICO-8, even `-x` opens a window/context; the `timeout`-kill wrapper makes it *automatable* but it is not a clean daemon. Screenshots require the CART to cooperate (self-screenshot); there is no "screenshot an arbitrary running cart" hook. The agent edits the cart to add debug captures, then reverts them.
- v1-rest's planned `run` command should be RE-SCOPED from "a command" to "a `picopilot-debug` skill update" (and dropped from the prd's command surface).
