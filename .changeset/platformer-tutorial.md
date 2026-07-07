---
"picopilot": minor
---

First feature release of picopilot, the agent-first PICO-8 toolchain (a single TypeScript CLI on the incur framework that is also an MCP server and a set of auto-installable agent skills). Highlights:

- **Core cart loop:** `init` scaffolding (the `#include main.lua` layout), the `tokens` budget loop, `verify` as the single static acceptance gate (tokens + lint + integrity, with the honest `gate-incapable` outcome when shrinko is absent), and `minify`.
- **Eyes (art):** the `gfx set` (char-grid) -> `gfx render` (viewable PNG) -> look-and-fix loop, with the gfx/map overlap smart-refuse.
- **Ears (audio, v2):** `sfx from-mml` and `music from-patterns` over a documented picopilot-MML subset tuned to PICO-8's exact capabilities, SFX filters (`!dampen`/`!reverb`), and record-based `audio render`.
- **Run + playtest:** headless `run` (boot + screenshot + printh, ends on a done-sentinel), and `playtest` which drives an arbitrary cart through scripted input and captures real gameplay, one-shot plus a resumable live session (btn/btnp -> serial transform over a fixed-block + ACK transport; ADR-0011/0012).
- **Export:** `export` produces a browser-playable PICO-8 HTML bundle, with an optional `--label` splash.
- **Skills:** auto-installable discipline skills (overview, code, art, audio, debug) plus a composed game-design pair (`game-jam` + `game-design-reference`) carrying fairness, human-reaction-budget, visibility, originality-method, and budget-scaled progression guidance.
- **Hygiene:** every PICO-8 launch is isolated with `-home` so it never writes config/data into the working tree.
- Includes a hands-on platformer tutorial (`examples/platformer/`) and a curated game showcase.
