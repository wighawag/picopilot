You are in a solo, timed PICO-8 GAME JAM. You have __MINUTES__ MINUTES, total, working ALONE, to build a PLAYABLE game on the theme below, using the `picopilot` toolchain.

THEME: __THEME__

The theme is deliberately generic. Interpret it on any layer(s) you like: graphics, mechanics, or story. Usually the ORIGINALITY comes from the MECHANICS, so favour a fresh mechanic over a fresh coat of paint. A clever one-idea game beats an ambitious unfinished one.

THE HARD REQUIREMENT: at the deadline you must have a PLAYABLE game in `main.p8` in this folder:
- it boots and runs in PICO-8 without erroring,
- it responds to player input (buttons actually change what happens),
- it has a goal / challenge / win or lose condition (a game, not a tech demo or a screensaver),
- it visibly relates to the theme,
- THE PLAYER AND KEY ENTITIES ARE VISIBLE ON SCREEN. If you `spr(n)` something, you MUST actually DRAW sprite n with `gfx set` (an empty sprite = an invisible player, an instant fail). Simplest-safe alternative: draw the player with primitives (`circfill`/`rectfill`/`pset`) so it can never be invisible. Look at your own game (`gfx render`, or a screenshot via `run`) and confirm you can SEE the thing the player controls.

You are ON A CLOCK. The harness will inject "TIME REMAINING" reminders between your turns. When you see one, TRIAGE ruthlessly: a rough playable game at the deadline scores; a beautiful half-finished one scores zero. Get to a playable vertical slice EARLY (something you can play in the first third of the time), then improve it. Do NOT gold-plate. In the last few minutes, STOP adding features and make sure it still boots and is playable.

HOW TO WORK (this is the picopilot loop; use it every iteration):
1. Scaffold once if not already done: `node __PICOPILOT__ init` (creates main.p8 + main.lua; you edit main.lua, never the binary sections by hand). If main.p8 already exists, skip.
2. Write low-token Lua in `main.lua` (the .p8 `#include`s it). Keep under the 8192-token budget.
3. Sprites/art: edit as a char grid with `node __PICOPILOT__ gfx set <n>`, and LOOK at it with `node __PICOPILOT__ gfx render <n>` (it writes a PNG you can view). Fix in that loop. CRITICAL: every sprite id you `spr(n)` in code MUST be drawn (a non-empty sprite), or the player/entity is invisible. If you are short on time, draw the player with primitives instead of a sprite so it is never invisible.
4. Sound/music (optional, only if time allows): `node __PICOPILOT__ sfx from-mml <slot> "<mml>"` and `node __PICOPILOT__ music from-patterns "<json>"`. Load the `picopilot-audio` skill's guidance if you compose (durations are tracker ROWS, not tempo; filters `!dampen !reverb` etc. exist).
5. Gate every iteration: `node __PICOPILOT__ verify` (static: tokens + lint + integrity). Keep it green.
6. Confirm it BOOTS + is playable: `node __PICOPILOT__ run` (headless; captures screenshots + printh). Add a temporary screenshot-on-timer + a `__PICOPILOT_DONE__` sentinel to the cart while testing, then remove it. For a real playtest, `node __PICOPILOT__ run --input "<buttons>"` drives input (e.g. right/jump) and you compare screenshots to confirm the game responds.

PICO-8 FOOTGUN: never run `pico8 --help` / `--version` / bare `pico8` (they launch the GUI app and HANG your turn). Let picopilot shell out to pico8 for you; read the manual for flags, never ask the binary.

Constraints: PICO-8 is 128x128, 16 fixed colours, Lua with an 8192-token budget. Keep scope tiny. One screen, one mechanic, one goal is plenty for a jam.

DELIVERABLE at the deadline: `main.p8` (a playable game) in this folder. Also write a short `JAM.md` describing your theme interpretation, the mechanic, and the controls (how to play). Work autonomously start to finish; do not ask questions, make your own calls and record them briefly in JAM.md.

Start now. First get to a playable slice fast, then improve. The clock is running.
