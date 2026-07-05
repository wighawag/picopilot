# Platformer reference (side-view, gravity + tile collision)

Structure for a side-scrolling platformer: the player has velocity, gravity
pulls it down, and collision is resolved AXIS BY AXIS against solid map tiles.
This is the shape that gets platformers wrong most often, so follow the axis
order and the corner checks exactly.

## The load-bearing rules (get these wrong and it feels broken)

1. Gravity and input change VELOCITY (`dx`,`dy`), never position directly. A
   fall must ACCELERATE, so `dy += gravity` each frame, not `y += gravity`.
2. Move and resolve X FIRST, then Y SEPARATELY. Moving both then testing once
   sticks the player in corners and forbids wall-sliding.
3. An 8px sprite occupies pixels `x .. x+7` (NOT `x+8`). Check tile collision at
   all four corners; `x+8` reads the NEXT tile and gives phantom collisions.
4. Reset `grounded` to false every frame BEFORE the Y resolve, then set it true
   only when a downward move hits a floor. Otherwise jump never re-arms (or
   arms forever = infinite mid-air jumps).
5. `_update` is 30fps. Tune `gravity`/jump for 30 steps/sec, or switch the whole
   cart to `_update60()` and tune for 60. Do not mix.

## Solid-tile test (map flag 0 = solid, by convention)

```lua
-- pixel (x,y) -> is its map tile solid? flag 0 set = solid.
function solid(x,y) return fget(mget(x\8,y\8),0) end

-- 8x8 actor a: any of its four corners on a solid tile?
function hits(a)
 return solid(a.x,a.y)   or solid(a.x+7,a.y)
     or solid(a.x,a.y+7) or solid(a.x+7,a.y+7)
end
```

## Player update (input -> velocity -> per-axis move+resolve)

```lua
gravity=0.3
accel=0.5
friction=0.85
jump=-4

function make_player(x,y)
 return {x=x,y=y,dx=0,dy=0,grounded=false}
end

function update_player(p)
 -- input into horizontal velocity
 if btn(0) then p.dx-=accel end
 if btn(1) then p.dx+=accel end
 -- jump only when standing
 if btnp(4) and p.grounded then p.dy=jump end

 -- physics on velocity
 p.dy+=gravity
 p.dx*=friction

 -- resolve X
 p.x+=p.dx
 if hits(p) then
  -- back out and stop horizontal motion (simple, non-swept)
  p.x-=p.dx p.dx=0
 end

 -- resolve Y (reset grounded first)
 p.y+=p.dy
 p.grounded=false
 if hits(p) then
  p.y-=p.dy
  if p.dy>0 then p.grounded=true end  -- landed on a floor
  p.dy=0
 end
end
```

## Camera follow with level-edge clamp

```lua
-- level_w = level width in PIXELS. mid() clamps so you never scroll past the map.
function update_camera(p)
 local cx=mid(0, p.x-64+4, level_w-128)  -- +4 centers the 8px sprite
 camera(cx,0)
end

function _draw()
 cls()
 update_camera(player)
 map()              -- draw the tilemap in world space
 draw_player(player)
 camera()           -- RESET before HUD or the score scrolls off with the world
 print("score "..score,2,2,7)
end
```

## Animation (walk cycle from a timer, flip when facing left)

```lua
function draw_player(p)
 -- 4-frame walk (sprites 1..4), advancing ~every 8 update frames; flip when moving left
 local s=1+flr(t()*4%4)
 spr(s, flr(p.x), flr(p.y), 1,1, p.dx<0)   -- 6th arg = flip_x (boolean)
end
```

## Genre pitfalls checklist

- [ ] Gravity accumulates into `dy`, not into `y`.
- [ ] X resolved, THEN Y resolved (two separate move+test blocks).
- [ ] Corner checks use `x+7`/`y+7`, not `x+8`/`y+8`.
- [ ] `grounded` reset to false each frame before the Y resolve.
- [ ] Constants tuned for the actual framerate (`_update` = 30, `_update60` = 60).
- [ ] `camera()` reset before drawing the HUD.

## Level fast (high speed) tunneling

Backing out the whole move (`p.x-=p.dx`) is fine at low speeds. If an actor can
move more than ~4-6 px/frame it can tunnel THROUGH a 1-tile wall. When you need
that, step the move in 1px increments (or sub-steps) and test each step, instead
of one big move + one test.
