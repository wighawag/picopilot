-- simple platformer — main.lua
-- edit this file; main.p8 just #includes it.

-- player state
local p={
 x=48,y=48,   -- position (top-left)
 dx=0,dy=0,   -- velocity
 w=8,h=8,     -- size
 grounded=false,
 face=1,      -- 1=right, -1=left
}

-- world: solid platforms as {x,y,w,h} rectangles (swapped for map tiles later)
-- spaced as a climbable staircase: each ~18px above the previous foothold,
-- within one jump's reach (see jump-height note below).
local plats={
 {0,120,128,8},   -- ground        (stand at y=112)
 {16,102,40,8},   -- step 1        (stand at y=94, +18 from ground)
 {72,84,40,8},    -- step 2        (stand at y=76, +18 from step 1)
 {24,66,40,8},    -- step 3 (top)  (stand at y=58, +18 from step 2)
}

-- tuning
-- jump height = jump_vel^2 / (2*gravity) = 4.5^2/(2*0.4) ~= 25px, comfortably
-- clearing the ~18px stair spacing above with a little margin for the landing.
local gravity=0.4
local move_spd=1.5
local jump_vel=-4.5

function _init()
end

-- axis-aligned overlap test
local function hit(ax,ay,aw,ah,b)
 return ax+aw>b[1] and ax<b[1]+b[3]
    and ay+ah>b[2] and ay<b[2]+b[4]
end

function _update()
 -- horizontal input
 p.dx=0
 if btn(0) then p.dx=-move_spd p.face=-1 end
 if btn(1) then p.dx= move_spd p.face= 1 end

 -- jump (btn 4 = z/c) only when grounded
 if btn(4) and p.grounded then
  p.dy=jump_vel
  p.grounded=false
 end

 -- gravity
 p.dy+=gravity

 -- move + resolve x
 p.x+=p.dx
 for pl in all(plats) do
  if hit(p.x,p.y,p.w,p.h,pl) then
   if p.dx>0 then p.x=pl[1]-p.w
   elseif p.dx<0 then p.x=pl[1]+pl[3] end
  end
 end

 -- move + resolve y
 p.y+=p.dy
 p.grounded=false
 for pl in all(plats) do
  if hit(p.x,p.y,p.w,p.h,pl) then
   if p.dy>0 then
    p.y=pl[2]-p.h
    p.dy=0
    p.grounded=true
   elseif p.dy<0 then
    p.y=pl[2]+pl[4]
    p.dy=0
   end
  end
 end

 -- keep in screen horizontally
 p.x=mid(0,p.x,120)
end

function _draw()
 cls(1) -- dark-blue bg

 -- platforms
 for pl in all(plats) do
  rectfill(pl[1],pl[2],pl[1]+pl[3]-1,pl[2]+pl[4]-1,4) -- brown
 end

 -- player sprite (sprite 1); the sprite is drawn facing left, so flip when facing right
 spr(1,p.x,p.y,1,1,p.face==1)

 print("arrows: move  z: jump",4,4,7)
end
