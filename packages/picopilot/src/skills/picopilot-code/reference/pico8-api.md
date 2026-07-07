# PICO-8 API reference (exact names and signatures)

The PICO-8 function surface with EXACT names and argument order. Read this instead of guessing: the #1 way an agent wastes a run is calling a function that does not exist (`rand`, `ranf`, `rectcol`) or passing the wrong arguments, then burning a playtest round on an `attempt to call nil value` crash. If you are unsure a function exists or what its arguments are, look it up HERE first. `[x]` marks an optional argument.

## Do NOT guess: names that do NOT exist in PICO-8

These are the wrong names an LLM reaches for out of habit (mainstream Lua, JS, other engines). Each one crashes or silently misbehaves. Use the RIGHT column.

| You may type (WRONG) | PICO-8 reality |
|----------------------|----------------|
| `rand()`, `ranf()`, `random()`, `math.random` | `rnd(x)` returns a float in `[0,x)`; `rnd()` is `[0,1)`. Integer: `flr(rnd(n))`. `rnd(tbl)` picks a random element. |
| `rand(lo,hi)` (a range) | there is NO range form. Do `lo+rnd(hi-lo)` (float) or `lo+flr(rnd(hi-lo))` (int). |
| `rectcol`, `collide`, `intersect`, `overlap` | NO built-in collision. Write your own AABB (see below). |
| `math.floor`, `math.abs`, `math.min`, `math.max`, `math.sqrt` | bare `flr`, `abs`, `min`, `max`, `sqrt` (no `math.` table). |
| `table.insert`, `table.remove` | `add(t,v)`, `del(t,v)` (by value), `deli(t,i)` (by index). |
| `string.sub`, `s:sub(..)`, `#s` for chars | `sub(s,i,j)` (1-based, inclusive both ends). |
| `print(x,y,...)` with x,y swapped, or `printf` | `print(str,[x,y,[col]])` (string FIRST). |
| `pset(x,y,col)` ok, but `pget(x,y,col)` | `pget(x,y)` takes NO color (it READS one). |
| `2*pi`, `sin(radians)` | `sin`/`cos` take TURNS `0..1`, and `sin` is INVERTED. A full circle is `t:0->1`. Do NOT multiply by pi. |
| `poke4` for "save a number" | persistence is `cartdata(id)` then `dset(i,v)` / `dget(i)`. (`poke2/poke4` exist but are raw 16/32-bit RAM writes, not a save API.) |
| `//` (Lua 5.3 int-divide) | `\` is integer divide (`5\2`==2). `/` does NOT truncate. |
| shadowing builtins as locals: `local type`, `local add`, `local t=...` near `t=time()` | do not name locals after builtins/globals you use (`type`, `add`, `del`, `t`, `x`, `y`, `pal`, `time`, `sub`). It silently breaks calls to them. |

## AABB overlap (there is no built-in collision, write this)

```lua
function hit(ax,ay,aw,ah, bx,by,bw,bh)
 return ax<bx+bw and bx<ax+aw and ay<by+bh and by<ay+ah
end
```

## Graphics

- `cls([col])` clear screen (to `col`, default 0).
- `spr(n,x,y,[w,h],[flip_x],[flip_y])` draw sprite `n` at `x,y`. `w,h` are in SPRITES (default 1,1), NOT pixels. There is NO color/rotate/scale arg; that is `sspr`/`pal` territory. Do NOT pass extra args.
- `sspr(sx,sy,sw,sh,dx,dy,[dw,dh],[flip_x],[flip_y])` stretch a spritesheet rect.
- `map(cx,cy,sx,sy,cw,ch,[layer])` draw map cels `cx,cy` (size `cw,ch`) at screen `sx,sy`.
- `pset(x,y,[col])`, `pget(x,y)` (pget reads, no col arg).
- `sget(x,y)`, `sset(x,y,[col])` read/write a spritesheet pixel.
- `print(str,[x,y,[col]])` string is the FIRST arg. Returns the x cursor after.
- `rect(x0,y0,x1,y1,[col])`, `rectfill(x0,y0,x1,y1,[col])` (two CORNERS, not x,y,w,h).
- `circ(x,y,r,[col])`, `circfill(x,y,r,[col])`.
- `oval(x0,y0,x1,y1,[col])`, `ovalfill(...)` (bounding-box corners).
- `line(x0,y0,x1,y1,[col])`.
- `pal([c0,c1,[p]])` remap color `c0`->`c1` (p=0 draw, 1 screen). No-arg `pal()` RESETS.
- `palt([col,t])` set color `col` transparent (`t` true/false). No-arg resets (0 transparent).
- `camera([x,y])` offset all later draws. No-arg resets.
- `clip([x,y,w,h])` clip rect. No-arg resets.
- `color([col])` set the default pen color.
- `fillp([pat])` set the fill pattern for shape fns.
- `flip()` present the frame (rarely needed; `_draw` flips for you).
- `cursor([x,y,[col]])`, `fget`/`fset` (flags, under Map).

## Map and sprite flags

- `mget(x,y)` read the map cel (sprite index) at tile `x,y`.
- `mset(x,y,v)` write a map cel.
- `fget(n,[f])` get sprite `n` flags (all as a bitfield, or bit `f`).
- `fset(n,[f],v)` set sprite flags.

## Input

- `btn([i,[p]])` is button `i` HELD? (i=0..5 = left,right,up,down,O,X; p=player 0..7). No-arg returns a bitfield.
- `btnp([i,[p]])` was button `i` just PRESSED this frame (with auto-repeat)?
- Button ids: 0 left, 1 right, 2 up, 3 down, 4 O (z/c/n), 5 X (x/v/m).

## Audio

- `sfx(n,[channel,[offset,[length]]])` play sfx `n`. `n=-1` stops. `channel=-1` any, `-2` stop on the channel.
- `music([n,[fade_ms,[channel_mask]]])` play music pattern `n`. `n=-1` stops.

## Math (all bare, no `math.` table)

- `flr(x)` floor (round toward -inf). `ceil(x)` = `-flr(-x)`.
- `abs`, `min(a,b)`, `max(a,b)`, `mid(a,b,c)` (the middle value = idiomatic CLAMP), `sgn(x)`.
- `sqrt(x)`, `rnd([x])` (float `[0,x)`; `rnd(tbl)` picks an element), `srand(x)` (seed).
- `sin(t)`, `cos(t)` take TURNS `0..1`; `sin` is INVERTED (screen +y down). `atan2(dx,dy)` returns a turn `0..1`.
- `%` modulo, `\` integer divide, `&` `|` `^^` `~` `<<` `>>` bitops (Lua-5.3-style ops are NOT all present; use these).

## Tables and iteration (1-BASED)

- `add(t,v,[i])` append (or insert at `i`), returns `v`.
- `del(t,v)` remove the first element EQUAL to `v` (by value).
- `deli(t,[i])` remove the element at INDEX `i` (default last), returns it.
- `count(t,[v])` length (or count of `v`). `#t` also works for a contiguous array.
- `all(t)` iterator for `for x in all(t) do`. `foreach(t,fn)` call `fn(v)` per element.
- `pairs(t)`, `ipairs(t)`, `next(t)`. `unpack(t)`, `pack(...)`.
- Deleting the CURRENT item is safe in `foreach` and in a DESCENDING `for i=#t,1,-1`; an ASCENDING `for i=1,#t` ERRORS once the list shrinks.

## Strings

- `sub(s,i,[j])` substring, 1-based, INCLUSIVE both ends (`sub("abc",2,3)`=="bc").
- `#s` length, `..` concat, `tostr(x,[hex])`, `tonum(s)`, `chr(n)`, `ord(s,[i])`.
- `split(s,[sep,[convert]])` -> a 1-based array (great for cheap data tables). NO Lua `string` stdlib (`string.format`, `gsub`, etc. do NOT exist).

## Memory (raw RAM; wrong addresses corrupt gfx/sound/state)

- `peek(addr)`, `poke(addr,v)` one byte. `peek2/poke2` 16-bit, `peek4/poke4` 32-bit (fixed-point).
- `memcpy(dst,src,len)`, `memset(dst,val,len)`, `reload(...)`, `cstore(...)`.
- Only poke DOCUMENTED addresses (see the memory map in `AGENTS.md`). Prefer the draw functions above over poking the screen.

## Cart data (persistent save)

- `cartdata(id)` register a 64-slot save block (call ONCE in `_init`; `id` is a unique string).
- `dget(i)` read slot `i` (0..63), `dset(i,v)` write it. This is how you save a high score, NOT `poke4`.

## System / debug

- `time()` / `t()` seconds since start (a fixed-point float). Do NOT name a local `time`.
- `stat(n)` system info (`stat(6)` is the `-p`/playtest input string; others: memory, fps, etc.).
- `printh(str,[filename])` print to the HOST stdout (picopilot `run`/`playtest` capture this) -> your main debug channel.
- `menuitem(...)`, `extcmd(cmd)` (`extcmd("screen")` screenshots, used by the run probe), `stop()`, `assert(cond,[msg])`, `trace()`.

## The execution loop

- `_init()` once at start. `_update()` at 30fps (or `_update60()` at 60fps, not both). `_draw()` once per visible frame. Mutate state ONLY in `_update`; `_draw` can be skipped under load.

For the behaviours that differ from mainstream Lua/math (turns-not-radians, integer divide, 1-based tables, persistent draw state, the `and/or` ternary trap), see the gotchas in `AGENTS.md`. This file is WHAT EXISTS; that is HOW IT BEHAVES.
