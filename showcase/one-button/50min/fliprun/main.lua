-- FLIPRUN -- one-button gravity flip runner
-- one button (x or z): flip gravity floor<->ceiling.
-- avoid spikes. reach the goal to win.

function _init()
 state="title"
 best=0
 reset_game()
 state="title"
end

function reset_game()
 state="play" -- title, play, win, dead
 px=24        -- player fixed screen x
 py=100
 vy=0
 grav=1       -- 1=down (floor), -1=up (ceiling)
 dist=0       -- distance travelled
 goal=1400   -- win distance
 scroll=0
 spd=1.6
 flash=0
 shake=0
 land=0
 lside=0
 score=0
 combo=0
 pop=0     -- popup timer
 poptxt=""
 -- spikes: each = {d=world dist of spike, side=0 floor / 1 ceil}
 spikes={}
 -- orbs: {d, side, got=false} bonus points, sit on a surface
 orbs={}
 build_track()
 tk=0
end

-- floor/ceiling geometry
flr_y=112     -- top of floor band
ceil_y=8      -- bottom of ceiling band
ph=8          -- player half-ish size

function build_track()
 -- deterministic-ish handmade pattern with widening gaps.
 -- guarantee reaction budget: min spacing between spikes.
 local d=140
 local side=0
 srand(7)
 while d<goal-120 do
  add(spikes,{d=d,side=side})
  -- sometimes a double on same side (still one flip solves)
  if(rnd()<0.35) add(spikes,{d=d+14,side=side})
  -- alternate mostly, occasionally repeat
  if(rnd()<0.7) side=1-side
  -- spacing shrinks as you go but never below reaction floor
  local gap=64-flr(d/40)
  if(gap<40) gap=40
  -- orb reward: place a pickup on the OPPOSITE surface to the spike,
  -- in the gap, so grabbing it means riding the risky line a beat longer.
  if rnd()<0.75 then
   add(orbs,{d=d+gap\2, side=1-side, got=false})
  end
  d+=gap+flr(rnd(20))
  -- mid-run: occasional alternating BURST (rhythmic flip challenge).
  -- each spike is single-surface + spaced 52 so the rhythm stays clearable.
  if d>700 and rnd()<0.22 then
   for j=1,3 do
    side=1-side
    add(spikes,{d=d,side=side})
    d+=52
   end
  end
 end
end

function _update()
 tk+=1
 if flash>0 then flash-=1 end
 if shake>0 then shake-=1 end
 if pop>0 then pop-=1 end
 if state=="play" then
  update_play()
 elseif state=="title" then
  if btnp(4) or btnp(5) then
   reset_game() music(0)
  end
 else
  -- press to restart
  if btnp(4) or btnp(5) then
   reset_game() music(0)
  end
 end
end

function update_play()
 -- one button flips gravity
 if btnp(4) or btnp(5) then
  grav=-grav
  vy=0
  sfx(0)
 end
 vy+=grav*0.55
 if(vy>4) vy=4
 if(vy<-4) vy=-4
 py+=vy
 -- clamp to floor / ceiling, land (with impact fx on a real landing)
 if py>flr_y-ph then
  if(vy>2) land=6 lside=0
  py=flr_y-ph vy=0
 end
 if py<ceil_y+ph then
  if(vy<-2) land=6 lside=1
  py=ceil_y+ph vy=0
 end
 if land>0 then land-=1 end
 -- advance
 dist+=spd
 scroll+=spd
 -- gentle speedup
 if(spd<2.4) spd+=0.0006
 -- orb pickups
 for o in all(orbs) do
  if not o.got then
   local ox=px+(o.d-dist)
   -- combo breaks ONCE if an orb scrolls fully past ungrabbed
   -- (mark it done so it stops resetting the combo every frame)
   if ox<px-8 then
    o.got=true combo=0
   elseif ox>px-6 and ox<px+6 then
    local osy=o.side==0 and flr_y-4 or ceil_y+4
    if abs(py-osy)<8 then
     o.got=true
     combo+=1
     local gain=10*combo
     score+=gain
     pop=24 poptxt="+"..gain
     if(combo>1) poptxt=poptxt.." x"..combo
     sfx(3)
    end
   end
  end
 end
 -- win
 if dist>=goal then
  score+=100
  if(score>best) best=score
  state="win" music(-1) sfx(2) return
 end
 check_hit()
end

function check_hit()
 -- a spike sits at world dist d; its screen x = px + (d-dist)
 for s in all(spikes) do
  local sx=px+(s.d-dist)
  if sx>px-6 and sx<px+6 then
   -- on floor: dangerous if player is on floor. on ceil: if on ceiling.
   local on_floor=py>=flr_y-ph-2
   local on_ceil=py<=ceil_y+ph+2
   if (s.side==0 and on_floor) or (s.side==1 and on_ceil) then
    if(score>best) best=score
    state="dead" flash=6 shake=8 music(-1) sfx(1)
    return
   end
  end
 end
end

function _draw()
 camera()
 cls(1)
 if state=="title" then
  draw_title() return
 end
 -- screen shake
 if(shake>0) camera(rnd(4)-2,rnd(4)-2)
 -- parallax stars
 for i=0,24 do
  local sx=(i*23 - scroll*0.3)%128
  pset(sx, (i*17)%96+12, 5)
 end
 -- floor & ceiling bands
 rectfill(0,flr_y,127,127,3)
 rectfill(0,flr_y,127,flr_y,11)
 rectfill(0,0,127,ceil_y,3)
 rectfill(0,ceil_y,127,ceil_y,11)
 draw_orbs()
 draw_spikes()
 draw_player()
 -- floating score popup
 if pop>0 then
  print(poptxt,px-6,py-14-(24-pop)\3,10)
 end
 camera()
 draw_hud()
 if state=="dead" or state=="win" then
  -- dark panel so the end-screen text reads over the playfield
  rectfill(20,44,107,76,0)
  rect(20,44,107,76,5)
  if state=="dead" then
   center("splat!",50,8)
   center("score "..score,58,10)
   center("press \151 to retry",68,7)
  else
   center("you made it!",48,11)
   center("score "..score,58,10)
   center("press \151 for more",68,7)
  end
 end
end

function draw_title()
 -- animated demo backdrop
 rectfill(0,flr_y,127,127,3)
 rectfill(0,0,127,ceil_y,3)
 local yy=54+sin(tk/64)*3
 print("fliprun",44,yy,12)
 print("fliprun",45,yy,14)
 center("one button. flip gravity.",74,6)
 center("dodge spikes, grab orbs.",82,6)
 if(tk%40<26) center("press \151 to start",100,7)
 if(best>0) center("best "..best,116,10)
end

function draw_orbs()
 for o in all(orbs) do
  if not o.got then
   local ox=px+(o.d-dist)
   if ox>-4 and ox<132 then
    local oy=o.side==0 and flr_y-4 or ceil_y+4
    circfill(ox,oy,2,10)
    pset(ox,oy,7)
   end
  end
 end
end

function draw_spikes()
 -- which surface is the player on right now
 local on_floor=py>=flr_y-ph-2
 local on_ceil=py<=ceil_y+ph+2
 for s in all(spikes) do
  local sx=px+(s.d-dist)
  if sx>-8 and sx<136 then
   -- imminent = this spike is bearing down AND on the player's surface
   local threat=(s.side==0 and on_floor) or (s.side==1 and on_ceil)
   local alert=threat and sx>px-2 and sx<px+40
   spike(sx, s.side, alert)
  end
 end
end

-- draw a clear filled spike triangle (base width 10, height 10)
function spike(sx,side,alert)
 local base=side==0 and flr_y or ceil_y
 local dir=side==0 and -1 or 1  -- points into playfield
 local body=8
 -- imminent threat on your surface: pulse the spike so you know to flip NOW
 if alert and tk%6<3 then body=10 end
 -- scanline from base toward apex, narrowing
 for k=0,9 do
  local w=5-flr(k*0.5)
  local y=base+dir*k
  rectfill(sx-w,y,sx+w,y,body)
 end
 -- bright tip highlight for readability
 pset(sx, base+dir*9, 10)
 pset(sx, base+dir*8, 10)
end

function draw_player()
 local c=grav==1 and 12 or 14
 if(flash>0) c=8
 -- landing dust puff on the surface just hit
 if land>0 then
  local ly=lside==0 and flr_y-1 or ceil_y+1
  local r=8-land
  line(px-r,ly,px-2,ly,7)
  line(px+2,ly,px+r,ly,7)
 end
 -- squash when freshly landed
 local sq=land>3 and 1 or 0
 -- body
 circfill(px,py,4,c)
 rectfill(px-3,py-4+sq,px+3,py+4,c)
 -- eye direction shows gravity
 local ey=grav==1 and py+1 or py-1
 pset(px+1,ey,7)
 pset(px-2,ey,7)
 -- little arrow trail
 pset(px-6,py,6) pset(px-8,py,5)
end

function draw_hud()
 -- progress bar
 rect(8,3,120,6,0)
 local w=(dist/goal)*112
 rectfill(8,3,8+w,6,11)
 print("\151/\142 flip",6,120,6)
 if(combo>1) print("x"..combo,58,120,9)
 print("score "..score,84,120,10)
end

function center(s,y,c)
 print(s, 64-#s*2, y, c)
end
