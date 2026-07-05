# Puzzle / grid reference (discrete cells, tile-step movement, rules)

Structure for a grid puzzle (block-pushing, rule-based, or match games). The
world is a 2D array of CELLS, the player moves ONE cell per input (not by
velocity), and a
turn is: read intent, test the move against rules, commit if legal. There is no
gravity and no sub-pixel motion here; do NOT reach for the platformer shape.

## The load-bearing rules

1. State is a GRID, not a pixel position. Store `col,row` (integers), render by
   multiplying by 8 (`x=col*8`). Movement changes `col,row` by exactly +/-1.
2. Input is DISCRETE: use `btnp` (fires once per press), never `btn` (fires every
   frame = the player rockets across the board).
3. A move is a TRANSACTION: compute the target cell, check every rule (in bounds?
   wall? pushable block that itself can move?), and only then mutate the grid.
   Never move first and undo, it corrupts multi-object pushes.
4. Grids are 1-based in Lua. Guard bounds explicitly (`c>=1 and c<=cols`).

## Grid setup (rows as split strings = cheap + readable levels)

```lua
cols,rows=16,16
-- a level as one string per row: .=floor #=wall @=player $=box
level=split("################, #@.....#......#, #..$..........#, ...(more rows)...", ",")

grid={}          -- grid[r][c] = tile char
player={c=2,r=2}

function load_level()
 grid={}
 for r=1,rows do
  grid[r]={}
  local row=level[r]
  for c=1,cols do
   local ch=sub(row,c,c)
   grid[r][c]=ch
   if ch=="@" then player.c,player.r=c,r grid[r][c]="." end
  end
 end
end
```

## Discrete move as a transaction (with box-push)

```lua
-- dir -> delta. split pairs are the idiomatic lookup.
dc=split"0,0,-1,1"   -- up,down,left,right dx (matches btnp 2,3,0,1 order below)
dr=split"-1,1,0,0"

function cell(c,r) -- safe read; out of bounds reads as wall
 if c<1 or c>cols or r<1 or r>rows then return "#" end
 return grid[r][c]
end

function try_move(dx,dy)
 local nc,nr=player.c+dx,player.r+dy
 local t=cell(nc,nr)
 if t=="#" then return end          -- wall: no move
 if t=="$" then                     -- box: can it be pushed one further?
  local bc,br=nc+dx,nr+dy
  if cell(bc,br)~="." then return end  -- blocked behind: whole move illegal
  grid[br][bc]="$" grid[nr][nc]="."    -- commit the push
 end
 player.c,player.r=nc,nr            -- commit the player move
end

function _update()
 -- btnp order: 0 left,1 right,2 up,3 down
 if btnp(0) then try_move(-1,0) end
 if btnp(1) then try_move(1,0) end
 if btnp(2) then try_move(0,-1) end
 if btnp(3) then try_move(0,1) end
end
```

## Render (grid -> screen, cell*8)

```lua
function _draw()
 cls(1)
 for r=1,rows do for c=1,cols do
  local t=grid[r][c]
  if t=="#" then rectfill((c-1)*8,(r-1)*8,(c-1)*8+7,(r-1)*8+7,5)
  elseif t=="$" then spr(2,(c-1)*8,(r-1)*8) end
 end end
 spr(1,(player.c-1)*8,(player.r-1)*8)   -- player
end
```

## Win / rule evaluation

Evaluate win AFTER a committed move, by scanning the grid (e.g. every box on a
target). For a game where the RULES are themselves objects on the grid, the rule
set is DATA you re-parse each turn (scan the grid for rule triples, rebuild a
properties table), then movement/legality queries that table. Keep the rule pass
separate from the move pass; do not interleave them.

## Genre pitfalls checklist

- [ ] Position is integer `col,row`, rendered as `*8`, not a pixel velocity.
- [ ] Input uses `btnp`, not `btn`.
- [ ] Moves are validated fully BEFORE any grid mutation (transaction).
- [ ] Multi-object pushes check the space behind the pushed object.
- [ ] Bounds guarded (1-based); out-of-bounds reads treated as wall.
- [ ] Win/rule evaluation is a separate pass after the move commits.
