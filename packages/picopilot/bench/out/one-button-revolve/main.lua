-- REVOLVE - one-button orbit game
-- button (z/o) = reverse orbit direction

cx=64 cy=64 rad=40
function _init()
 st=0 -- 0 title, 1 play, 2 win, 3 lose
 reset()
end

function reset()
 ang=0
 dir=1
 spd=0.006
 score=0
 goal=10
 items={} -- {a=angle, kind=0 pickup /1 hazard}
 spawnt=20 -- brief grace: see yourself orbit before anything spawns
 intro=2  -- first 2 spawns are guaranteed-safe pickups (gentle first contact)
 shake=0
 flash=0
 lives=3
 combo=0
 best=0
 lifeup=0
 parts={}
 if not stars then
  stars={}
  for i=1,24 do add(stars,{x=rnd(128),y=rnd(128),s=1+flr(rnd(2))}) end
 end
 music(0)
end

function burst(x,y,c,n)
 for i=1,n do
  local a=rnd(1)
  add(parts,{x=x,y=y,dx=cos(a)*rnd(2),dy=sin(a)*rnd(2),c=c,l=8+rnd(8)})
 end
end

-- angular distance 0..0.5
function adist(a,b)
 local d=abs((a-b)%1)
 return min(d,1-d)
end

function newitem()
 -- spawn ahead of player, scaled by speed so time-to-contact stays
 -- roughly constant (>=28 frames) as the orbit speeds up: keeps the
 -- reaction window human-sized, not frame-perfect, at high scores.
 local lead=max(0.18,spd*28)
 local a=(ang+dir*(lead+rnd(0.32)))%1
 -- keep clear spacing from existing items
 for it in all(items) do
  if(adist(a,it.a)<0.1) return
 end
 local k=0
 -- gentle first contact: first couple of spawns are safe pickups
 if intro>0 then
  intro-=1
  add(items,{a=a,k=0,pop=0,life=200,warn=14})
  return
 end
 -- k: 0 pickup, 1 hazard, 2 bonus(+2, rare, short-lived)
 if rnd()<0.15 then
  k=2
  add(items,{a=a,k=k,pop=0,life=70,warn=14})
  return
 -- hazard density ramps with score: gentle at first (learn the
 -- reverse), denser later, capped so pickups never get crowded out.
 elseif rnd()<min(0.5,0.3+score*0.025) then
  k=1
  -- fairness: no hazard may sit within a reverse-escape arc of
  -- another hazard, so a reverse is always a safe out
  for it in all(items) do
   if(it.k==1 and adist(a,it.a)<0.28) return
  end
  -- and never spawn a hazard on the arc directly behind the
  -- player (the reverse-escape lane) close by
  if(adist(a,(ang-dir*0.2)%1)<0.12) return
 end
 add(items,{a=a,k=k,pop=0,life=200,warn=14})
end

function icol(k)
 if(k==0) return 11
 if(k==1) return 8
 return 10
end

function _update()
 if st==0 then
  if btnp(4) or btnp(5) then
   reset() st=1
  end
  return
 end
 if st>=2 then
  if(btnp(4) or btnp(5)) st=0
  return
 end

 -- play
 if btnp(4) or btnp(5) then
  dir=-dir
  flash=4
  sfx(0)
 end
 ang=(ang+dir*spd)%1

 spawnt-=1
 if spawnt<=0 then
  newitem()
  spawnt=25+flr(rnd(20))
 end

 -- collision: player at ang, item at a
 local px=cx+cos(ang)*rad
 local py=cy+sin(ang)*rad
 for it in all(items) do
  if it.pop<=0 and it.warn<=0 then
   local ix=cx+cos(it.a)*rad
   local iy=cy+sin(it.a)*rad
   local d=(px-ix)*(px-ix)+(py-iy)*(py-iy)
   if d<36 then
    if it.k!=1 then
     score+=it.k==2 and 2 or 1
     combo+=1
     if(combo>best) best=combo
     sfx(it.k==2 and 3 or 1)
     it.pop=8
     burst(ix,iy,it.k==2 and 10 or 11,it.k==2 and 10 or 6)
     -- reward clean play: every 6-streak restores a life (cap 3).
     -- lives-up is never punishing, so this cannot create a dead state.
     if combo%6==0 and lives<3 then
      lives+=1
      lifeup=30
      sfx(3)
      burst(px,py,11,12)
     end
     if score>=goal then st=2 music(-1) sfx(3) end
    else
     lives-=1
     combo=0
     shake=8
     sfx(2)
     it.pop=8
     burst(ix,iy,8,10)
     if lives<=0 then st=3 music(-1) end
    end
   end
  end
 end
 -- age items: pop animation + lifetime expiry
 for it in all(items) do
  if it.warn>0 then it.warn-=1 end
  if it.pop>0 then
   it.pop-=1
   if(it.pop<=0) del(items,it)
  else
   it.life-=1
   if(it.life<=0) del(items,it)
  end
 end
 -- particles
 for p in all(parts) do
  p.x+=p.dx p.y+=p.dy p.dx*=0.9 p.dy*=0.9 p.l-=1
  if(p.l<=0) del(parts,p)
 end
 -- speed ramp
 spd=0.006+score*0.0004
 if(flash>0) flash-=1
 if(shake>0) shake-=1
 if(lifeup>0) lifeup-=1
end

function _draw()
 cls(1)
 local sx=0 local sy=0
 if shake>0 then
  sx=rnd(3)-1.5 sy=rnd(3)-1.5
 end
 camera(sx,sy)

 -- starfield backdrop
 for s in all(stars) do
  pset(s.x,s.y,s.s==1 and 1 or 13)
 end

 if st==0 then
  camera()
  circ(cx,cy-4,26,5)
  local pa=t()*0.15%1
  circfill(cx+cos(pa)*26,cy-4+sin(pa)*26,3,12)
  print("revolve",44,30,7)
  print("one button. one orbit.",22,84,6)
  print("z = reverse spin",30,94,5)
  print("grab green, dodge red",24,102,5)
  print("gold=bonus  6-streak=+life",8,110,9)
  print("press z to start",32,118,7+(t()*2%2))
  return
 end

 -- orbit ring
 circ(cx,cy,rad,5)
 circfill(cx,cy,6,2)

 -- items
 for it in all(items) do
  local ix=cx+cos(it.a)*rad
  local iy=cy+sin(it.a)*rad
  local col=icol(it.k)
  if it.pop>0 then
   circfill(ix,iy,it.pop,col)
  elseif it.warn>0 then
   -- telegraph: blinking ring before it goes live
   if(it.warn%4<2) circ(ix,iy,4,col)
   circ(ix,iy,2,col)
  else
   circfill(ix,iy,3,col)
   circ(ix,iy,3,7)
   if(it.k==1) circ(ix,iy,5,8+(t()*4%2))
   -- bonus: pulsing halo + fading life ring
   if it.k==2 then
    circ(ix,iy,5+(t()*6%2),10)
    if(it.life<30 and it.life%6<3) circ(ix,iy,3,7)
   end
  end
 end

 -- particles
 for p in all(parts) do
  pset(p.x,p.y,p.c)
 end

 -- player + motion trail (reads direction of travel at a glance)
 local px=cx+cos(ang)*rad
 local py=cy+sin(ang)*rad
 for i=4,1,-1 do
  local ta=ang-dir*0.018*i
  local r=3-i*0.6
  circfill(cx+cos(ta)*rad,cy+sin(ta)*rad,r,i<3 and 12 or 1)
 end
 local pc=flash>0 and 7 or 12
 circfill(px,py,3,pc)
 circ(px,py,4,7)
 -- leading nose dot: points where you are heading
 local na=ang+dir*0.03
 circfill(cx+cos(na)*rad,cy+sin(na)*rad,1,7)

 camera()
 -- hud
 print("score",4,4,6)
 print(score.."/"..goal,4,11,7)
 for i=1,lives do
  circfill(118-i*8,6,3,8)
 end
 if lifeup>0 and lifeup%6<3 then
  print("+1",118-lives*8-9,3,11)
 end
 if combo>=2 then
  print("x"..combo,4,20,10)
 end

 if st==2 then
  rectfill(18,48,110,80,0)
  rect(18,48,110,80,11)
  print("you win!",44,54,11)
  print("best combo x"..best,30,64,10)
  print("press z",46,72,6)
 elseif st==3 then
  rectfill(18,48,110,80,0)
  rect(18,48,110,80,8)
  print("crashed!",42,54,8)
  print("score "..score.."/"..goal,38,64,6)
  print("press z",46,72,6)
 end
end
