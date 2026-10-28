# picopilot

## 0.2.0

### Minor Changes

- 9837589: Every command now works on a machine with no display and no sound card. Audio recording (`audio record`, `audio render`, `run --record-audio`) needs a real PICO-8 session, so when there is no display picopilot starts a private virtual display for it (`Xvfb -displayfd`, or `xvfb-run` as a fallback, with `SDL_AUDIODRIVER=dummy`) and always stops it afterwards. The new global `--display auto|xvfb|native` (also `PICOPILOT_DISPLAY` or `"display"` in `picopilot.json`) controls this; `auto` is the default and only goes virtual when needed. With no display and no Xvfb, recording fails with a structured `display-unavailable` error naming the fix instead of timing out.

  New `picopilot doctor` reports what the machine can do (PICO-8 found, runs headless and its version, shrinko8, the display a recording would use) and which commands are available.

  Fixes: PICO-8 now inherits the parent environment (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, HOME, XDG_RUNTIME_DIR, SDL_*), so recording also works on a desktop again; it used to get only PICO8_PATH and PATH. shrinko8 likewise now inherits the parent environment (it used to get only PATH), so a `pip install --user` shrinko that needs HOME is found. The record harness now inlines `#include` files, so carts made by `picopilot init` (`#include main.lua`) record instead of failing to load. A recording that produces no WAV now says why (`noAudioReason`) and includes the tail of PICO-8's log (`pico8LogTail`).

## 0.1.5

### Patch Changes

- 74be3d7: `export --label` now takes a `picopilot run`/`playtest` screenshot as-is. PICO-8 writes screenshots as a 384x384 (3x) upscale, which `--label` used to reject as the wrong size, and shrinking one with an image tool then failed on the indexed PNG format it produced. The label decoder now reads palette-indexed (1/2/4/8-bit), greyscale and 16-bit PNGs as well as RGB/RGBA, and downscales any square exact multiple of 128x128 (256, 384, 512, ...) by nearest-neighbour sampling. Other sizes still fail as `label-wrong-size`, now naming the accepted sizes, and both label errors point you at passing the screenshot directly instead of reaching for an image tool. `picopilot serve` gains the same `--label` flag: it always exports from the cart, and `export --label` never writes the label into the cart, so its old advice ("export --label, then re-serve") could not work. The `picopilot-debug` skill documents the run-then-export label workflow.
- f1eacbe: `export` and `serve` can now make the loading splash from the game itself: `--label-frame <n>` runs a labelless cart headlessly through the playtest harness with no input, and bakes frame `n` in (0-based: 0 is the first drawn frame, usually the title screen) as the `__label__`. The cart does not need to screenshot itself, and it is never modified (a labeled copy is exported). A cart that already has a label keeps it and is not run; passing both `--label` and `--label-frame` is rejected as `label-flags-conflict`; a cart that never reaches frame `n` fails as `label-frame-not-captured` with its last output and a CTA that reproduces the same frame in a playtest session. The labelless-cart messages now suggest `--label-frame 0` first. `export` also reports `labelSource` (`cart`, `image`, `frame` or `none`).
- 5e34776: `playtest shot` now returns the screenshot it just took. PICO-8 acknowledges the SHOT before the PNG is on disk, so the path was often missing, and the old "most recent PNG" fallback could return the previous shot instead. It now waits briefly for the exact file.

## 0.1.4

### Patch Changes

- d98efab: Make the agent JUDGE the rendered frame, not just confirm it drew, so readability and layout-fairness defects get caught. A large-model run verified every state transition thoroughly but shipped a game where a hazard was the same colour as the background and obstacle gaps were too tight to pass, because it only ever confirmed screenshots "rendered" and never critiqued them.

  The scaffolded `AGENTS.md` definition of done now adds a "judge the frame" check: when you look at a gameplay screenshot, actively hunt for what is WRONG (can you tell every entity apart from the background and each other; are hazards spaced so a human can react in ~250ms rather than frame-perfect; does it look intentional), because "it renders" is not "it is good". `game-design-reference` gains the matching self-check that applies its readability + fairness lenses to the actual rendered image, not just the logic. Kept concrete (distinguishable? clearable? intentional?) rather than a vague "make it pretty".

## 0.1.3

### Patch Changes

- f884a6f: Ship a PICO-8 API reference and stop the agent guessing, and make "done" catch mislabeled outcomes and too-easy games. These target the exact ways a weak model wasted runs and shipped bugs.

  - **New `reference/pico8-api.md` resource under `picopilot-code`:** the exact function names + signatures for the common API, plus a table of the wrong names an LLM reaches for (`rand`/`ranf`, `rectcol`, `math.floor`, `table.insert`, `poke4` for saving, `spr` with extra args) and their real PICO-8 equivalents. `picopilot-code` and the always-loaded `AGENTS.md` now point at it with a "do NOT guess an API name, look it up" rule, so a nil-call crash does not cost a whole playtest round. The resource ships to installed skills via the existing resource-copy seam.
  - **Stronger definition of done in `AGENTS.md`:** beyond "state behaves, not just renders", it now adds two generic checks: drive EVERY distinct kind of interaction and confirm its effect has the intended SIGN (the classic bug is a hazard that adds score instead of costing a life), and run the design self-checks against what you actually saw (can the player genuinely lose, or is it too easy / does it escalate / is it fair). Kept generic, no fixed mechanic checklist.

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
