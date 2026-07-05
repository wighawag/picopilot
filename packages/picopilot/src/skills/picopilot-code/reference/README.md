# PICO-8 game-type code references

Per-genre reference implementations for PICO-8 carts. The right structure for a
platformer is not the right structure for a puzzle game, so pick the file that
matches what you are building and load it on demand. These are minimal
implementations written in idiomatic, token-cheap PICO-8 Lua (see the
`picopilot-code` SKILL for the token discipline they follow). They teach the
STRUCTURE and the genre-specific pitfalls; adapt them to your game.

Load the ONE that matches your game:

- `platformer.md`: side-view gravity/jump, per-axis tile collision, camera
  follow.
- `puzzle-grid.md`: a grid of cells, discrete tile-by-tile movement, rule
  evaluation, no physics.
- `twin-stick-arcade.md`: many entities at once (bullets, enemies, particles),
  spawn/despawn at scale, screen juice.
- `top-down-adventure.md`: walk a tiled world, room/map streaming, 4-direction
  movement and facing, interact with tiles.
- `mode7-racing.md`: pseudo-3D projected floor via `tline`, per-scanline
  perspective, heading-based driving.
- `rpg-menus-dialog.md`: UI state STACK, cursor menus, timed text reveal,
  turn-based battle menus.

Cross-cutting truths that apply to ALL genres live in the always-loaded
`AGENTS.md` (palette, memory map, the loop) and in this skill's other sections
(token budget). The genre files assume you already know those.

## Idioms every genre file relies on (quick recap)

- `add(list,obj)` / `del(list,obj)` / `deli(list,i)` for entity lists. Deleting
  the CURRENT item inside `foreach` is safe; deleting inside an ASCENDING numeric
  `for i=1,#list` loop is NOT (it errors once the list shrinks). Iterate a
  descending loop or `foreach` when you delete while iterating.
- `split"a,b,c"` turns a comma string into a 1-based array in one cheap token;
  it is the cheap way to declare data tables (frames, hitboxes, level rows).
- `sin(t)`/`cos(t)` take TURNS (0..1), not radians, and `sin` is INVERTED for
  screen space (+y is down). A full circle is `t: 0->1`.
- `mid(lo,x,hi)` is the idiomatic clamp.
- Draw state (`camera`, `pal`, `palt`, `clip`, `color`, `fillp`) PERSISTS across
  frames and calls. Reset with the no-arg form (`camera()`, `pal()`) before
  drawing the HUD, or it leaks.
