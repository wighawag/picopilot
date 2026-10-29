# picopilot

## 0.3.0

### Minor Changes

- 5fa5fb9: New `picopilot audio analyze <wav>` gives a model that cannot hear a way to judge its music: it reports loudness (mean RMS, the loudest moment and when), brightness (spectral centroid, share of energy above 2 kHz), dynamic range, a loudness profile per half second (with a one-line bar chart) and the loop length, plus plain-language warnings (loud, shrill, bright, monotonous, spikes, near-clipping, repetitive) with the fix for each. Thresholds are calibrated on real soundtracks a listener judged. `--against <sfx.wav>` checks that the music sits under the game's SFX. `audio render` and `audio record` take `--analyze` to attach the analysis to the recording (an `--sfx` render is analyzed as a one-shot: no start skip, only the near-silent and near-clipping checks; `audio analyze --kind sfx` does the same). It needs neither PICO-8 nor Python. The `picopilot-audio` skill now teaches the compose, render, analyze loop and the taste rules (register, soft timbres, rests, long varied loops, volume headroom, a channel left for SFX), and the AGENTS.md written by `picopilot init` points at it.
- 5fa5fb9: Held notes no longer stutter. In picopilot-MML a note longer than one row (`c4`, `l4 c`, `c ^3`) is now ONE note: fade in (`e4`) lands on its first row, fade out (`e5`) becomes a volume ramp that ends on its last row, and drop (`e3`) is a one-row hit followed by silence, instead of every row re-triggering the effect (`l4 e5 c` used to fade out four times). Vibrato, slide and arpeggio still continue on every row, and separate one-row notes (`e5 c c c c`) still re-trigger. Two new tokens shape held notes: `v[...]` is a per-note volume envelope (one digit per row, the last held, an optional release after `/`, e.g. `v[3 2 2 2 1/1 0] a12`) and `~N` starts vibrato from a held note's row N. A volume, effect, waveform, envelope or vibrato change between a note and its `^` tie, which used to be silently ignored, is now refused as `audio-mml-tie-state-change`. Re-transpiling existing MML that held a fade or drop changes its sound (ADR-0019).
- 5fa5fb9: New `picopilot music from-score` writes whole songs: give it a JSON score of one or more songs (for example a title song and an in-game song), each up to 4 channels of picopilot-MML of any length plus a speed, per-channel filters and loop flags, and it splits every channel into aligned 32-row SFX (or `patternRows`), turns a channel that is silent for a whole pattern off, shares identical SFX, allocates slots and writes `__sfx__` and `__music__`. It reports each song's start pattern (for `music(n)`), its length in seconds, and which slot plays where. By default it only uses empty slots, from 63 down, and never touches a slot with notes; `--slots 16-63` gives the music a range it owns, overwriting and clearing it on every run. In both modes an SFX already present byte-for-byte keeps its slot, so re-running an unchanged score changes nothing. New `picopilot sfx clear <slots>` empties slots (`5`, `16-63`, `3,5,9`). `sfx from-mml` still refuses more than 32 rows and now points at `from-score` (ADR-0020).

### Patch Changes

- 5fa5fb9: `audio render` and `audio record` no longer kill PICO-8 at 30 s whatever `--seconds` says: a window of about 24 s or more used to fail with `captured:false` and a misleading "never reached audio_end" reason. The default backstop is now the record window plus 30 s for startup, and an explicit `--backstop-ms` too small for the window is refused up front as `audio-backstop-too-small`.
- 56f2abd: `audio record` and `run --record-audio` now work on carts that use `_update60`. The recorder only hooked `_update`, which PICO-8 does not call when a cart defines `_update60`, so recording never started and the run ended on the backstop with `captured:false`. The recorder now hooks whichever update loop the cart uses and counts the window at that loop's frame rate.

## 0.2.1

### Patch Changes

- 70ee64a: `picopilot --mcp` works again: it failed to start because a dependency of incur moved its stdio transport, so picopilot now uses incur 0.7.1 (one MCP tool per command, as before). Settings now reach MCP tool calls too: `picopilot.json` (the display mode, `gfx set`'s `allowMapOverlap`) is loaded by picopilot itself under `--mcp`, honouring the server's `--config` / `--no-config`; `picopilot --mcp --display <mode>` sets the server-wide display mode; and `display` is an argument of the `run`, `audio_record`, `audio_render` and `doctor` tools. On the command line, `--display` still works before or after the command name.

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
