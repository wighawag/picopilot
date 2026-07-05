-- rogue: a tiny grid roguelike.
-- grid-step movement (btnp), map-tile walls (mget/fget), turn-based enemies,
-- one gem to grab and an exit to reach. deliberately small: the workflow is
-- the star.

-- tile sprite ids (drawn later via `picopilot gfx set`)
floor=0
wall=1
gem=3
exit=4

-- the room, one string per row. #=wall .=floor g=gem e=exit @=player start.
-- 15 wide x 13 tall, offset to (1,1) on the map so it sits on screen.
room=split(
 "###############,"..
 "#.....#.......#,"..
 "#.@...#...g...#,"..
 "#.....#.......#,"..
 "#.....#.......#,"..
 "#..........####,"..
 "#..............,"..
 "#..........####,"..
 "#.....#.......#,"..
 "#..m..#.......#,"..
 "#.....#.m.....#,"..
 "#.....#......e#,"..
 "###############",
 ",")

ox,oy=1,1        -- map offset (top-left tile of the room)
player={c=0,r=0}
enemies={}
has_gem=false
won=false
dead=false
turns=0
msg="find the gem, reach the door"

function _init()
 enemies={} has_gem=false won=false dead=false turns=0
 -- flag 0 = solid. set it on the wall sprite so fget/mget collision works.
 fset(wall,0,true)
 -- stamp the room string into the real tilemap, and spawn actors.
 for r=1,#room do
  local line=room[r]
  for c=1,#line do
   local ch=sub(line,c,c)
   local mc,mr=ox+c-1,oy+r-1
   if ch=="#" then mset(mc,mr,wall)
   else mset(mc,mr,floor) end
   if ch=="@" then player.c,player.r=mc,mr
   elseif ch=="g" then mset(mc,mr,gem)
   elseif ch=="e" then mset(mc,mr,exit)
   elseif ch=="m" then add(enemies,{c=mc,r=mr}) end
  end
 end
end

-- solid = the tile at (c,r) has flag 0 set (a wall).
function solid(c,r) return fget(mget(c,r),0) end

-- is an enemy occupying this cell?
function enemy_at(c,r)
 for e in all(enemies) do
  if e.c==c and e.r==r then return e end
 end
end

-- one enemy step: move one tile toward the player, axis with the bigger gap
-- first, but never into a wall or another enemy.
function step_enemy(e)
 local dc=player.c-e.c
 local dr=player.r-e.r
 local sc=sgn(dc)
 local sr=sgn(dr)
 -- try the dominant axis, then the other.
 if abs(dc)>=abs(dr) then
  if try_enemy(e,sc,0) then return end
  try_enemy(e,0,sr)
 else
  if try_enemy(e,0,sr) then return end
  try_enemy(e,sc,0)
 end
end

function try_enemy(e,dc,dr)
 if dc==0 and dr==0 then return false end
 local nc,nr=e.c+dc,e.r+dr
 if solid(nc,nr) then return false end
 if enemy_at(nc,nr) then return false end
 e.c,e.r=nc,nr
 return true
end

-- a full turn: the player attempts a step, then every enemy takes one.
function take_turn(dc,dr)
 local nc,nr=player.c+dc,player.r+dr
 if solid(nc,nr) then return end        -- walked into a wall: no turn
 player.c,player.r=nc,nr
 -- pick up the gem
 if mget(nc,nr)==gem then
  has_gem=true
  mset(nc,nr,floor)
  msg="got the gem! reach the door"
 end
 -- reach the exit (only counts with the gem)
 if mget(nc,nr)==exit and has_gem then
  won=true
  msg="you escaped! (x to reset)"
  return
 end
 -- stepping onto an enemy is a catch too
 check_death()
 if dead then return end
 -- enemies chase at HALF speed (every other turn), so the player can outrun
 -- them. classic roguelike device; without it the layout is unwinnable.
 turns+=1
 if turns%2==0 then
  for e in all(enemies) do step_enemy(e) end
  check_death()
 end
end

-- caught if an enemy shares the player's cell.
function check_death()
 if enemy_at(player.c,player.r) then
  dead=true
  msg="caught! (x to reset)"
 end
end

function _update()
 if won or dead then
  if btnp(5) then _init() won=false dead=false msg="find the gem, reach the door" end
  return
 end
 if btnp(0) then take_turn(-1,0)
 elseif btnp(1) then take_turn(1,0)
 elseif btnp(2) then take_turn(0,-1)
 elseif btnp(3) then take_turn(0,1) end
end

function _draw()
 cls(0)
 map(0,0,0,0,17,15)
 for e in all(enemies) do spr(2,e.c*8,e.r*8) end
 spr(5,player.c*8,player.r*8)
 print(msg,4,120,7)
end
