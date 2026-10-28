---
name: picopilot-overview
description: Start here for any PICO-8 cart built with picopilot. Call picopilot doctor first to learn what this machine can do (everything works headless), then the #include discipline (edit main.lua, never the .p8 binary sections), the per-iteration verify loop, and which deeper skill to load for code, art, audio, or debugging. Use when you open a picopilot cart folder or run picopilot init.
---

# picopilot overview

picopilot is the transpile-and-verify layer between what you are good at (text)
and PICO-8's reality (binary cart sections). It gives you eyes (render sprites to
a viewable PNG), token-bloat detection, safe cart editing, and one static
acceptance gate, so you can build a PICO-8 game and self-correct.

Load this skill first. Then load the group skill for whatever you are doing:
`picopilot-code`, `picopilot-art`, `picopilot-audio`, or `picopilot-debug`.

## First on a new machine: `picopilot doctor`

Run `picopilot doctor` before anything else on a machine you have not used yet. It reports what THIS machine can do: whether PICO-8 is found and actually runs (with its version), whether shrinko8 is found, how a PICO-8 audio session would get a display, and the resulting `available` / `unavailable` command lists (each unavailable command says what it is missing). Plan from that list instead of discovering limits by failing.

Every picopilot command works on a machine with no display and no sound card (a server, CI, an agent sandbox). Screenshots, `playtest` and `export` run PICO-8 headless. Audio recording (`audio render`, `audio record`, `run --record-audio`) needs a real PICO-8 session with a window, and picopilot provides one by itself: with the default display mode `auto`, when there is no display it starts a private virtual display for that recording and removes it afterwards. You do not need to set anything up. Only if `doctor` lists the audio commands as unavailable with `missing: display` (or a recording fails with `display-unavailable`) does the machine lack Xvfb; the error names the install command to suggest to the human.

The display mode can be forced with `--display xvfb` (always virtual) or `--display native` (use the current display as-is), also settable as `PICOPILOT_DISPLAY` or `"display"` in `picopilot.json` (when picopilot runs as an MCP server, only `PICOPILOT_DISPLAY` in the server's environment applies). Leave it at `auto` unless a human asks otherwise.

## The #include discipline (how every picopilot cart is laid out)

- `main.p8` is the cart. Its `__lua__` section is a single line: `#include main.lua`.
- `main.lua` is the plain Lua you EDIT. You work in ordinary Lua and never
  hand-write the cart's binary hex sections (`__gfx__`, `__map__`, `__sfx__`,
  `__music__`).
- To touch a binary section, use picopilot's commands (`gfx set`, the audio
  transpiles). They edit those sections safely and round-trippably. Editing hex
  by hand is how art and audio silently break.

`picopilot init` scaffolds this layout: `main.p8`, `main.lua`, an `AGENTS.md`
PICO-8 reference you should read, and a `picopilot.json` config.

## The iteration loop

Every change follows the same shape:

1. Edit `main.lua` (or a cart section via a picopilot command).
2. `picopilot tokens` to watch the 8,192-token budget (see `picopilot-code`).
3. `picopilot verify` as the single static acceptance gate.

`picopilot verify` is STATIC: it runs tokens + integrity and NEVER runs the cart.
A green verify means "well-formed", not "it works", so a passing verify points
you at `picopilot run` to confirm the cart actually boots. Never treat a green
static gate as done.

If shrinko is not installed, token-backed commands (and therefore `verify`) fail
with a structured `shrinko-not-found` result carrying the exact remedy
`uv pip install shrinko`. `verify` in that state returns `gate-incapable`, never
green, so the gate can never pass by skipping its most important check.

## Making your agent discover picopilot

`picopilot init` PRINTS how to make your agent discover these skills; it does not
silently write into your shared skill dirs. To actually install them, run
`picopilot init --install-skills` (or `picopilot skills add`). That is the one
deliberate, opt-in write to a shared location.
