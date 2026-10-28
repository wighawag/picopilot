---
"picopilot": patch
---

`playtest shot` now returns the screenshot it just took. PICO-8 acknowledges the SHOT before the PNG is on disk, so the path was often missing, and the old "most recent PNG" fallback could return the previous shot instead. It now waits briefly for the exact file.
