-- ONE BUTTON: gravity flip runner
function _init()
 reset_game()
end

function reset_game()
 py=64 vy=0 grav=1
 obs={}
 spawnt=0
 score=0
 dead=false
 started=false
 t=0
end

function spawn()
 -- gap either top or bottom
 local top=rnd(1)<0.5
 local h=20+rnd(30)
 add(obs,{x=128,h=h,top=top,scored=false})
end

function _update()
 if dead then
  if btnp(4) then reset_game() end
  return
 end
 if not started then
  if btnp(4) then started=true grav=-grav sfx(0) end
  return
 end
 t+=1
 -- one button: flip gravity
 if btnp(4) then grav=-grav sfx(0) end
 vy+=grav*0.4
 py+=vy
 -- clamp/floor-ceiling death
 if py<4 or py>124 then dead=true end
 -- obstacles
 spawnt-=1
 if spawnt<=0 then spawn() spawnt=42 end
 local spd=2+score*0.05
 for o in all(obs) do
  o.x-=spd
  if o.x<-8 then del(obs,o) end
  -- score
  if not o.scored and o.x<24 then o.scored=true score+=1 end
  -- collision: player at x=24, r=3
  if o.x<28 and o.x>16 then
   local py1=py
   if o.top then
    if py1-3<o.h then dead=true end
   else
    if py1+3>128-o.h then dead=true end
   end
  end
 end
end

function _draw()
 cls(1)
 -- ground/ceiling
 rectfill(0,0,127,3,5)
 rectfill(0,124,127,127,5)
 -- obstacles
 for o in all(obs) do
  if o.top then
   rectfill(o.x,4,o.x+7,o.h,8)
  else
   rectfill(o.x,128-o.h,o.x+7,123,8)
  end
 end
 -- player
 circfill(24,py,3,12)
 -- gravity indicator arrow
 if grav>0 then
  print("v",22,py-10,7)
 else
  print("^",22,py+6,7)
 end
 print("score:"..score,4,6,7)
 if not started then
  rectfill(20,48,108,80,0)
  print("ONE BUTTON",42,52,10)
  print("Z FLIPS GRAVITY",28,62,7)
  print("DODGE THE SPIKES",24,70,12)
 elseif dead then
  rectfill(28,52,100,76,0)
  print("GAME OVER",38,58,8)
  print("Z=RETRY",44,66,7)
 else
  print("Z:FLIP",4,116,6)
 end
end
