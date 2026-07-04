---
title: PICO-8 API reference, palette, and memory map (for the init-scaffolded agent context)
slug: pico8-api-reference
source: 'Lexaloffle PICO-8 manual (lexaloffle.com/dl/docs/pico-8_manual.html) + iiviigames PICO-8 API cheatsheet (iiviigames.github.io/pico8-api, v0.2.3) + the well-known stable PICO-8 0..15 palette RGB constants; retrieved 2026-07-04'
---

# PICO-8 API reference (for picopilot init)

Verified external/domain ground truth: the PICO-8 API surface, the fixed 16-colour palette (RGB), the RAM/memory map, and the workflow discipline an LLM needs to write correct carts. This is the SOURCE for the `AGENTS.md`/`CLAUDE.md` reference that `picopilot init` scaffolds (US #1) AND for the fixed palette the `gfx render` TS encoder uses (US #7). It is curated + token-conscious on purpose: the scaffolded doc is context every agent turn loads, so it carries what models get WRONG without a reference, not the whole manual.

Provenance note: this is a DOC-derived finding (a dated external authority). The palette RGB values are the stable, widely-reproduced PICO-8 constants; if a future PICO-8 version alters them, revise here and in the `gfx render` encoder together.

## PICO-8 hard specs (the constraints that shape everything)

- Display: **128x128**, a **fixed 16-colour palette** (indices 0..15).
- Code: **Lua**, max **8192 tokens** (the #1 failure mode picopilot's `tokens`/`minify` address).
- Sprites: 128 8x8 sprites in the base bank (0..127) + 128 shared (128..255).
- Map: 128x32 8-bit cels + 128x32 shared (the shared half aliases sprites 128..255 — see the memory map + overlap warning below).
- Sound: 4 channels, 64 SFX slots; music is patterns of up to 4 SFX-channel references.
- Numeric range: 16.16 fixed point, `-32768.0 .. 32767.99`.

## The execution-flow loop (every cart)

- `_init()` — called once on startup.
- `_update()` — called once per update at 30fps (`_update60()` for 60fps).
- `_draw()` — called once per visible frame.

A cart with none of these is inert; a missing `_init/_update/_draw` is a classic lint target (US #4).

## The fixed 16-colour palette (index → RGB) — load-bearing for `gfx render`

The `gfx render` PNG encoder (US #7) maps each hex nibble in a char grid to exactly these RGB values:

| idx | hex | name | R | G | B |
|-----|-----|------|---|---|---|
| 0 | 0 | black | 0 | 0 | 0 |
| 1 | 1 | dark-blue | 29 | 43 | 83 |
| 2 | 2 | dark-purple | 126 | 37 | 83 |
| 3 | 3 | dark-green | 0 | 135 | 81 |
| 4 | 4 | brown | 171 | 82 | 54 |
| 5 | 5 | dark-grey | 95 | 87 | 79 |
| 6 | 6 | light-grey | 194 | 195 | 199 |
| 7 | 7 | white | 255 | 241 | 232 |
| 8 | 8 | red | 255 | 0 | 77 |
| 9 | 9 | orange | 255 | 163 | 0 |
| 10 | a | yellow | 255 | 236 | 39 |
| 11 | b | green | 0 | 228 | 54 |
| 12 | c | blue | 41 | 173 | 255 |
| 13 | d | lavender | 131 | 118 | 156 |
| 14 | e | pink | 255 | 119 | 168 |
| 15 | f | peach | 255 | 204 | 170 |

(In the char grid, `.` = transparent; `0-F` = these indices. Indices 128..143 are the extended/secret palette — out of scope for v1.)

## Memory / RAM map (the overlap warning is load-bearing)

```
0x0000  gfx        (spritesheet, sprites 0..127)
0x1000  shared gfx2 / map2   <-- sprites 128..255 ALIAS the bottom half of the map here
0x2000  map
0x3000  gfx flags
0x3100  song  (music)
0x3200  sfx
0x4300  user data
0x5e00  persistent cart data (256 bytes)
0x5f00  draw state
0x5f40  hardware state
0x5f80  gpio pins (128 bytes)
0x6000  screen (8k)
```

**gfx/map overlap (drives picopilot's smart-refuse, US #9 / Q4):** sprites 128..255 (`0x1000`-`0x1fff`) occupy the SAME memory as `__map__` rows 32..63. Writing sprite 130's pixels clobbers the map tiles stored there. `picopilot gfx set` inspects the overlapping `__map__` region and refuses (structured, nonzero, map bytes untouched) when real tiles are at risk and nothing authorised the loss.

## Cart section markers (text-format `.p8`)

A `.p8` is a text file with sections: `__lua__` (code), `__gfx__` (spritesheet hex), `__gff__` (sprite flags), `__map__` (map hex), `__sfx__`, `__music__`, `__label__`. picopilot's `#include` discipline: the scaffolded `main.p8`'s `__lua__` is a single `#include main.lua`, and the agent edits the plain-Lua `main.lua` — never hand-writing the binary hex sections.

## Most-used API, grouped (what to put in the scaffolded reference)

Graphics: `cls([col])`, `spr(n,x,y,[w,h],[flip_x],[flip_y])`, `sspr(...)`, `map(cx,cy,sx,sy,cw,ch,[layer])`, `pset(x,y,[col])`, `pget(x,y)`, `sget/sset`, `print(str,[x,y,[col]])`, `rect/rectfill(x0,y0,x1,y1,[col])`, `circ/circfill(x,y,r,[col])`, `oval/ovalfill(...)`, `line(...)`, `pal(c0,c1,[p])`, `palt(col,t)`, `camera([x,y])`, `clip([x,y,w,h])`, `color(col)`, `fillp(mask)`, `tline(...)`, `flip()`.

Map: `mget(x,y)`, `mset(x,y,v)`, `map(...)`. Sprite flags: `fget(n,[f])`, `fset(n,[f],v)`.

Input: `btn([i,[p]])`, `btnp([i,[p]])` (buttons 0..5 = left,right,up,down,O/Z,X). Audio: `sfx(n,[channel,[offset]])`, `music([n,[fade,[mask]]])`.

Math: `abs`, `flr` (round down; `-flr(-x)` = ceil), `min`, `max`, `mid`, `rnd(x)`, `srand(x)`, `sgn`, `sqrt`, `sin(x)`/`cos(x)` (range 0..1, sin inverted), `atan2(x,y)`.

Tables/iteration: `add`, `del`, `deli`, `count`, `all(t)`, `foreach(t,f)`, `pairs(t)`, `ipairs`. Memory: `peek(addr)`, `poke(addr,val)`, `memcpy`, `memset`, `cstore`, `reload`. Cart data: `cartdata(id)`, `dget(i)`, `dset(i,v)`. Debug: `printh(str)` (prints to host stdout — picopilot `run` captures this), `stat(n)`.

## Token discipline (the reference should teach this)

Models blow the 8192-token budget by writing verbose Lua. The scaffolded reference should nudge: prefer PICO-8 shorthands (`?` for print, `if(c) x=1` inline-if, `+=`/`-=`/`*=` compound assignment, `\` integer divide), reuse locals, and run `picopilot tokens` each iteration. `picopilot minify` (safe-only) reclaims budget without changing behaviour.
