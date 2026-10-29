---
"picopilot": patch
---

`audio record` and `run --record-audio` now work on carts that use `_update60`. The recorder only hooked `_update`, which PICO-8 does not call when a cart defines `_update60`, so recording never started and the run ended on the backstop with `captured:false`. The recorder now hooks whichever update loop the cart uses and counts the window at that loop's frame rate.
