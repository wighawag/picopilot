---
"picopilot": minor
---

Every command now works on a machine with no display and no sound card. Audio recording (`audio record`, `audio render`, `run --record-audio`) needs a real PICO-8 session, so when there is no display picopilot starts a private virtual display for it (`Xvfb -displayfd`, or `xvfb-run` as a fallback, with `SDL_AUDIODRIVER=dummy`) and always stops it afterwards. The new global `--display auto|xvfb|native` (also `PICOPILOT_DISPLAY` or `"display"` in `picopilot.json`) controls this; `auto` is the default and only goes virtual when needed. With no display and no Xvfb, recording fails with a structured `display-unavailable` error naming the fix instead of timing out.

New `picopilot doctor` reports what the machine can do (PICO-8 found, runs headless and its version, shrinko8, the display a recording would use) and which commands are available.

Fixes: PICO-8 now inherits the parent environment (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, HOME, XDG_RUNTIME_DIR, SDL_*), so recording also works on a desktop again; it used to get only PICO8_PATH and PATH. shrinko8 likewise now inherits the parent environment (it used to get only PATH), so a `pip install --user` shrinko that needs HOME is found. The record harness now inlines `#include` files, so carts made by `picopilot init` (`#include main.lua`) record instead of failing to load. A recording that produces no WAV now says why (`noAudioReason`) and includes the tail of PICO-8's log (`pico8LogTail`).
