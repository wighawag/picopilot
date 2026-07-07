-- BEACON HOP -- one button charge-jump platformer
-- hold O/Z to charge an arc, release to launch. reach the flag.

-- level data. platform "x,y,w,type,rng": type 0=static 1=moves-horiz(rng=amp) 2=bounce-pad
-- spikes "x,y,w" ; start "x,y" ; goal "x,y" ; gem "x,y" (optional bonus)
-- coords in pixels. platforms are 4px tall bars.
levels={
 -- l1: flat intro, one gap, no hazards
 {p="8,110,34|72,110,24|108,110,16",s="14,110",g="114,110",h={}},
 -- l2: a spike pit under the gaps
 {p="8,112,28|60,112,22|104,112,18",s="14,112",g="110,112",h="40,120,58"},
 -- l3: ascending steps + spike bed
 {p="6,116,22|48,100,18|92,116,26",s="12,116",g="104,116",h="30,124,90"},
 -- l4: short ledges, long double pit
 {p="6,110,18|48,110,12|84,110,12|110,110,14",s="12,110",g="114,110",h="26,120,46|64,120,82"},
 -- l5: MOVING platform introduced GENTLY -- same height as start, small sweep
 {p="6,116,20|54,116,18,1,12|104,116,18",s="12,116",g="110,116",h="30,124,98"},
 -- l6: two movers, time both
 {p="6,118,16|44,110,14,1,18|84,98,14,1,18|108,116,16",s="10,118",g="114,116",h="24,126,102"},
 -- l7: BOUNCE PAD introduced GENTLY -- wide pad, raised clear of the spikes
 {p="6,120,18|48,112,20,2,0|100,80,20",s="12,120",g="108,80",h="26,126,96"},
 -- l8: bounce over a tall spike wall to a high perch
 {p="6,120,16|48,120,16,2,0|92,78,16,2,0|110,52,14",s="12,120",g="114,52",h="24,126,104"},
 -- l9: static ledge first, then bounce pad, then a mover to the flag, gem bonus
 {p="6,118,20|48,110,16|84,118,14,2,0|108,74,16,1,12",s="12,118",g="108,74",h="24,126,102",gem="66,96"},
 -- l10: peak gauntlet -- static intro, bounce up, mover across to a high flag
 {p="6,118,22|52,118,16,2,0|92,80,16,1,14|112,58,14",s="12,118",g="116,58",h="28,126,108",gem="72,68"},
}

function _init()
 lvl=1
 gems=0
 deaths=0
 runt=0
 ngems=0
 -- count total gems across all levels
 for L in all(levels) do if L.gem then ngems+=1 end end
 loadlvl()
 st="title" -- title, play, win, dead, allwin
 msgt=0
 music(0)
end

function parselist(s)
 -- "a,b,c|d,e,f" -> {{a,b,c},{d,e,f}}
 local out={}
 if s=="" or s==nil then return out end
 if type(s)=="table" then return s end
 for row in all(split(s,"|")) do
  add(out,split(row))
 end
 return out
end

function loadlvl()
 local L=levels[lvl]
 plats=parselist(L.p)
 spikes=parselist(L.h)
 -- normalise platform records: bx=base x, ty=type, rng=amplitude
 for pl in all(plats) do
  pl.bx=pl[1]
  pl.ty=pl[4] or 0
  pl.rng=pl[5] or 0
 end
 local sc=split(L.s)
 px=sc[1] py=sc[2]-10 -- spawn just above, settle onto platform
 local gc=split(L.g)
 gx=gc[1] gy=gc[2]
 if L.gem then
  local gm=split(L.gem)
  gemx=gm[1] gemy=gm[2] hasgem=false gemexists=true
 else
  gemexists=false hasgem=false
 end
 vx=0 vy=0
 charging=false
 chg=0
 grounded=false
 gp=nil -- platform currently stood on
 face=1
 parts={}
 shake=0
 st="play"
end

function addparts(x,y,n,col)
 for i=1,n do
  add(parts,{x=x,y=y,vx=rnd(2)-1,vy=-rnd(2),l=10+rnd(8),c=col})
 end
end

function _update()
 msgt+=1
 if st=="title" then
  if btnp(4) or btnp(5) then lvl=1 deaths=0 gems=0 runt=0 loadlvl() end
  return
 end
 if st=="play" then
  updplay()
 else
  -- win/dead: press to continue
  if btnp(4) or btnp(5) then
   if st=="win" then
    lvl+=1
    if lvl>#levels then lvl=1 st="allwin" msgt=0 return end
    loadlvl()
   else
    loadlvl()
   end
  end
 end
 if st=="allwin" then
  if btnp(4) or btnp(5) then st="title" end
 end
end

function updplay()
 runt+=1
 local b=btn(4) or btn(5)
 -- charge while grounded and holding
 if grounded then
  if b then
   charging=true
   chg+=0.9
   if chg>18 then chg=18 end
  elseif charging then
   -- release: launch
   vx=face*(1.6+chg*0.14)
   vy=-(2.2+chg*0.26)
   charging=false
   chg=0
   grounded=false
   sfx(0)
  end
  -- allow aim flip with left/right while grounded
  if btnp(0) then face=-1 end
  if btnp(1) then face=1 end
 end

 -- move platforms (horizontal oscillation)
 for pl in all(plats) do
  if pl.ty==1 then
   pl[1]=pl.bx+sin(msgt/90)*pl.rng
  end
 end

 -- physics
 if not grounded then
  vy+=0.28
  if vy>4 then vy=4 end
  px+=vx
  py+=vy
 elseif gp and gp.ty==1 then
  -- ride a moving platform (movers already updated this frame)
  px+=gp[1]-gp.px0
  gp.px0=gp[1]
 end

 -- walls
 if px<2 then px=2 vx=-vx*0.4 end
 if px>122 then px=122 vx=-vx*0.4 end

 -- platform landing (only when falling)
 local wasair=not grounded
 grounded=false gp=nil
 for pl in all(plats) do
  local x,y,w=pl[1],pl[2],pl[3]
  if w>0 then
   if px+2>x and px-2<x+w and vy>=0 and py+3>=y and py+3<=y+8 then
    py=y-3
    if pl.ty==2 then
     -- bounce pad: auto-launch high, no charge needed
     vy=-6.2 grounded=false sfx(3)
     addparts(px,py+3,6,11)
     shake=3
    else
     if wasair then addparts(px,py+3,4,6) shake=1 end
     vy=0 vx=0 grounded=true gp=pl pl.px0=pl[1]
    end
   end
  end
 end

 -- spikes
 for sp in all(spikes) do
  local x,y,w=sp[1],sp[2],sp[3]
  if px+2>x and px-2<x+w and py+3>y-6 then
   st="dead" msgt=0 sfx(1) deaths+=1
  end
 end

 -- gem pickup (bonus)
 if gemexists and not hasgem and abs(px-gemx)<6 and abs(py-gemy)<6 then
  hasgem=true gems+=1 sfx(2) addparts(gemx,gemy,8,10)
 end

 -- fall off screen
 if py>136 then st="dead" msgt=0 sfx(1) shake=6 deaths+=1 end

 -- goal
 if abs(px-gx)<6 and abs(py-gy)<7 then
  st="win" msgt=0 sfx(2) addparts(gx,gy,10,11)
 end

 -- update particles
 for pa in all(parts) do
  pa.x+=pa.vx pa.y+=pa.vy pa.vy+=0.15 pa.l-=1
  if pa.l<=0 then del(parts,pa) end
 end
 if shake>0 then shake-=1 end
end

function _draw()
 cls(1)
 if st=="title" then drawtitle() return end
 if shake>0 then camera(rnd(shake*2)-shake,rnd(shake*2)-shake) end
 -- bg stars
 for i=0,20 do
  pset((i*37+lvl*11)%128,(i*53)%110,i%2==0 and 5 or 13)
 end

 -- platforms
 for pl in all(plats) do
  local x,y,w=pl[1],pl[2],pl[3]
  if w>0 then
   if pl.ty==2 then
    -- bounce pad: green, springy top
    rectfill(x,y,x+w,y+3,3)
    rectfill(x,y,x+w,y,11)
    line(x,y-1,x+w,y-1,11)
   elseif pl.ty==1 then
    -- mover: blue-ish, with a direction cue
    rectfill(x,y,x+w,y+3,13)
    rectfill(x,y,x+w,y,12)
    local dir=cos(msgt/90) -- +right
    if dir>0 then
     print("\146",x+w-5,y-2,7)
    else
     print("\147",x+1,y-2,7)
    end
   else
    rectfill(x,y,x+w,y+3,4)
    rectfill(x,y,x+w,y,15)
   end
  end
 end

 -- spikes
 for sp in all(spikes) do
  local x,y,w=sp[1],sp[2],sp[3]
  for sx=x,w-1,6 do
   line(sx,y,sx+3,y-6,8)
   line(sx+3,y-6,sx+6,y,8)
   line(sx,y,sx+6,y,2)
  end
 end

 -- goal flag
 local fb=gy+4
 line(gx,fb,gx,gy-6,6)
 local fw=3+sin(msgt/40)*1.5
 rectfill(gx,gy-6,gx+fw+3,gy-1,11)
 circ(gx,gy-3,1,10)

 -- gem (bonus collectible)
 if gemexists and not hasgem then
  local gy2=gemy+sin(msgt/50)*2
  circfill(gemx,gy2,2,14)
  pset(gemx,gy2,7)
  circ(gemx,gy2,3,2)
 end

 -- particles
 for pa in all(parts) do
  pset(pa.x,pa.y,pa.c)
 end

 -- player orb
 circfill(px,py,3,10)
 circfill(px,py,2,9)
 pset(px,py,7)
 if hasgem then circ(px,py,4,14) end

 -- charge aim arc (preview trajectory) + landing marker
 if charging and st=="play" then
  local tvx=face*(1.6+chg*0.14)
  local tvy=-(2.2+chg*0.26)
  local sx,sy=px,py
  local land=0 -- 0 none,1 safe,2 hazard
  local lx,ly=sx,sy
  for i=1,60 do
   sx+=tvx sy+=tvy tvy+=0.28
   if sx<2 then sx=2 tvx=-tvx*0.4 end
   if sx>122 then sx=122 tvx=-tvx*0.4 end
   if i%2==0 then pset(sx,sy,10) end
   -- check landing on a platform
   for pl in all(plats) do
    local x,y,w=pl[1],pl[2],pl[3]
    if w>0 and tvy>=0 and sx+2>x and sx-2<x+w and sy+3>=y and sy+3<=y+8 then
     lx=sx ly=y-3 land=1
    end
   end
   -- check spike hit
   for sp in all(spikes) do
    if sx+2>sp[1] and sx-2<sp[3] and sy+3>sp[2]-6 then lx=sx ly=sy land=2 end
   end
   if land>0 or sy>136 then lx=sx ly=sy break end
  end
  if sy>136 and land==0 then land=2 end
  -- draw the marker
  if land==1 then
   circ(lx,ly,4,11) circ(lx,ly,2,11)
  elseif land==2 then
   line(lx-3,ly-3,lx+3,ly+3,8) line(lx-3,ly+3,lx+3,ly-3,8)
  end
  -- charge bar
  rectfill(px-8,py-9,px+8,py-7,0)
  rectfill(px-8,py-9,px-8+(chg/18)*16,py-7,chg>14 and 8 or 11)
 end

 camera()
 -- HUD
 print("lvl "..lvl.."/"..#levels,3,3,7)
 print(gems.."/"..ngems.."\135",106,3,14)
 print("\151",44,3,12) print("hold=jump",52,3,6)
 if st=="win" then
  cbox("cleared! press O",6)
 elseif st=="dead" then
  cbox("splat! O to retry",8)
 elseif st=="allwin" then
  rectfill(14,40,114,92,0)
  rect(14,40,114,92,11)
  print("\135 all beacons lit! \135",22,45,10)
  -- star rating: 3 stars, lose one per few deaths, +feel for gems
  local rating=3
  if deaths>3 then rating=2 end
  if deaths>8 then rating=1 end
  if deaths>15 then rating=0 end
  local rs=""
  for i=1,3 do rs=rs..(i<=rating and "\135" or "\140") end
  print(rs,52,55,10)
  print("time: "..(runt\30).."s",20,67,7)
  print("deaths: "..deaths,66,67,7)
  print("gems: "..gems.."/"..ngems,20,75,gems==ngems and 11 or 14)
  print("O to restart",38,84,6)
 end
end

function drawtitle()
 -- animated starfield
 for i=0,30 do
  pset((i*37+msgt)%128,(i*53)%128,i%3==0 and 6 or 5)
 end
 -- a demo orb arcing across
 local t=(msgt%90)/90
 local ox=10+t*108
 local oy=90-sin(t/2)*46
 circfill(ox,oy,3,10) circfill(ox,oy,2,9)
 -- title
 print("beacon hop",39,34,7)
 print("beacon hop",39,33,10)
 rect(34,29,93,42,12)
 print("one button. hold to charge,",13,52,6)
 print("release to leap the arc.",19,60,6)
 if msgt%30<20 then
  print("press \151 to start",33,80,11)
 end
 print("10 levels \135 movers \135 bounce",16,110,13)
end

function cbox(t,col)
 local w=#t*4
 rectfill(64-w/2-2,58,64+w/2,68,0)
 print(t,64-w/2,60,col)
end
