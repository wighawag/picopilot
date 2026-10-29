---
"picopilot": patch
---

`audio render` and `audio record` no longer kill PICO-8 at 30 s whatever `--seconds` says: a window of about 24 s or more used to fail with `captured:false` and a misleading "never reached audio_end" reason. The default backstop is now the record window plus 30 s for startup, and an explicit `--backstop-ms` too small for the window is refused up front as `audio-backstop-too-small`.
