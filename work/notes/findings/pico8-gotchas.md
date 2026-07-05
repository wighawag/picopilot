---
title: PICO-8 gotchas and footguns (the surprising behaviours that break LLM-written carts)
slug: pico8-gotchas
source: 'General PICO-8 knowledge, cross-checked against the official PICO-8 manual and confirmed LIVE against a local PICO-8 install on 2026-07-04: sin(0.25)=-1, cos(0.25)=0, 5/2=2.5, 5\2=2, -5\2=-3, and (true and false or 99)==99 all verified by running them.'
---

# PICO-8 gotchas and footguns (for picopilot agent context)

Verified external/domain ground truth: PICO-8 behaviours that DIVERGE from mainstream Lua / ordinary math, which an LLM (trained on standard Lua, JS, Python) reliably gets wrong. These are the traps that make a cart compile-and-run-but-behave-wrong. Companion to `pico8-api-reference.md` (what exists) and `pico8-idioms-and-patterns.md` (how to compose). Ordered roughly by how often they bite.

Each entry: the surprising truth (one line), WHY an LLM gets it wrong, and a corrected snippet where useful.

## 1. `sin`/`cos` take TURNS (0..1), not radians, and `sin` is INVERTED (negated)

Manual: "COS() and SIN() take 0..1 instead of 0..PI*2, and SIN() is inverted ... to suit screenspace (where Y means downwards)." A full circle is `1.0`, not `2*pi`; `sin(0.25)` returns `-1`.

```lua
-- t is a fraction of a full turn (0..1)
x = cx + r*cos(t)
y = cy + r*sin(t)          -- already screen-correct (+y down); sin is PRE-negated
-- to convert a radians value: pico_t = radians/(3.14159*2)
```

**Why LLMs get it wrong:** they write `sin(radians)` and multiply by `2*pi`/`3.14`, and expect standard orientation. Result: motion spins far too fast AND is vertically mirrored. Do NOT re-negate `sin` yourself; it is already negated.

## 2. `/` does NOT truncate; use `\` for integer (floor) division

`5/2` = `2.5` (a fixed-point value). PICO-8's integer divide is a single backslash `\` (not Lua 5.3's `//`). `\` floors toward negative infinity like `flr`, so `-5\2` = `-3`.

```lua
idx  = n\8 + 1      -- integer, cheaper than flr(n/8)+1
half = flr(w/2)     -- explicit floor when you need it
```

**Why LLMs get it wrong:** they port `//` or assume `/` truncates → fractional array indices (read `nil`/error) or off-by pixel bugs.

## 3. All numbers are signed 16.16 fixed-point: range ~ -32768.0 .. 32767.99998

No separate integer type. Overflow WRAPS (two's complement): `32767 + 1` → `-32768`. Precision is ~4 fractional hex digits (smallest step ~0.0000153); large integers lose exactness above 32767, tiny increments below the step vanish.

**Why LLMs get it wrong:** they assume 64-bit floats or unbounded ints and overflow when accumulating big timers, large sums, or hashing. Keep frame counters bounded: `t=(t+1)%0x7fff`. Avoid multiplying two large fixed-point numbers.

## 4. `rnd(x)` returns a FLOAT in [0,x); wrap with `flr` for ints, and `rnd(table)` picks an element

Manual: "Returns n where 0 <= n < x. If you want an integer, use flr(rnd(x)). If x is an array-style table, return a random element." `rnd()` with no arg → [0,1). `srand(x)` seeds (same seed → same stream).

```lua
die   = flr(rnd(6))+1   -- 1..6 integer
pick  = rnd(items)      -- random element of the array
coord = flr(rnd(128))   -- 0..127 integer pixel
```

**Why LLMs get it wrong:** `rnd(6)+1` gives a FRACTIONAL value used as an index.

## 5. Tables are 1-BASED; `#t`/`count` need a contiguous 1..n run; `del` (by value) vs `deli` (by index)

Array tables start at index 1. `#t` / `count(t)` are unreliable with holes (`t[i]=nil` in the middle). `del(tbl,val)` removes by VALUE (first match, shifts rest); `deli(tbl,i)` removes by INDEX (defaults to last if `i` omitted).

```lua
for i=1,#t do ... end   -- 1..n inclusive
del(bullets, b)         -- remove this specific bullet object
deli(bullets, i)        -- remove the i-th bullet
```

**Why LLMs get it wrong:** write `t[0]` (0-based habit); confuse "remove item X" (`del`) with "remove position i" (`deli`); reach for Lua's `table.remove`. Iteration pitfall: removing while iterating forward by index skips the next element, so iterate backward (`for i=#t,1,-1`) or use `foreach`.

## 6. `_update` runs at 30fps; `_draw` (not `_update`) is skipped under load; `_update60` for 60fps

`_draw` is normally 30fps, but if it can't keep up PICO-8 drops to 15fps and calls `_update` TWICE per draw. Define `_update60()` for a 60fps loop. You cannot have both `_update` and `_update60`.

**Why LLMs get it wrong:** hardcode movement as if 60fps, or mix the two (half/double speed); put game logic in `_draw` (which gets skipped → non-deterministic). Keep ALL state mutation in `_update`/`_update60`, only rendering in `_draw`.

## 7. Draw state PERSISTS across frames: `pal`, `palt`, `camera`, `clip`, `color`, `fillp`

None of these reset per frame. `pal(a,b)` remaps color a→b for EVERY later draw (including next frame) until reset; `camera(x,y)` offsets all later draws; `color(c)` sets the global pen color. Reset with the no-arg forms: `pal()`, `palt()`, `camera()`, `clip()`.

```lua
function _draw()
  cls()
  camera(cx,cy) draw_world()
  camera()               -- reset to screen space for HUD
  pal() palt()           -- reset after any per-sprite palette swap
  draw_hud()
end
```

**Why LLMs get it wrong:** assume a fresh canvas-style graphics state per frame → palette swaps / camera offsets leak into the HUD or persist forever.

## 8. Draw coordinates are FLOORED to integer pixels (no sub-pixel render)

`spr`, `pset`, `rect`, `circ` etc. floor coords to the 128x128 grid. A sprite at `x=10.7` draws at pixel 10. Screen is 0..127 both axes, origin top-left, +y DOWN (matches #1).

**Why LLMs get it wrong:** expect anti-aliased / sub-pixel positioning. Keep the TRUE position as fixed-point for physics; PICO-8 floors at draw time (or `flr()` explicitly to control rounding on negatives).

## 9. Variables are GLOBAL unless declared `local`

PICO-8 Lua has no block-scoped-by-default; an undeclared assignment creates a GLOBAL.

**Why LLMs get it wrong:** habits from block-scoped languages leak globals across functions → cross-function state bugs. Always `local` your temporaries.

## 10. The `and`/`or` ternary breaks when the "true" value is falsy

`x = cond and a or b` returns `b` when `a` is `false` or `nil` (falls through), NOT the ternary you meant.

**Why LLMs get it wrong:** it's the idiomatic Lua ternary and looks safe, but misfires whenever `a` can legitimately be `false`/`nil`/`0`... (note: `0` is truthy in Lua, unlike C, another trap). Use an explicit `if` when the true-branch value can be falsy.

## 11. `peek`/`poke` address raw RAM; wrong addresses silently corrupt gfx/sound/state

Key regions: `0x0000` spritesheet, `0x1000` shared sprite/map, `0x2000` map, `0x3100` sfx, `0x4300` user RAM, `0x5f00` DRAW STATE (palette/camera/clip/pen live here), `0x6000` screen (4-bit packed, TWO pixels per byte), `0x8000` extended RAM (0.2.x+). `poke` truncates to a byte and wraps; use `poke2/poke4`/`peek2/peek4` for 16/32-bit.

**Why LLMs get it wrong:** invent addresses, poke un-floored floats, or treat `0x6000` as a linear RGB buffer (it's 4-bit packed). Poking the wrong region wipes sprites or crashes. Only poke documented addresses; prefer built-in draw functions.

## 12. String / code limits and PICO-8's own conventions

Cart data 32k; code max 8192 TOKENS (compressed code <15360 bytes for `.p8.png`/`.p8.rom`). `sub(s,i,j)` is 1-based and inclusive on BOTH ends (`sub("abc",2,3)`=="bc"), unlike Python slicing. Font is a fixed 4px glyph set (no arbitrary fonts); `chr`/`ord` cover PICO-8's own 0..255 charset, not Unicode.

**Why LLMs get it wrong:** generate verbose code that blows 8192 tokens; assume 0-based/exclusive slicing; reach for absent Lua string stdlib (use `sub`, `ord`, `chr`, `tostr`, `tonum`).

## Cross-references

- `pico8-api-reference.md`: the API surface and full memory map.
- `pico8-idioms-and-patterns.md`: several patterns there (animation, camera, physics) hinge on #1, #6, #7 above.
</content>
