# Twin-stick / arcade reference (many entities, spawn/despawn, juice)

Structure for an action arcade cart (shooter, bullet-hell, wave survival). The
defining problem is MANY short-lived entities at once (bullets, enemies,
particles) that spawn and despawn every frame. Get the entity-list lifecycle and
the despawn-while-iterating right, then layer on the "juice" that makes arcade
carts feel good. Shipped arcade carts are `rnd`-heavy for exactly that juice.

## The load-bearing rules

1. One flat list per KIND (`bullets`, `enemies`, `particles`), each entity a
   table. `add` to spawn, `del`/`deli` to despawn.
2. Despawn safely. Deleting the CURRENT item inside `foreach` is safe. Deleting
   inside an ASCENDING `for i=1,#list` is NOT (it errors once the list shrinks).
   Use `foreach`, or iterate DESCENDING when you delete by index.
3. Off-screen or dead entities must be removed, or the list grows unbounded and
   the cart slows/crashes. Cull every frame.
4. Movement is velocity-based and free (no grid, no gravity unless you want it).
   `sin`/`cos` take TURNS (0..1) for aiming/spread.

## Entity lists + safe cull

```lua
bullets={}
enemies={}
parts={}

function fire(x,y,ang,spd)
 -- ang in TURNS (0..1). sin is screen-inverted, so this aims correctly on screen.
 add(bullets,{x=x,y=y,dx=cos(ang)*spd,dy=sin(ang)*spd,life=90})
end

function update_bullets()
 foreach(bullets,function(b)
  b.x+=b.dx b.y+=b.dy b.life-=1
  -- cull off-screen OR expired; del of the CURRENT item under foreach is safe
  if b.life<=0 or b.x<-4 or b.x>131 or b.y<-4 or b.y>131 then
   del(bullets,b)
  end
 end)
end
```

## Spawning waves + aiming at the player

```lua
function spawn_enemy()
 -- rnd picks a random screen edge; flr for an integer choice
 add(enemies,{x=flr(rnd(128)),y=-8,hp=3})
end

function enemy_shoot(e)
 -- atan2 gives the turn-angle from e to the player; feed it straight to fire()
 fire(e.x,e.y, atan2(player.x-e.x, player.y-e.y), 1.5)
end
```

## Particles / juice (why arcade carts call rnd a lot)

```lua
function burst(x,y,col,n)
 for i=1,n do
  local a=rnd()               -- random turn 0..1
  local s=0.5+rnd(1.5)        -- random speed
  add(parts,{x=x,y=y,dx=cos(a)*s,dy=sin(a)*s,life=10+rnd(10),col=col})
 end
end

function update_parts()
 foreach(parts,function(p)
  p.x+=p.dx p.y+=p.dy p.dx*=0.9 p.dy*=0.9 p.life-=1
  if p.life<=0 then del(parts,p) end
 end)
end

function draw_parts()
 foreach(parts,function(p) pset(p.x,p.y,p.col) end)
end
```

Screen shake is a cheap, high-impact juice: offset the camera by a decaying
random amount, then RESET it.

```lua
shake=0
function add_shake(n) shake=max(shake,n) end
function apply_shake()
 if shake>0 then
  camera(rnd(shake)-shake/2, rnd(shake)-shake/2)  -- random offset
  shake*=0.8
  if shake<0.5 then shake=0 end
 else
  camera()   -- no shake: ensure camera is reset (draw state persists!)
 end
end
```

## Collision (cheap circle test for round-ish sprites)

```lua
-- squared-distance test avoids sqrt. r = sum of radii.
function hit(a,b,r)
 local dx,dy=a.x-b.x,a.y-b.y
 return dx*dx+dy*dy < r*r
end
```

## Draw + reset discipline

```lua
function _draw()
 cls()
 apply_shake()
 map() ; foreach(enemies,draw_enemy) ; foreach(bullets,draw_bullet) ; draw_parts()
 camera()          -- RESET before HUD (shake/camera persist otherwise)
 print("score "..score,2,2,7)
end
```

## Genre pitfalls checklist

- [ ] Each entity KIND is its own list; entities are tables.
- [ ] Despawn uses `foreach`+`del` (safe) or a descending index loop, never an
      ascending `for i=1,#list` with in-loop `del`.
- [ ] Off-screen/dead entities are culled EVERY frame (no unbounded growth).
- [ ] Angles are TURNS (0..1); `atan2`/`sin`/`cos` used consistently.
- [ ] `rnd(x)` wrapped with `flr` when an integer is needed.
- [ ] `camera()` reset after any shake, before the HUD.
