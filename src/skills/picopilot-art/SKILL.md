---
name: picopilot-art
description: Edit and JUDGE PICO-8 sprites with picopilot. The char-grid edit surface, the rendered-PNG judge surface, the render to look, set to fix, render again loop, and the non-multimodal fallback for models that cannot read images. Also the gfx/map overlap smart-refuse. Use when editing __gfx__ sprites.
---

# picopilot art

Sprites live in the cart as hex blobs you cannot read. picopilot gives you two
distinct surfaces so you can both EDIT precisely and JUDGE honestly. (See
`picopilot-overview` for the `#include` discipline; never hand-edit `__gfx__`.)

## Two surfaces: the char grid (edit) and the PNG (judge)

- **Char grid** (`picopilot gfx show <sprite>` / `gfx set <sprite>`): a per-pixel
  hex grid, `.` = transparent, `0-F` = the 16 fixed PICO-8 colours. This maps 1:1
  to `__gfx__` and is your EXACT, round-trippable EDIT surface. It is the
  SVG-for-pixels source you change.
- **Rendered PNG** (`picopilot gfx render <sprite|sheet>`): an upscaled,
  true-16-colour PNG written to a known path. This is the JUDGE surface: it is
  how you tell whether the sprite READS as intended.

You need both, because coding models generate structured visual source (a grid,
like SVG) well but read it back poorly for gestalt and colour. Edit on the grid;
judge on the PNG.

## The art loop: render → look → set → render

1. `picopilot gfx render <sprite>`: produce the PNG (and get the grid).
2. LOOK at it, then
3. `picopilot gfx set <sprite>`: fix pixels on the char grid.
4. `picopilot gfx render <sprite>`: re-render and look again.

These steps are wired as CTAs, so follow the suggested next command.

## The non-multimodal fallback (load-bearing)

The tool ALWAYS emits both the PNG path AND the char grid, because whether you
can read an image is YOUR capability, not something picopilot can detect.

- If you CAN read images: open the `gfx render` PNG and judge the pixels there.
- If you CANNOT read images: do NOT pretend to. Fall back to reasoning over the
  `gfx show` grid, read the hex nibbles row by row, reconstruct the shape and
  colours in your head, and judge from that. The eyes-loop degrades honestly to
  the grid rather than to guessing.

## gfx/map overlap: the smart-refuse

Sprites 128..255 (`0x1000`-`0x1fff`) ALIAS `__map__` rows 32..63, the SAME
memory. Writing such a sprite can clobber real map tiles you cannot see.

`picopilot gfx set` inspects the overlapping map region:

- overlap empty/all-zero, or overlap authorised: the write succeeds (the result
  notes the aliasing).
- real map tiles at risk AND nothing authorised the loss: it REFUSES with a
  structured `map-overlap` result and a nonzero exit, and leaves `__map__`
  UNCHANGED. This is not a warning you may ignore; it is a stop.

To authorise overlap deliberately, pass `--allow-map-overlap` on the command or
set `allowMapOverlap: true` in `picopilot.json`. Or just use sprites 0..127,
which are gfx-only. The one guaranteed invariant: picopilot never SILENTLY
overwrites existing map tiles.
