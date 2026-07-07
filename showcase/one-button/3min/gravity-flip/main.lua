-- one button: gravity flip runner
-- press btn to flip gravity. avoid spikes. survive.

function _init()
 py=60 vy=0 grav=1
 flip_cd=0 shake=0
 obs={}
 spawn_t=50
 score=0
 alive=true
 t=0
end

function reset()
 _init()
end

function spawn()
 -- spike on floor or ceiling
 local top=(rnd(1)<0.5)
 add(obs,{x=132,top=top,hit=false})
end

function _update()
 t+=1
 if not alive then
  if btnp(4) or btnp(5) then reset() end
  return
 end

 -- flip gravity on press
 if btnp(4) or btnp(5) then
  grav=-grav
  flip_cd=6
  sfx(0)
 end
 if flip_cd>0 then flip_cd-=1 end

 vy+=grav*0.4
 py+=vy

 -- clamp to floor/ceiling
 if py>108 then py=108 vy=0 end
 if py<20 then py=20 vy=0 end

 -- spawn obstacles
 spawn_t-=1
 if spawn_t<=0 then
  spawn()
  spawn_t=45+rnd(25)
 end

 local sp=1.6+score*0.01
 for o in all(obs) do
  o.x-=sp
  if o.x<-8 then
   del(obs,o)
   score+=1
  end
  -- collision
  local px=24
  if abs(o.x-px)<7 then
   local sy=o.top and 20 or 108
   if abs(py-sy)<12 then alive=false shake=8 sfx(1) end
  end
 end
end

function _draw()
 cls(1)
 if shake>0 then camera(rnd(shake)-shake/2,rnd(shake)-shake/2) shake-=1 else camera() end
 -- ground and ceiling
 rectfill(0,116,127,127,3)
 rectfill(0,0,127,11,3)

 -- obstacles (spikes)
 for o in all(obs) do
  if o.top then
   -- ceiling spike points down
   for i=0,2 do
    line(o.x+i*3,12,o.x+i*3+1.5,20,8)
    line(o.x+i*3+3,12,o.x+i*3+1.5,20,8)
   end
  else
   for i=0,2 do
    line(o.x+i*3,116,o.x+i*3+1.5,108,8)
    line(o.x+i*3+3,116,o.x+i*3+1.5,108,8)
   end
  end
 end

 -- player
 local c=grav>0 and 12 or 10
 circfill(24,py,4,c)
 circfill(24,py,2,7)

 print("score "..score,4,4,7)

 if not alive then
  rectfill(30,50,98,74,0)
  print("game over",42,56,8)
  print("btn=restart",38,64,7)
 else
  print("btn: flip gravity",30,120,6)
 end
end
