---
"picopilot": patch
---

Steer the build toward a visually-verified cart and away from the `serve` tar pit, so weaker models follow the same disciplined loop the strong ones already do.

- **Scaffolded `AGENTS.md` now spells out the build loop + a definition of done:** every iteration ends by SEEING the cart run (a temporary `extcmd("screen")` probe screenshot, or `picopilot playtest run`), with the probe recipe inline. It states plainly that a green `verify` or a bare `run` timeout is NOT proof the cart works, and that the finished-cart handoff is `pico8 -run <path>` (not a browser serve), with no extra summary docs / scripts / banners as deliverables.
- **`picopilot run`'s timeout CTA is now screenshot-aware:** a timeout with NO screenshot says a timeout alone does not prove it works and points at the probe / `playtest` / `verify`; a timeout WITH a screenshot is framed as the expected interactive-game case.
- **`serve` is scoped to its real role (sharing a playable build with a human, not self-verification):** the command description and the labelless `export-failed` message now redirect to `run`/`playtest` for verifying your own build, and point at the real label remedy (`export --label`) instead of hand-editing `main.p8`.
