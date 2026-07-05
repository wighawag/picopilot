-- one button: flap through gaps
function _init()
 st=0 -- 0=title 1=play 2=dead
 reset_g()
end

function reset_g()
 py=64 vy=0
 walls={}
 spawn(140)
 spawn(200)
 spawn(260)
 sc=0 t=0
end

function spawn(x)
 add(walls,{x=x,g=30+rnd(40),h=false})
end

function _update()
 if st==0 then
  if btnp(4) or btnp(5) or btnp(2) then st=1 reset_g() st=1 end
  return
 end
 if st==2 then
  if btnp(4) or btnp(5) or btnp(2) then st=0 end
  return
 end
 t+=1
 -- one button: flap
 if btn(4) or btn(5) or btn(2) then vy-=0.55 end
 vy+=0.28
 vy=mid(-3,vy,3.5)
 py+=vy
 if py<4 then py=4 vy=0 end
 if py>124 then st=2 sfx(1) return end
 -- walls move
 local spd=1.4
 for w in all(walls) do
  w.x-=spd
  if not w.h and w.x<24 then w.h=true sc+=1 sfx(2) end
  if w.x<-6 then
   del(walls,w)
   spawn(140+rnd(20))
  end
  -- collision (bird at x=24)
  if w.x>16 and w.x<32 then
   if py<w.g or py>w.g+34 then st=2 sfx(1) return end
  end
 end
end

function _draw()
 cls(1)
 -- stars
 for i=0,20 do
  pset((i*37-t)%128,(i*53)%128,5)
 end
 -- walls
 for w in all(walls) do
  rectfill(w.x,0,w.x+6,w.g,3)
  rectfill(w.x,w.g,w.x+6,w.g+1,11)
  rectfill(w.x,w.g+34,w.x+6,127,3)
  rectfill(w.x,w.g+33,w.x+6,w.g+34,11)
 end
 -- bird
 spr(1,20,py-4)
 -- score
 print(sc,2,2,7)
 if st==0 then
  rectfill(24,44,104,84,0)
  print("one button",40,50,10)
  print("press \142/\151/up",34,62,7)
  print("to flap up",42,70,6)
  print("dodge the walls",30,78,12)
 elseif st==2 then
  rectfill(30,50,98,78,0)
  print("game over",44,56,8)
  print("score: "..sc,44,64,7)
  print("press to retry",34,72,6)
 end
end
