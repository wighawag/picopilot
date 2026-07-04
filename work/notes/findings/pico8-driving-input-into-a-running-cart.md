---
title: Driving input INTO a running PICO-8 cart (scripted + LIVE) for agent gameplay testing
slug: pico8-driving-input-into-a-running-cart
source: 'SPIKE — tested live against PICO-8 (AppImage ~/.AppImages/pico-8/pico8) on Linux, 2026-07-04. Two spikes (one-shot -p/stat(6); live GPIO vs serial-stdin), each run headless with the timeout+sentinel pattern and the result screenshots read back by a multimodal agent. Cross-checked against the Lexaloffle PICO-8 manual (serial channel table) + the PICO-8 wiki Serial/GPIO pages.'
---

# Driving input into a running PICO-8 cart (the tested channels)

This is the durable output of the "how can the agent DRIVE the buttons of a running cart?" investigation — the input half of the closed gameplay-test loop (the output half is `pico8-run-and-screenshot.md`). Key design principle (same as screenshots): the input does NOT have to be real keypresses — **the CART cooperates**, reading a scripted/live input channel and feeding it to its own `btn()`-style logic. Two channels were spiked; both WORK. A third (GPIO) is a desktop dead end.

## Channel 1 — one-shot scripted input: `-p param_str` + `stat(6)` (WORKS)

```sh
pico8 -x cart.p8 -p "rrrrrz"
```

The cart reads the launch parameter string via `stat(6)` and replays it (e.g. char-per-frame → scripted button states). VERIFIED end to end: with `-p "rrrr..."`, a cart driving a dot right per `r` moved `x=60 → x=70` across two captured frames. Works headless under `-x`. Deterministic and simple; ideal for a CANNED test sequence set at launch. Limitation: one-shot — the string is fixed at launch (though a running cart can re-launch itself with a new param via `load(cart, breadcrumb, param_str)`).

## Channel 2 — LIVE input: serial stdin `serial(0x804, addr, len)` (WORKS — the good one)

PICO-8's `serial()` exposes host I/O channels (from the manual's serial table):

- **`0x804` = stdin (READABLE)** — the host pipes data into the PICO-8 process; the cart reads it live.
- **`0x805` = stdout (writable)** — cart → host (an alternative to `printh`).
- **`0x806` / `0x807`** = a file given with `pico8 -i <file>` / `-o <file>`.
- **`0x800`** = dropped file (`stat(120)` = data available), **`0x802`** = dropped image (`stat(121)`).

VERIFIED end to end: piping `rrr` bursts over time into the process stdin, a cart doing `serial(0x804, 0x4300, 8)` each frame consumed them frame-by-frame and moved the dot LIVE (`x=64 → x=91`, i.e. 9 bytes × 3px), confirmed visually in the screenshots. This is a genuine LIVE, interactive, host→cart channel.

Cart-side pattern (the input harness the agent adds):

```lua
function _update()
 local n = serial(0x804, 0x4300, 8)      -- read up to 8 bytes of stdin into 0x4300
 for i = 0, n-1 do
  local b = peek(0x4300 + i)
  -- decode b into button intent, e.g. 'r'/'l'/'z'/... → your movement/jump logic
 end
end
```

Host-side: `printf 'rrr' | pico8 -x cart.p8` (or a live stream). Combine with the screenshot-out loop (`extcmd("screen")`) to script an interactive playtest: "feed right×10 then jump, screenshot" → look at whether the player cleared the platform. **Fully automatable agent-driven gameplay testing — no human, no real keypresses.**

## Channel 3 — GPIO (`0x5f80`-`0x5fff`): not native, but the RICH WEB-EXPORT channel (NOT a dead end)

CORRECTED (initial spike said "dead end" — that was too strong; it is a dead end for the NATIVE `pico8 -x` path only). The 128 GPIO bytes are externally bridged on: **Raspberry Pi** (WiringPi hardware), and **web exports** (`EXPORT foo.html`) where GPIO is a 128-byte array SHARED between the cart and the host JavaScript page (`var pico8_gpio = new Array(128)`), read/written by both sides.

- **Native `pico8 -x` desktop: GPIO is inert** — no WiringPi backend, no external writer, reads `0,0,0,0` (VERIFIED). For the native headless path, use serial stdin (`0x804`) for input.
- **Web export: GPIO is a full, documented, bidirectional protocol.** The community pattern (see BBS tid=40334, "multiplayer over GPIO", + benwiley4000/pico8-gpio-listener) uses byte 0 of GPIO as a comms handshake (cart pokes `0x5f80` to signal "data ready"; JS subscribes to GPIO changes and reads/writes the 128-byte buffer). Richer than a stdin byte-stream (a full 128-byte shared array with a handshake).

### This opens a SECOND run/test architecture (a real design fork for `picopilot run`)

Besides the native `pico8 -x` path, there is a **web-export path**: `EXPORT cart.html`, run it in a HEADLESS BROWSER (Playwright/Puppeteer), and drive it from JS. Trade-offs:

| | Native (`pico8 -x`) | Web export (`EXPORT .html` + headless browser) |
| --- | --- | --- |
| Headless | GENUINELY headless — VERIFIED runs with `DISPLAY` unset, no window (the window-grab is `-run`/`-h` only, NOT `-x`) | genuinely headless |
| Screenshot | `extcmd("screen")` cart-side + read PNG files | browser screenshots the canvas directly (no cart cooperation) |
| Input | serial stdin `0x804` (byte stream) | GPIO 128-byte shared array + handshake (rich, documented) |
| Termination | stdout sentinel + `timeout` backstop (cart can't self-quit — NOT a window problem) | browser controls the lifecycle |
| Cost | just the user's PICO-8 binary | + a headless browser + the HTML export step (+ export needs `pico8.dat`) |

CORRECTED: an earlier version penalised the native path for a "window-grab" that does NOT exist for `-x` (verified headless with `DISPLAY` unset). So the native path is BOTH headless AND lighter (no browser/export). The web path's genuine advantages narrow to a RICHER input channel (128-byte GPIO shared array + handshake vs. a stdin byte-stream) and browser-native canvas screenshots (no cart-side `extcmd` cooperation). Native is the lighter default; web is worth it if the richer GPIO channel or browser-side capture is wanted. **Decide at `run`-task time which architecture (or both) picopilot's run/test loop targets** — do NOT foreclose the web path (the initial "GPIO dead end" framing wrongly did). Both are viable and tested-in-principle.

## What this means for picopilot (design)

- The `picopilot run` command (ADR-0006) can EXPAND from "run + screenshot + printh" to a full **scripted-playtest** loop: accept an input script (e.g. `--input "→→→z"` or a timed sequence), pipe it to the cart's stdin (or set `-p`), run, screenshot at marked moments, and return `{screenshots, printh, exitReason}` — the agent then LOOKS at whether the scripted interaction produced the intended result.
- Two input modes, both tested: `-p`/`stat(6)` (one-shot canned) and serial-stdin `0x804` (live/streamed). Live stdin is the more powerful; `-p` is the simplest.
- Same cooperation model as screenshots: `run` (or the `picopilot-debug` skill) has the cart include a small INPUT HARNESS (`serial(0x804,...)` decode) + the SCREENSHOT harness; a natural future expansion is auto-injecting/stripping a standard harness so the agent doesn't hand-write it.
- The MECHANICS are PICO-8's own (`serial`, `-p`, `stat`); the VALUE picopilot adds is the tested recipe + the harness + the pipe-and-collect orchestration. Consistent with ADR-0006's "thin command owns the orchestration, skill teaches the recipe."
