-- main.lua, the plain-Lua source picopilot's main.p8 #includes.
-- Edit THIS file; never hand-write main.p8's binary sections.
--
-- The AUDIO example: every __sfx__ / __music__ byte in main.p8 was authored as
-- TEXT with `picopilot sfx from-mml` / `picopilot music from-patterns` (see
-- TUTORIAL.md). This Lua just lets you PLAY those sounds so you can hear them:
--   z / x / up / down : trigger the 4 one-shot SFX (coin / jump / hurt / boom)
--   the looping tune (sfx 4 bass + sfx 5 melody) starts on boot.

local labels = {
  "z: coin (sfx 0)",
  "x: jump (sfx 1)",
  "up: hurt (sfx 2)",
  "down: boom (sfx 3)",
  "music: bass+melody loop",
}
local last = "press a button to play a sound"

function _init()
  music(0) -- start the 2-pattern bass+melody loop (sfx 4 + sfx 5)
end

function _update()
  if btnp(4) then sfx(0) last = "coin (sfx 0)" end       -- z
  if btnp(5) then sfx(1) last = "jump (sfx 1)" end       -- x
  if btnp(2) then sfx(2) last = "hurt (sfx 2)" end       -- up
  if btnp(3) then sfx(3) last = "boom (sfx 3)" end       -- down
end

function _draw()
  cls(1)
  print("picopilot audio demo", 28, 8, 7)
  for i, l in ipairs(labels) do
    print(l, 12, 24 + i * 8, 6)
  end
  print(last, 12, 96, 10)
end
