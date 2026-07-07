# brand

picopilot's logo, and a proof it is a genuine PICO-8 drawing.

The canonical, served logo is the SVG at `website/static/logo.svg` (a chunky
pixel FLOWER on a PICO-8 console, drawn on a 16px grid using only PICO-8 palette
colours). Because every rectangle sits on that grid and every fill is an exact
PICO-8 palette entry, the mark can be reproduced 1:1 inside PICO-8 itself.

- **`logo.p8`** - the logo as a PICO-8 cart: one `rectfill` per SVG `<rect>`, at
  the same 128x128 coordinates, same palette indices. Load and Run it in PICO-8
  to see the mark on the fantasy console's own screen.
- **`logo-render.png`** - a screenshot of `logo.p8` running, i.e. how the mark
  looks as an actual PICO-8 frame.

## Render it yourself

```sh
picopilot run brand/logo.p8   # or open brand/logo.p8 in PICO-8 and press Ctrl+R
```

To capture a PNG, add the usual screenshot lines to `_update` (see the
`picopilot-debug` skill: `extcmd("set_filename",...)` + `extcmd("screen")`), or
take a shot in PICO-8 with F7.

## Size note

The design is on a 16px grid, so drawn 1:1 at 128x128 (as here) it is a chunky,
full-screen mark. As a native sprite the coarsest honest size is ~16x16 (a 2x2
sprite block); at that size it is recognisable but the red/peach/yellow centre
detail compresses (the core/eye/leaves use 12/20/10px sizes that are not clean
16px multiples). The 128x128 primitive drawing is the intended form.
