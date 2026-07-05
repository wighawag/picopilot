# platformer TUTORIAL says `sfx from-mml` is v2/not-built, but it now ships

2026-07-05: `packages/picopilot/examples/platformer/TUTORIAL.md` (~line 341) tells the reader `sfx from-mml` is v2 and "not built yet; until then, author `__sfx__` in PICO-8's own editor." As of the `audio-sfx-from-mml` task the `sfx from-mml` command has landed (shrinko-free picopilot-MML to `__sfx__` transpiler). The example tutorial text is now stale and could be refreshed to point at the real command. Out of scope for the task that noticed it (example docs, not a code contract).
