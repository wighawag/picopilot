You are in a solo, timed PICO-8 GAME JAM. You have __MINUTES__ MINUTES, total, working ALONE, to build a PLAYABLE game on the theme below, using the `picopilot` toolchain.

THEME: __THEME__

The theme is deliberately generic. Interpret it on any layer(s) you like: graphics, mechanics, or story. Usually the ORIGINALITY comes from the MECHANICS, so favour a fresh mechanic over a fresh coat of paint. A clever one-idea game beats an ambitious unfinished one.

THE HARD REQUIREMENT: at the deadline you must have a PLAYABLE game in `main.p8` in this folder:
- it boots and runs in PICO-8 without erroring,
- it responds to player input (buttons actually change what happens),
- it has a goal / challenge / win or lose condition (a game, not a tech demo or a screensaver),
- it visibly relates to the theme,
- THE PLAYER AND KEY ENTITIES ARE VISIBLE ON SCREEN. If you `spr(n)` something, you MUST actually DRAW sprite n with `gfx set` (an empty sprite = an invisible player, an instant fail). Simplest-safe alternative: draw the player with primitives (`circfill`/`rectfill`/`pset`) so it can never be invisible. Look at your own game (`gfx render`, or a live-gameplay screenshot via `playtest run main.p8`, see step 6) and confirm you can SEE the thing the player controls.

You are ON A CLOCK. The harness will inject "TIME REMAINING" reminders between your turns. When you see one, TRIAGE ruthlessly: a rough playable game at the deadline scores; a beautiful half-finished one scores zero. Get to a playable vertical slice EARLY (something you can play in the first third of the time), then improve it. Do NOT gold-plate. In the last few minutes, STOP adding features and make sure it still boots and is playable.

HOW TO WORK (this is the picopilot loop; use it every iteration):
1. Scaffold once if not already done: `node __PICOPILOT__ init` (creates main.p8 + main.lua; you edit main.lua, never the binary sections by hand). If main.p8 already exists, skip.
2. Write low-token Lua in `main.lua` (the .p8 `#include`s it). Keep under the 8192-token budget.
3. Sprites/art: edit as a char grid with `node __PICOPILOT__ gfx set <n>`, and LOOK at it with `node __PICOPILOT__ gfx render <n>` (it writes a PNG you can view). Fix in that loop. CRITICAL: every sprite id you `spr(n)` in code MUST be drawn (a non-empty sprite), or the player/entity is invisible. If you are short on time, draw the player with primitives instead of a sprite so it is never invisible.
4. Sound/music (optional, only if time allows): `node __PICOPILOT__ sfx from-mml <slot> "<mml>"` and `node __PICOPILOT__ music from-patterns "<json>"`. Load the `picopilot-audio` skill's guidance if you compose (durations are tracker ROWS, not tempo; filters `!dampen !reverb` etc. exist).
5. Gate every iteration: `node __PICOPILOT__ verify` (static: tokens + lint + integrity). Keep it green.
6. PLAYTEST it (this is your eyes on the ACTUAL GAME, use it every iteration): `node __PICOPILOT__ playtest run main.p8` drives your cart through play and captures LIVE-gameplay screenshots (NOT the title screen) in one result, with NO changes to your cart. It presses buttons for you (a generic press-to-start + gentle inputs); to drive it precisely pass `--input "3:4, 18-22:4, 20:1"` (a comma list of `frame:bit` presses or `from-to:bit` holds; bit 0=L 1=R 2=U 3=D 4=O 5=X). Look at the screenshots and CONFIRM the game reaches play and the player is visible + responding. (`run` still exists for a plain headless boot, but `playtest` is what shows you the game being played.)
   - INSPECT A SPECIFIC MOMENT with the RESUMABLE session: `playtest start main.p8` returns a session id; then `playtest step <id> --frames 30` advances exactly 30 frames and PAUSES on that settled frame, `playtest shot <id>` screenshots the frozen frame, `playtest input <id> "o"` queues a button, step again, shot again, and `playtest stop <id>` when done. Use this to PAUSE at a tricky moment (a near-collision, a spawn, a win) and check it frame-by-frame, then keep playing. This is the debugging superpower: freeze, look, decide, inject, step, look again.

PICO-8 FOOTGUN: never run `pico8 --help` / `--version` / bare `pico8` (they launch the GUI app and HANG your turn). Let picopilot shell out to pico8 for you; read the manual for flags, never ask the binary.

Constraints: PICO-8 is 128x128, 16 fixed colours, Lua with an 8192-token budget. Keep scope tiny. One screen, one mechanic, one goal is plenty for a jam.

DELIVERABLE at the deadline: `main.p8` (a playable game) in this folder. Also write a short `JAM.md` describing your theme interpretation, the mechanic, and the controls (how to play). Work autonomously start to finish; do not ask questions, make your own calls and record them briefly in JAM.md.

Start now. First get to a playable slice fast, then improve. The clock is running.
