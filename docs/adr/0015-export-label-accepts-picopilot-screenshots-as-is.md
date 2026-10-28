# `export --label` accepts picopilot's own screenshots as-is; `serve` gains the same `--label`

Amended by ADR-0016: the deferred `--label-from-run` option below shipped as `--label-frame <n>` on `export` and `serve`.

`picopilot run`/`playtest` capture frames with PICO-8's `extcmd("screen")`, which writes a pixel-exact upscale (384x384 8-bit RGB at the default 3x `screenshot_scale`), but `export --label` (ADR-0013) only accepted an exact 128x128 8-bit RGB/RGBA PNG. The natural loop "run, take a screenshot, export with it as the label" failed on size, and shrinking the shot with an image tool then failed on format (ImageMagick writes a 4-bit palette-indexed PNG). We decided `--label` takes the screenshot unchanged: the dependency-free decoder in `engine/gfx/label.ts` now reads every non-interlaced standard PNG (palette-indexed 1/2/4/8-bit via PLTE, greyscale, grey+alpha, RGB/RGBA at 8 or 16 bits), and any SQUARE EXACT INTEGER MULTIPLE of 128 (256, 384, 512, ...) is downscaled by nearest-neighbour sampling of each block's centre. Every other size still fails as `label-wrong-size`, and both label errors CTA toward passing the picopilot screenshot directly.

We also gave `serve` the same `--label <png>` flag. `serve` always exports from the CART (ADR-0014), and `export --label` deliberately never writes the label into the cart, so the old labelless `serve` remedy ("`export --label`, then re-serve") could never work: the re-serve hit the same missing label. Both commands now share one label step (`commands/label-cart.ts`: labeled throwaway copy next to the cart, existing label wins, cart never mutated).

## Considered Options

- **General resampling of any size (rejected).** Scaling a 200x200 or non-square image means choosing a crop/stretch/filter policy, and a filtered resize blends colours that then snap to the wrong palette entries. Integer multiples are exactly what PICO-8 produces and downscale losslessly; anything else is almost certainly the wrong image, so it stays fail-loud.
- **`run --label <path>` writing a 128x128 label-ready PNG next to the screenshots (rejected).** Once `--label` reads the screenshot verbatim there is no intermediate file left to skip, so this adds an output to a thin capture command (ADR-0006) that only duplicates what `export` already does, and it would need a second flag on `playtest` too.
- **`export --label-from-run` (deferred, not rejected).** Running an ARBITRARY cart to grab a frame needs a playtest-style harness transform, because a cart does not self-screenshot. That was the queued `--label-frame` idea, since built (ADR-0016).
- **Fix `serve` by making `export --label` (or a new command) persist the label into the cart (rejected).** Writing a binary section of the user's cart behind a flag named for export breaks the "cart is never mutated" guarantee from ADR-0013. Giving `serve` the flag keeps that guarantee and mirrors `export` exactly.

## Consequences

- `export --label` keeps its flag; the set of images it accepts grew, plus the CTA on `label-wrong-size` / `label-unsupported-png`. `serve` gains `--label` with identical semantics and errors.
- Interlaced (Adam7) PNGs are still rejected as `label-unsupported-png`: PICO-8 never writes them and supporting them is code with no real caller.
- A real PICO-8 0.2.7 capture is checked in as a test fixture (`engine/gfx/fixtures/pico8-screenshot-384.png`), so a change in PICO-8's screenshot format shows up as a red test rather than as a user report.
