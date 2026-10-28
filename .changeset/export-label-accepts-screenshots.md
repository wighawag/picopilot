---
"picopilot": patch
---

`export --label` now takes a `picopilot run`/`playtest` screenshot as-is. PICO-8 writes screenshots as a 384x384 (3x) upscale, which `--label` used to reject as the wrong size, and shrinking one with an image tool then failed on the indexed PNG format it produced. The label decoder now reads palette-indexed (1/2/4/8-bit), greyscale and 16-bit PNGs as well as RGB/RGBA, and downscales any square exact multiple of 128x128 (256, 384, 512, ...) by nearest-neighbour sampling. Other sizes still fail as `label-wrong-size`, now naming the accepted sizes, and both label errors point you at passing the screenshot directly instead of reaching for an image tool. `picopilot serve` gains the same `--label` flag: it always exports from the cart, and `export --label` never writes the label into the cart, so its old advice ("export --label, then re-serve") could not work. The `picopilot-debug` skill documents the run-then-export label workflow.
