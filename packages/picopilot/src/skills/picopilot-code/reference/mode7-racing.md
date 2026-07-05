# Mode-7 / pseudo-3D racing reference (tline floor projection)

Structure for a pseudo-3D game with a projected ground plane (arcade racer,
first-person floor). PICO-8 has no real 3D; you FAKE it by drawing the map as a
perspective-warped floor with `tline` (textured line), one horizontal scanline at
a time, each sampling the map further away as it climbs toward the horizon. This
is structurally unlike every other genre here: there are no entity-vs-tile
collisions in world pixels, the "world" is a texture you sample.

## The load-bearing rules

1. Draw the floor BOTTOM-UP: for each screen row `py` from the horizon down to the
   bottom, compute how far into the world that row is, and `tline` one row of the
   map at that depth. Rows near the bottom are close (map moves fast); rows near
   the horizon are far (map moves slowly).
2. `tline(x0,y0,x1,y1, u,v, du,dv)` draws screen pixels `x0,y0..x1,y1` sampling the
   MAP starting at map-coord `(u,v)` and stepping `(du,dv)` per pixel. The scale
   (how much world per screen pixel) is what creates perspective: bigger step near
   the bottom, smaller near the horizon.
3. Rotation uses `sin`/`cos` in TURNS (0..1). The camera angle rotates the `(du,dv)`
   sampling basis; do NOT feed radians.
4. This is CPU-heavy. Keep it to the floor; draw sprites (player, opponents) on top
   with normal `spr`, scaled by their distance.

## Minimal floor projection

```lua
-- camera: world pos (cx,cy), heading angle (ang, in TURNS), height above floor
cam={x=0,y=0,ang=0,h=16}
horizon=48   -- screen row where the floor starts (sky above)

function draw_floor()
 local ca,sa=cos(cam.ang),sin(cam.ang)
 for py=horizon,127 do
  -- depth: how far this scanline is into the world. Rows just below the horizon
  -- are very far (large scale); rows at the bottom are near. This 1/(py-horizon)
  -- shape is the perspective.
  local d=cam.h/(py-horizon+1)          -- world distance for this row
  local scale=d/64                       -- world units per screen pixel
  -- the world point at the CENTER of this scanline, then the left/right ends
  local wx=cam.x + d*ca
  local wy=cam.y + d*sa
  -- sampling basis perpendicular to heading, scaled by depth
  local du= sa*scale
  local dv=-ca*scale
  -- start at the left screen edge: back off 64 pixels along the basis
  local u=wx - du*64
  local v=wy - dv*64
  tline(0,py,127,py, u,v, du,dv)         -- one textured scanline of the map
 end
end
```

Tune `horizon`, `cam.h`, and the `d`/`scale` constants to taste; the exact numbers
depend on your track's map scale. The SHAPE (1/row depth, perpendicular basis from
`sin`/`cos`, `tline` per row) is what matters.

## Driving (heading + speed, no tile collision in the usual sense)

```lua
speed=0
function update_car()
 if btn(2) then speed=min(speed+0.1,4) end   -- accelerate
 if btn(3) then speed=max(speed-0.1,0) end   -- brake
 if btn(0) then cam.ang-=0.005*speed end     -- steer (turn amount scales w/ speed)
 if btn(1) then cam.ang+=0.005*speed end
 -- move along heading (TURNS: cos/sin)
 cam.x+=cos(cam.ang)*speed
 cam.y+=sin(cam.ang)*speed
end
```

Off-track detection reads the map tile under the car (`mget(cam.x\8, cam.y\8)`) and
slows the car, rather than blocking movement like a platformer wall.

## Draw order

```lua
function _draw()
 cls(12)          -- sky
 draw_floor()     -- projected map
 draw_opponents() -- spr, scaled by distance, sorted far-to-near
 draw_hud()       -- speed, lap; camera is not offset here (floor is drawn directly)
end
```

## Genre pitfalls checklist

- [ ] Floor drawn per-scanline with `tline`, horizon down to row 127.
- [ ] Depth uses a 1/(row) shape so far rows compress toward the horizon.
- [ ] Rotation via `sin`/`cos` in TURNS; sampling basis is perpendicular to heading.
- [ ] It is CPU-heavy: profile with `picopilot run`, keep the floor loop tight,
      consider `_update60`->`_update` (30fps) if it cannot keep up.
- [ ] Sprites drawn on top, scaled and sorted by distance, NOT via the floor.
- [ ] Off-track is a tile lookup that slows you, not a solid-wall collision.
