---
name: picopilot-code
description: Write low-token PICO-8 Lua and stay under the 8,192-token budget. How to read picopilot tokens output, the PICO-8 shorthands that reclaim budget, and how minify (safe-only) and verify fit the loop. Use when writing or shrinking cart Lua.
---

# picopilot code

The #1 way an agent fails at PICO-8 is token bloat: verbose Lua silently blows
past the 8,192-token budget and the cart will not load. picopilot's job here is
to make the budget visible and cheap to fix. (See `picopilot-overview` for the
`#include` discipline: you edit `main.lua`, never the `.p8` binary sections.)

## Read the token breakdown every iteration

Run `picopilot tokens` after each change. It reports:

- `tokens` and `pct`: the count and its percentage of the 8,192 budget.
- `overBudget`: true when you are over 8,192 (the cart will not load).
- `chars` and `compressed`: size, not the load-bearing limit; tokens are.

When you are over budget, the result CTAs you to `picopilot minify`. Treat the
token count as the number to drive down, not something to check once.

If shrinko is not installed, `tokens` returns a structured `shrinko-not-found`
result (nonzero exit) with the exact remedy `uv pip install shrinko`. That is not
a crash; install shrinko and re-run.

## Token discipline (write cheap Lua the first time)

Models blow the budget by writing verbose Lua. Prefer PICO-8 shorthands:

- `?` for `print`.
- inline if: `if(c) x=1` instead of `if c then x=1 end`.
- compound assignment: `+=`, `-=`, `*=`, `/=`.
- `\` for integer divide.
- reuse locals; avoid needless globals; fold repeated expressions into one local.

## Reclaim budget with minify (safe-only)

`picopilot minify` runs SAFE minification by default and reports the before/after
token delta. Safe-only never changes behaviour, so it is the first move when over
budget. Aggressive minification is never silent; if it is ever offered it is an
explicit opt-in.

## Gate it

`picopilot verify` is the single static acceptance gate: tokens + integrity, no
run. A green verify is well-formed, not proven-to-run, so it points you at
`picopilot run`. With shrinko absent, verify is `gate-incapable` (never green),
because it cannot check token bloat, the failure this loop exists to catch.

## Do NOT guess the API: read `reference/pico8-api.md`

The most expensive weak-model mistake is calling a function that does not exist
(`rand`, `ranf`, `rectcol`, a `spr` with too many args) and only finding out when
a playtest round crashes with `attempt to call nil value`. When you are unsure a
function exists or what its arguments are, READ `reference/pico8-api.md` before
writing the call: it lists the exact names + signatures of the common API and a
table of the wrong names LLMs reach for (from mainstream Lua / other engines) and
their real PICO-8 equivalents. Random is `rnd(x)` (a float in `[0,x)`), not
`rand`/`ranf`; there is NO built-in collision (write an AABB); `spr` is
`spr(n,x,y,[w,h],[fx],[fy])` with no color/rotate arg. Checking the reference is
far cheaper than burning a run on a nil-call crash.

## PICO-8 gotchas that break carts silently

These are NOT token issues; they are behaviours that differ from mainstream Lua
/ math and make a cart compile-and-run-but-behave-wrong. The ones models get
wrong most:

- `sin(t)`/`cos(t)` take TURNS (0..1), not radians, and `sin` is INVERTED for
  screen space (+y is down). A full circle is `t: 0->1`. Do not multiply by
  `2*pi`; do not re-negate `sin`.
- `/` does NOT truncate (`5/2` is `2.5`). Integer divide is `\` (`5\2` is `2`),
  which floors toward negative infinity (`-5\2` is `-3`).
- `rnd(x)` returns a FLOAT in `[0,x)`. Wrap with `flr` for an integer
  (`flr(rnd(6))` is 0..5). `rnd(table)` returns a random element.
- Tables are 1-BASED. `del(t,val)` removes by VALUE; `deli(t,i)` removes by
  INDEX. Deleting the current item inside `foreach` is safe; deleting inside an
  ascending `for i=1,#t` loop ERRORS once the list shrinks (iterate descending).
- Draw state PERSISTS across frames: `camera`, `pal`, `palt`, `clip`, `color`,
  `fillp` stay set until you reset them (no-arg form: `camera()`, `pal()`).
  Reset before drawing the HUD or offsets/palette swaps leak.
- Variables are GLOBAL unless declared `local`. The `x = cond and a or b` ternary
  returns `b` when `a` is falsy; use an explicit `if` when `a` can be `false`/`nil`.

## Data-as-split-strings (a top token-saver)

`split"a,b,c"` turns a comma string into a 1-based array in one cheap token.
Declare frames, hitboxes, direction lookups, and whole level rows this way
instead of table literals. `unpack(split"...")` spreads it as a vararg (e.g.
`poke(addr, unpack(split"..."))` writes a byte blob in one call). Prefer it for
any homogeneous list.

## Genre code references (load the one you need)

The right STRUCTURE differs by game type: a platformer's gravity + per-axis
collision is nothing like a grid puzzle's transactional tile-step or a shooter's
entity swarm. When you start building a specific genre, load the matching file
from this skill's `reference/` folder (see `reference/README.md` for the index):

- `reference/platformer.md`: gravity/jump, per-axis tile collision, camera follow.
- `reference/puzzle-grid.md`: grid state, discrete tile-step moves, rule passes.
- `reference/twin-stick-arcade.md`: many entities, spawn/despawn at scale, juice.
- `reference/top-down-adventure.md`: tiled world, 4-dir movement, tile interaction.
- `reference/mode7-racing.md`: pseudo-3D `tline` floor projection, driving.
- `reference/rpg-menus-dialog.md`: UI state stack, cursor menus, timed text reveal.

Each carries a minimal idiomatic implementation and a genre-pitfalls checklist.
Adapt them to your game. `reference/pico8-api.md` (the exact API surface) sits in
the same folder for when you need to look a function up.
