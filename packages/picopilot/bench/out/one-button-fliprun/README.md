# FLIPRUN — curated game-jam sample (theme: one button, 50 minutes)

A committed sample entry from the picopilot game-jam benchmark. Theme **one button**, 50-minute budget, built fully autonomously by a `pi` agent driven by `bench/game-jam/run-jam.sh`.

## Why this one is curated

This is the first entry built with the split game skills (`game-jam` + `game-design-reference`). The agent interpreted "one button" as flipping GRAVITY between floor and ceiling (a fresh take on the usual one-button jump), then, unprompted, applied the universal design lenses the skills teach: it audited the whole generated track to prove there are no unfair dead states and that every reaction window clears the human ~250ms floor (worst case ~0.59s), rather than tuning against its own frame-perfect input. Judge score **93/100**; `verify` green at **1351/8192 tokens** (16%).

It is a good, readable, finished game: a gravity-flip auto-runner with spikes on both surfaces, an optional risk/reward orb + combo-multiplier scoring layer, a title screen, win (reach the goal) / lose (hit a spike) with retry, screen-shake/flash/landing-dust juice, and a looping two-channel music track. The runner's colour and eye direction encode current gravity so the single button's effect is always legible.

## Files

- `main.p8` / `main.lua` — the shipped cart (edit `main.lua`; the `.p8` `#include`s it).
- `JAM.md` — the agent's own writeup: theme interpretation, mechanic, controls, the fairness/reaction audits, and the calls it made under the clock.
- `verdict.md` — the independent judge agent's rubric verdict.
- `picopilot.json` — the cart's picopilot config.
- `shots/` — live-gameplay screenshots captured via `picopilot playtest`.

## Play it

```
picopilot run main.p8          # boot it headless (or open main.p8 in PICO-8)
picopilot playtest run main.p8 # drive it and capture gameplay shots
```

Controls: **X or Z** flips gravity (the only input); same button restarts on the win/lose screen.
