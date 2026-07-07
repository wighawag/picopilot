# REVOLVE — curated game-jam sample (theme: one button, 50 minutes)

A committed sample entry from the picopilot game-jam benchmark. Theme **one button**, 50-minute budget, built fully autonomously by a `pi` agent driven by `bench/game-jam/run-jam.sh`.

## Why this one is curated

REVOLVE is the entry where the split game skills fully paid off: it is the first run where the agent actually **read `game-design-reference`** (via the fixed `game-jam` pointer) and applied its universal design lenses as concrete, tested engineering, not just prose. The button REVERSES the direction of your orbit around a central sun (direction, not impulse: a deliberate step away from the obvious flappy/tap-to-jump reading). Judge score **90/100**; `verify` green at **1384/8192 tokens**.

What makes it a good demonstration is visible in `JAM.md`: rather than eyeballing fairness, the agent

- enforced a **no-dead-state guarantee** at spawn time (hazards kept >0.28 turns apart and clear of the reverse-escape arc, so a reverse is always a safe out),
- **proved it adversarially** by driving two throwaway in-cart auto-players headless (a reflex bot and a deliberately self-trapping "panic-dodger") and confirming neither can ever lose a life,
- **found and fixed a reaction-budget defect on itself** (at top speed the spawn lead left only ~4.7 reactable frames, below the human reaction floor, "the exact trap the design reference warns of"), by scaling the spawn lead with speed so the reaction window stays human-sized,
- and gave gentle first contact (a grace period + guaranteed-safe opening spawns) per the difficulty-curve principle.

The result is a finished, fair, readable game: a starfield orbit-dodger with pickups, a telegraphed hazard/bonus system, a combo-restores-a-life skill layer, title/win/lose screens, particles/shake/flash juice, and a looping music track.

## Files

- `main.p8` / `main.lua` — the shipped cart (edit `main.lua`; the `.p8` `#include`s it).
- `JAM.md` — the agent's own writeup, including the fairness/reaction audits and the calls it made under the clock.
- `verdict.md` — the independent judge agent's rubric verdict.
- `picopilot.json` — the cart's picopilot config.
- `shots/` — live-gameplay screenshots captured via `picopilot playtest`.

## Play it

```
picopilot run main.p8          # boot it headless (or open main.p8 in PICO-8)
picopilot playtest run main.p8 # drive it and capture gameplay shots
```

Controls: **X or Z** reverses your orbit direction (the only input); grab 10 pickups to win, lose 3 lives to crash.
