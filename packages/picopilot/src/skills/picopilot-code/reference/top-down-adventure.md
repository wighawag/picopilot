# Top-down adventure reference (tiled world, 4-dir movement, interaction)

Structure for a top-down explorer (action-adventure, RPG overworld). The player walks a
tiled world in 4 (or 8) directions, collides with solid tiles, the camera follows
across a map larger than the screen, and the player interacts with specific tiles
(doors, chests, NPCs). Unlike the platformer there is no gravity; unlike the
puzzle grid, movement is smooth pixel motion, not cell-stepping.

## The load-bearing rules

1. The player has a pixel position and a FACING direction. Movement is smooth
   (pixels/frame), but collision is still tested against map tiles via
   `mget`/`fget`.
2. Resolve X and Y separately (same axis-by-axis idea as the platformer) so the
   player slides along walls instead of sticking on corners.
3. Facing is state you keep for animation AND for "what am I interacting with"
   (the tile in front of the player).
4. The map is bigger than 128x128: `camera` follows the player and CLAMPs to the
   map's pixel bounds. `map()` draws the whole tilemap in world space.

## Movement + per-axis wall collision

```lua
speed=1.5
player={x=64,y=64,face=3}   -- face: 0 left,1 right,2 up,3 down (btn order)

function solid(x,y) return fget(mget(x\8,y\8),0) end   -- flag 0 = solid
function blocked(x,y)  -- 8x8 body, four corners
 return solid(x,y) or solid(x+7,y) or solid(x,y+7) or solid(x+7,y+7)
end

function update_player(p)
 local dx,dy=0,0
 if btn(0) then dx=-speed p.face=0 end
 if btn(1) then dx=speed  p.face=1 end
 if btn(2) then dy=-speed p.face=2 end
 if btn(3) then dy=speed  p.face=3 end

 -- resolve X then Y separately (slide along walls)
 if not blocked(p.x+dx,p.y) then p.x+=dx end
 if not blocked(p.x,p.y+dy) then p.y+=dy end
end
```

## The tile in front (interaction target)

```lua
fdx=split"-1,1,0,0"   -- indexed by face+1: left,right,up,down
fdy=split"0,0,-1,1"

function front_tile(p)
 -- the map cell one step ahead in the facing direction
 local fx=p.x+4 + fdx[p.face+1]*8   -- +4 = center of the 8px body
 local fy=p.y+4 + fdy[p.face+1]*8
 return fx\8, fy\8
end

function _update()
 update_player(player)
 if btnp(4) then           -- action button: interact with the tile ahead
  local tx,ty=front_tile(player)
  local s=mget(tx,ty)
  if s==CHEST then mset(tx,ty,CHEST_OPEN) got_item() end
  -- doors, signs, NPCs: branch on the sprite id at (tx,ty)
 end
end
```

## Camera follow with map-edge clamp

```lua
-- map_w,map_h = map size in PIXELS (tiles*8).
function update_camera(p)
 local cx=mid(0, p.x-64, map_w-128)
 local cy=mid(0, p.y-64, map_h-128)
 camera(cx,cy)
end

function _draw()
 cls()
 update_camera(player)
 map()                       -- whole tilemap, world space
 spr(walk_frame(player), flr(player.x), flr(player.y), 1,1, player.face==0)
 camera()                    -- RESET before the HUD
 draw_hud()
end
```

## Rooms / streaming (optional, for large worlds)

Two common approaches:
- One big shared map, camera just moves over it (simplest; limited by the 128x32
  map size, extendable with the shared bank).
- Room-based: each screen is a fixed 16x16 tile region; when the player crosses
  an edge, snap the camera to the next room and reposition the player. Store room
  coords, draw `map(room_c*16, room_r*16, 0,0, 16,16)`.

## Animation (frame per facing + walk cycle)

```lua
-- 2-frame walk per direction; base sprite per facing in a split lookup.
face_base=split"16,16,32,48"   -- left/right share sprites, flipped
function walk_frame(p)
 local moving = btn(0) or btn(1) or btn(2) or btn(3)
 local step = moving and flr(t()*4%2) or 0
 return face_base[p.face+1]+step
end
```

## Genre pitfalls checklist

- [ ] Movement is smooth pixel motion, but collision still tests map tiles.
- [ ] X and Y resolved separately (wall-slide, no corner-stick).
- [ ] Facing is kept as state and drives BOTH animation and interaction target.
- [ ] Interaction reads the tile ONE step ahead in the facing direction.
- [ ] Camera follows and clamps to the map's PIXEL bounds; reset before HUD.
- [ ] `btnp` for the discrete action button; `btn` for continuous walking.
