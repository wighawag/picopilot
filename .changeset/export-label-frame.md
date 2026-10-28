---
"picopilot": patch
---

`export` and `serve` can now make the loading splash from the game itself: `--label-frame <n>` runs a labelless cart headlessly through the playtest harness with no input, and bakes frame `n` in (0-based: 0 is the first drawn frame, usually the title screen) as the `__label__`. The cart does not need to screenshot itself, and it is never modified (a labeled copy is exported). A cart that already has a label keeps it and is not run; passing both `--label` and `--label-frame` is rejected as `label-flags-conflict`; a cart that never reaches frame `n` fails as `label-frame-not-captured` with its last output and a CTA that reproduces the same frame in a playtest session. The labelless-cart messages now suggest `--label-frame 0` first. `export` also reports `labelSource` (`cart`, `image`, `frame` or `none`).
