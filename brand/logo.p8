pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
-- picopilot logo, rendered 1:1 from the website's logo.svg (128x128, 16px
-- grid). Each rectfill(x,y,x2,y2,col) == an SVG <rect x y width height fill>,
-- and every palette index is the exact one the SVG names, so this is proof the
-- mark is genuinely drawable in PICO-8. Load and Run it to see the logo; it
-- draws the mark and holds. See brand/README.md.

function _draw()
 cls(0) -- black background so the console body shows

 -- console body (dark-blue 1) + screen (black 0)
 rectfill(4,4,123,123,1)
 rectfill(8,8,119,119,0)

 -- outer scalloped petals (pink 14)
 rectfill(56,24,71,39,14)
 rectfill(32,32,47,47,14)
 rectfill(80,32,95,47,14)
 rectfill(32,64,47,79,14)
 rectfill(80,64,95,79,14)
 rectfill(56,72,71,87,14)

 -- bloom mass (pink 14)
 rectfill(48,40,79,71,14)
 rectfill(40,40,55,55,14)
 rectfill(72,40,87,55,14)
 rectfill(40,56,55,71,14)
 rectfill(72,56,87,71,14)

 -- inner glow (peach 15), core (red 8), eye (yellow 10)
 rectfill(52,44,75,67,15)
 rectfill(54,46,73,65,8)
 rectfill(58,50,69,61,10)

 -- stem (green 11) + two leaves (dark-green 3)
 rectfill(56,88,71,111,11)
 rectfill(40,94,55,103,3)
 rectfill(72,102,87,111,3)
end
