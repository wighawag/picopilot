# picopilot

## 0.1.2

### Patch Changes

- 00b4f00: Make "done" mean the game's behaviour is verified, not just that a frame renders, so state-transition bugs (a pickup that never despawns, lives that do not reset on restart) get caught before handoff.

  The scaffolded `AGENTS.md` build loop now tells the agent to SEE the cart PLAY (drive it via `picopilot playtest run` or the temporary `run` probe and compare a SEQUENCE of frames for motion and state change), and its definition of done requires driving the core loop and confirming state actually behaves. The check is deliberately GENERIC: it refuses a fixed mechanic checklist and instead tells the agent to enumerate the state transitions ITS OWN game defines and verify each (with a `printh` state-dump fallback), so it neither assumes mechanics the game lacks nor checks only a canned list and misses the rest.

## 0.1.1

### Patch Changes

- 528b9b4: Steer the build toward a visually-verified cart and away from the `serve` tar pit, so weaker models follow the same disciplined loop the strong ones already do.

  - **Scaffolded `AGENTS.md` now spells out the build loop + a definition of done:** every iteration ends by SEEING the cart run (a temporary `extcmd("screen")` probe screenshot, or `picopilot playtest run`), with the probe recipe inline. It states plainly that a green `verify` or a bare `run` timeout is NOT proof the cart works, and that the finished-cart handoff is `pico8 -run <path>` (not a browser serve), with no extra summary docs / scripts / banners as deliverables.
  - **`picopilot run`'s timeout CTA is now screenshot-aware:** a timeout with NO screenshot says a timeout alone does not prove it works and points at the probe / `playtest` / `verify`; a timeout WITH a screenshot is framed as the expected interactive-game case.
  - **`serve` is scoped to its real role (sharing a playable build with a human, not self-verification):** the command description and the labelless `export-failed` message now redirect to `run`/`playtest` for verifying your own build, and point at the real label remedy (`export --label`) instead of hand-editing `main.p8`.

## 0.1.0

### Minor Changes

- a989c1a: First feature release of picopilot, the agent-first PICO-8 toolchain (a single TypeScript CLI on the incur framework that is also an MCP server and a set of auto-installable agent skills). Highlights:

  - **Core cart loop:** `init` scaffolding (the `#include main.lua` layout), the `tokens` budget loop, `verify` as the single static acceptance gate (tokens + lint + integrity, with the honest `gate-incapable` outcome when shrinko is absent), and `minify`.
  - **Eyes (art):** the `gfx set` (char-grid) -> `gfx render` (viewable PNG) -> look-and-fix loop, with the gfx/map overlap smart-refuse.
  - **Ears (audio, v2):** `sfx from-mml` and `music from-patterns` over a documented picopilot-MML subset tuned to PICO-8's exact capabilities, SFX filters (`!dampen`/`!reverb`), and record-based `audio render`.
  - **Run + playtest:** headless `run` (boot + screenshot + printh, ends on a done-sentinel), and `playtest` which drives an arbitrary cart through scripted input and captures real gameplay, one-shot plus a resumable live session (btn/btnp -> serial transform over a fixed-block + ACK transport; ADR-0011/0012).
  - **Export:** `export` produces a browser-playable PICO-8 HTML bundle, with an optional `--label` splash.
  - **Skills:** auto-installable discipline skills (overview, code, art, audio, debug) plus a composed game-design pair (`game-jam` + `game-design-reference`) carrying fairness, human-reaction-budget, visibility, originality-method, and budget-scaled progression guidance.
  - **Hygiene:** every PICO-8 launch is isolated with `-home` so it never writes config/data into the working tree.
  - Includes a hands-on platformer tutorial (`examples/platformer/`) and a curated game showcase.
