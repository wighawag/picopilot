-- ONE SHOT  (theme: one button)
-- a stationary turret at bottom-center. an aim reticle sweeps the
-- sky on a fixed rhythm (metronome). ONE button: tap=fire along the
-- current aim line, hold=charge a wider blast. shoot meteors before
-- they hit the city. survive the waves.

function _init()
 st="title" -- title/play/win/lose
 reset_game()
end

function reset_game()
 tx=64 ty=118        -- turret pos
 ang=0.25            -- aim angle (turns); pointing up
 sweepdir=1
 sweepspd=0.006
 met={}              -- meteors
 shots={}            -- active laser flashes
 parts={}            -- particles
 charge=0
 wave=1
 spawnt=0
 spawngap=70
 killed=0
 towin=8            -- meteors to kill this wave
 lives=4
 score=0
 combo=0
 combot=0
 shake=0
 msg=""
 msgt=0
 boss=nil
end

function start_boss()
 set_msg("** mothership! **")
 boss={x=64,y=22,dir=1,hp=6,mhp=6,dropt=0,flash=0}
 met={}
end

function update_boss()
 local b=boss
 b.x+=b.dir*0.7
 if b.x>104 then b.x=104 b.dir=-1 end
 if b.x<24 then b.x=24 b.dir=1 end
 if b.flash>0 then b.flash-=1 end
 -- rain meteors while alive
 b.dropt+=1
 if b.dropt>=52 then
  b.dropt=0
  spawn_met(0,b.x+rnd(20)-10,0.9+rnd(0.4))
 end
end

function _update()
 if st=="title" then
  if btnp(4) or btnp(5) then reset_game() st="play" music(0) end
  return
 end
 if st=="win" or st=="lose" then
  if btnp(4) or btnp(5) then st="title" end
  return
 end

 -- aim sweep (metronome across the top)
 ang+=sweepspd*sweepdir
 if ang>0.42 then ang=0.42 sweepdir=-1 end
 if ang<0.08 then ang=0.08 sweepdir=1 end

 -- button: hold to charge, release/tap to fire
 if btn(4) or btn(5) then
  charge=min(charge+1,45)
 else
  if charge>0 then
   fire(charge)
   charge=0
  end
 end

 -- spawn meteors (normal waves). during boss, the boss rains them.
 if not boss then
  spawnt+=1
  if spawnt>=spawngap then
   spawnt=0
   spawn_met()
  end
 else
  update_boss()
 end

 -- update meteors
 for m in all(met) do
  m.x+=m.vx
  m.y+=m.vy
  if m.flash then m.flash-=1 if m.flash<=0 then m.flash=nil end end
  if m.y>=118 then
   -- hit the city
   del(met,m)
   lives-=1
   combo=0 combot=0
   shake=8
   sfx(2)
   set_msg("city hit!")
   if lives<=0 then st="lose" music(-1) end
  end
 end

 -- update shots (short flash lines that test a hit)
 for s in all(shots) do
  s.life-=1
  if s.life<=0 then del(shots,s) end
 end

 -- particles
 for p in all(parts) do
  if p.ring then p.ring+=1.6 else p.x+=p.vx p.y+=p.vy p.vy+=0.15 end
  p.life-=1
  if p.life<=0 then del(parts,p) end
 end

 if shake>0 then shake-=1 end
 if combot>0 then combot-=1 if combot<=0 then combo=0 end end

 -- wave complete (waves 1-4 ramp; clearing 4 summons the BOSS)
 if not boss and killed>=towin then
  wave+=1
  killed=0
  towin+=3
  spawngap=max(28,spawngap-9)
  sweepspd+=0.0012
  if wave==3 then set_msg("pink splits! hold to blast")
  elseif wave==4 then set_msg("blue armor! hold to break")
  elseif wave==5 then start_boss()
  else set_msg("wave "..wave.."!") end
 end

 if msgt>0 then msgt-=1 end
end

function set_msg(m)
 msg=m msgt=45
end

-- score a kill and grow the combo streak (multiplier = 1 + combo\4)
function addscore(base)
 local mult=1+combo\4
 score+=base*mult
 combo+=1
 combot=90  -- ~3s to keep the streak alive
end

function spawn_met(kind,px,pspd)
 local x=px or 8+rnd(112)
 local tgt=40+rnd(80)  -- aim toward lower screen
 local spd=pspd or 0.5+rnd(0.4)+wave*0.06
 -- pick a type: splitters from wave 3, armored from wave 4
 local k=kind
 if not k then
  k=0
  local roll=rnd(1)
  if wave>=4 and roll<0.28 then k=2
  elseif wave>=3 and roll<0.55 then k=1 end
 end
 local dx=tgt-x
 local dist=sqrt(dx*dx+120*120)
 add(met,{
  x=x,y=-6,
  vx=dx/dist*spd,
  vy=120/dist*spd,
  k=k,        -- 0 normal 1 splitter 2 armored
  hp=k==2 and 1 or 1,
 })
end

function fire(c)
 sfx(0)
 -- beam radius grows with charge (tap is usable, hold is forgiving)
 local r=3+c*0.18
 -- direction from turret along aim angle
 local dx=cos(ang)
 local dy=sin(ang)  -- pico8 sin is pre-inverted: sin(.25)=-1 -> up
 add(shots,{x=tx,y=ty,dx=dx,dy=dy,r=r,life=6})
 shake=min(shake+2,6)
 -- test every meteor: distance from the beam line/point sweep
 -- sample points along the beam
 for m in all(met) do
  local hit=false
  for i=0,140,4 do
   local bx=tx+dx*i
   local by=ty+dy*i
   local ddx=m.x-bx
   local ddy=m.y-by
   if ddx*ddx+ddy*ddy < (r+3)*(r+3) then hit=true break end
  end
  if hit then
   local heavy=c>=18  -- a charged blast
   if m.k==2 and not heavy then
    -- armored: taps just chip it (feedback, no kill)
    m.flash=6 sfx(0)
   elseif m.k==1 and not heavy then
    -- splitter: a tap breaks it into two fast normals
    boom(m.x,m.y)
    del(met,m)
    killed+=1 addscore(10)
    sfx(1)
    spawn_met(0,m.x-4,1.4) spawn_met(0,m.x+4,1.4)
   else
    boom(m.x,m.y)
    del(met,m)
    killed+=1
    -- charged kills and tough types reward more
    addscore((heavy and 30 or 10)+(m.k>0 and 20 or 0))
    sfx(1)
   end
  end
 end
 -- test the boss (only a charged blast damages it)
 if boss then
  local bhit=false
  for i=0,140,4 do
   local ddx=boss.x-(tx+dx*i)
   local ddy=boss.y-(ty+dy*i)
   if ddx*ddx+ddy*ddy < (r+12)*(r+12) then bhit=true break end
  end
  if bhit then
   if c>=18 then
    boss.hp-=1 boss.flash=6 shake=6 boom(boss.x,boss.y) sfx(1)
    addscore(40)
    if boss.hp<=0 then boom(boss.x,boss.y) boss=nil st="win" music(-1) end
   else
    boss.flash=3 sfx(0)  -- taps just spark off the hull
   end
  end
 end
end

function boom(x,y)
 for i=1,8 do
  add(parts,{x=x,y=y,vx=rnd(2)-1,vy=rnd(2)-1.5,life=12+rnd(8)})
 end
 -- an expanding flash ring for punch (ring=age; drawn as a circle)
 add(parts,{x=x,y=y,vx=0,vy=0,life=7,ring=0})
end

function _draw()
 local sx=0 sy=0
 if shake>0 then sx=rnd(shake)-shake/2 sy=rnd(shake)-shake/2 end
 camera(sx,sy)
 cls(1)

 -- stars
 for i=0,20 do
  pset((i*23)%128,(i*41)%110,i%3==0 and 6 or 5)
 end

 -- city / ground
 rectfill(0,118,127,127,0)
 for i=0,15 do
  local h=3+((i*7)%6)
  rectfill(i*8,118-h,i*8+6,118,i%2==0 and 3 or 11)
 end

 -- aim line (telegraph the sweep; brightens as you charge)
 local ready=charge>=18
 local dx=cos(ang) local dy=sin(ang)
 local lcol=ready and 11 or (charge>0 and 10 or 5)
 for i=6,150,6 do
  local ax=tx+dx*i local ay=ty+dy*i
  if ay>0 then pset(ax,ay,lcol) end
 end
 -- reticle at end of aim (turns green+ring when a blast is charged enough)
 local rcol=ready and 11 or (charge>0 and 10 or 6)
 local rx=tx+dx*120 local ry=ty+dy*120
 circ(rx,ry,3,rcol)
 if ready then circ(rx,ry,5,7) end

 -- turret (glows green when blast-ready)
 circfill(tx,ty,4+charge*0.06,ready and 11 or (charge>0 and 10 or 8))
 circfill(tx,ty,2,7)

 -- meteors (colour = type; armored=blue, splitter=pink, normal=orange)
 for m in all(met) do
  if m.k==2 then
   -- armored: blue shell, needs a charged blast
   circfill(m.x,m.y,4,m.flash and 7 or 12)
   circ(m.x,m.y,4,7)
   circfill(m.x,m.y,1.5,1)
  elseif m.k==1 then
   -- splitter: bigger pink, taps split it
   circfill(m.x,m.y,4,14)
   circfill(m.x,m.y,2,15)
   pset(m.x-2,m.y,2) pset(m.x+2,m.y,2)
  else
   circfill(m.x,m.y,3,9)
   circfill(m.x,m.y,1.5,10)
  end
  -- trail
  pset(m.x-m.vx*2,m.y-m.vy*2,8)
 end

 -- boss (mothership)
 if boss then
  local bx=boss.x local by=boss.y
  local col=boss.flash>0 and 7 or 2
  ovalfill(bx-12,by-5,bx+12,by+5,col)
  ovalfill(bx-6,by-7,bx+6,by-1,13)
  for i=-2,2 do circfill(bx+i*5,by+4,1,boss.flash>0 and 7 or 8) end
  -- hp bar
  rectfill(bx-12,by-11,bx+12,by-9,5)
  rectfill(bx-12,by-11,bx-12+24*boss.hp/boss.mhp,by-9,11)
 end

 -- shots (beam flash)
 for s in all(shots) do
  line(s.x,s.y,s.x+s.dx*150,s.y+s.dy*150,10)
  circ(s.x+s.dx*60,s.y+s.dy*60,s.r,7)
 end

 -- particles (ring = expanding flash; dots = sparks)
 for p in all(parts) do
  if p.ring then
   circ(p.x,p.y,p.ring,p.life>4 and 7 or 10)
  else
   pset(p.x,p.y,p.life>6 and 10 or 8)
  end
 end

 camera()

 -- HUD
 rectfill(0,0,127,7,0)
 print("w"..wave.."/5",2,1,7)
 if boss then print("boss!",26,1,8) else print(killed.."/"..towin,26,1,10) end
 print(score,58,1,12)
 -- combo multiplier tell
 local mult=1+combo\4
 if mult>1 then print("x"..mult,44,1,10) end
 -- lives
 for i=1,lives do circfill(90+i*6,3,2,11) end

 if charge>0 then
  rect(1,121,47,125,6)
  rectfill(2,122,2+charge,124,charge>=18 and 11 or 10)
  -- "blast ready" threshold marker
  line(20,120,20,126,charge>=18 and 7 or 5)
  if charge>=18 then print("blast!",50,120,11) end
 end

 if msgt>0 then
  print(msg,64-#msg*2,60,10)
 end

 if st=="title" then
  rectfill(10,40,117,90,0)
  rect(10,40,117,90,7)
  print("ONE SHOT",44,48,10)
  print("tap = fire",30,60,7)
  print("hold = big blast",30,68,7)
  print("defend the city!",30,76,6)
  print("press z/x",44,84,11)
 elseif st=="win" then
  rectfill(10,42,117,86,0) rect(10,42,117,86,11)
  print("city saved!",40,50,11)
  print("score "..score,64-(#("score "..score))*2,60,10)
  print("z/x = menu",38,76,6)
 elseif st=="lose" then
  rectfill(10,42,117,86,0) rect(10,42,117,86,8)
  print("city fell",44,50,8)
  print("score "..score,64-(#("score "..score))*2,60,7)
  print("z/x = menu",38,76,6)
 end
end
