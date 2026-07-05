---
title: PICO-8 game-programming idioms and patterns (the structural things an LLM gets wrong)
slug: pico8-idioms-and-patterns
source: 'General PICO-8 game-programming knowledge, cross-checked against the official PICO-8 manual. The foreach-vs-numeric-loop deletion claim in §2 was TESTED LIVE against a local PICO-8 install on 2026-07-04 (the ascending numeric loop errors once the list shrinks; foreach is safe).'
---

# PICO-8 idioms and patterns (for picopilot agent context)

Verified external/domain ground truth: the STRUCTURAL patterns of a working PICO-8 game and the specific mistakes an LLM makes writing them. This is the companion to `pico8-api-reference.md`: that finding is the flat API surface (what functions exist); THIS one is how to compose them into a correct, non-buggy game loop. The failure modes here are almost never wrong API calls (easy to look up). They are structure: iterating a list while mutating it, resolving collision on both axes at once, tuning physics for the wrong framerate, letting draw state leak across frames.

Scope discipline (per the "better AND correct carts" north star): each entry is a NAMED pattern + a minimal correct PICO-8-flavoured snippet + the LLM mistake it prevents. No API-list filler (that lives in the API reference).

## 1. Game loop + state machine (menu / play / gameover)

One `scene` (or `state`) string; BOTH `_update` and `_draw` branch on it. Re-init per-scene variables on entry, not in the global `_init`.

```lua
function _init() scene="menu" end

function _update()
  if scene=="menu" then
    if btnp(4) then scene="play" init_play() end
  elseif scene=="play" then
    update_play()
    if player.dead then scene="over" end
  elseif scene=="over" then
    if btnp(4) then scene="menu" end
  end
end

function _draw()
  cls()
  if scene=="menu" then print("press z to start",32,60,7)
  elseif scene=="play" then draw_play()
  elseif scene=="over" then print("game over",44,60,8) end
end
```

**LLM mistake:** branches state only in `_update` but draws everything unconditionally in `_draw` (menu bleeds into gameplay); or puts game logic in `_draw` (which PICO-8 skips under load, see the gotchas finding); or forgets to re-init per-scene state so replay #2 starts stale. Rule: state-specific vars belong in that state's init, not global `_init`.

## 2. Entity / actor lists (add / del / foreach)

Actors in a table; `add(list,a)` to spawn, `del(list,a)` to remove, `foreach` to iterate. Give each actor `update`/`draw` so the main loop stays flat.

```lua
actors={}
function spawn(x,y) add(actors,{x=x,y=y,dx=0,dy=0,dead=false}) end

function _update()
  foreach(actors,function(a)
    a.x+=a.dx a.y+=a.dy
    if a.dead then del(actors,a) end
  end)
end
function _draw() cls() foreach(actors,function(a) spr(1,a.x,a.y) end) end
```

**LLM mistake:** deleting during a forward numeric `for i=1,#actors do` loop. TESTED live against PICO-8: `del` shifts the array down, so an ascending numeric loop reads PAST the shrunk length and **crashes** (`attempt to perform arithmetic on a nil value`). Two safe forms, both verified: (a) `foreach(actors, fn)` is SAFE to `del(actors, current)` inside: it visits every original element and does not skip (this is why the snippet above uses `foreach`); (b) a DESCENDING numeric loop `for i=#actors,1,-1 do ... end`. Do NOT cache `#actors` in a local and then mutate the list mid-loop. (Correcting an earlier draft that said numeric-forward merely "skips": it actually errors once the length shrinks below the index.)

## 3. Map / tile collision via flags (mget + fget)

Pixel → tile with `\8` (integer divide), read the sprite with `mget`, test its flag with `fget`. Flag 0 conventionally = "solid".

```lua
function solid(x,y) return fget(mget(x\8,y\8),0) end
function hits_wall(a)  -- 8x8 actor: check all four corners, extent x..x+7
  return solid(a.x,a.y)   or solid(a.x+7,a.y)
      or solid(a.x,a.y+7) or solid(a.x+7,a.y+7)
end
```

**LLM mistake:** passing pixel coords straight into `mget`/`fget` without `\8` (checks tile 48,32 instead of 6,4); checking only the top-left corner (clips halfway into walls); using `x+8`/`y+8` (one past the 0..7 sprite extent) which reads the NEXT tile → phantom collisions. Correct extent for an 8px sprite is `x` to `x+7`.

## 4. Player movement + gravity / platformer physics

Accumulate velocity (`dx`,`dy`); apply gravity/friction to VELOCITY; then move and resolve collision AXIS BY AXIS.

```lua
gravity=0.3 friction=0.85
function update_player(p)
  if btn(0) then p.dx-=0.5 end
  if btn(1) then p.dx+=0.5 end
  if btnp(4) and p.grounded then p.dy=-4 end
  p.dy+=gravity p.dx*=friction
  p.x+=p.dx if hits_wall(p) then p.x-=p.dx p.dx=0 end   -- resolve X
  p.y+=p.dy p.grounded=false                            -- then resolve Y
  if hits_wall(p) then
    p.y-=p.dy
    if p.dy>0 then p.grounded=true end
    p.dy=0
  end
end
```

**LLM mistakes:** moves X and Y together then does one collision test (player sticks in corners, can't slide, so resolve each axis separately); applies gravity as a POSITION offset (`p.y+=gravity`) so the fall never accelerates; never resets `grounded` to false after leaving ground → infinite mid-air jumps; tunes gravity/jump for 60fps when `_update` is 30fps (use `_update60()` if you want 60; you cannot have both).

## 5. Camera / scrolling

Center on the player with a half-screen offset, then CLAMP to level bounds with `mid()`. Reset the camera before drawing the HUD.

```lua
function update_camera(p)
  local cx = mid(0, p.x-64+4, level_w-128)  -- +4 = half the 8px sprite; mid = clamp
  camera(cx,0)
end
```

**LLM mistakes:** forgets `camera()` is PERSISTENT (stays set for HUD draws → score scrolls off with the world); fix is `camera()` (no args) before UI. Off-by-64 (uses `p.x` directly → player pinned to left edge). Omits the `mid()` clamp → empty space shows past the map edge.

## 6. Animation (frame cycling via time)

Derive the frame from a counter, `%` to loop, `flr` to step. `spr`'s 6th arg is `flip_x` (boolean).

```lua
function anim_frame(base,frames,speed) return base+flr(t()*speed%frames) end
function draw_player(p)
  spr(anim_frame(1,4,4), p.x,p.y, 1,1, p.dx<0)  -- flip when moving left
end
y_bob = 60 + sin(t()/2)*3   -- sin takes 0..1 TURNS, not radians (see gotchas)
```

**LLM mistakes:** advances the frame every update with no `speed` divisor (cycles 30x/sec = noise); forgets `%frames` (index runs off into unrelated sprites); passes a facing INTEGER as the flip arg instead of a boolean; calls `sin`/`cos` expecting radians (see `pico8-gotchas.md`).

## 7. Token-saving structural idioms

The 8192-token budget rewards structure, not brevity of lines. (Each shorthand op is one token.)

```lua
p={x=64,y=64,dx=0,dy=0}         -- table constructor, not per-field assignment
x,y = 64,64                     -- multiple assignment
p.dx+=1                         -- += -= *= /= %= (one token each)
if(dead) del(actors,self)       -- shorthand if: single stmt, one line, PARENS required, NO then/end
foreach(actors, update_actor)   -- bare function ref, no closure
for w in all(split"a,b,c") do add(names,w) end  -- build tables from split strings
```

**LLM mistakes:** verbose per-field assignment + manual `for i=1,#t do`; misusing the shorthand `if(cond) stmt` (adding `then`, or cramming multiple statements); reaching for standard-Lua stdlib PICO-8 lacks (`math.floor` → use `flr`; `table.remove` → use `del`/`deli`; string stdlib → use `sub`/`ord`/`chr`).

## Cross-references

- `pico8-api-reference.md`: the flat API surface these patterns compose.
- `pico8-gotchas.md`: the per-function surprising behaviours (sin/cos, `/` vs `\`, fixed-point, persistent draw state) that several patterns above hinge on.
</content>
