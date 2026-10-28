# `--label-frame <n>` captures the export label from the running cart via the playtest harness, with no input

`export` and `serve` gain `--label-frame <n>`: when the cart has no `__label__`, picopilot runs it headlessly through the playtest drive harness (ADR-0011) with NO input, captures frame `n` (0-based: 0 = the first drawn frame, usually the title screen; it runs `n + 1` frames and screenshots after the last), decodes it with the label builder (ADR-0015), and exports a labeled throwaway copy. A game's best splash is a frame of the game, and before this the agent still had to produce the image itself, even though picopilot already knew how to run a cart and capture frames. The harness is what makes it general: an arbitrary cart does not screenshot itself, but the harness owns its frame loop, so the capture is deterministic and needs no change to the cart.

## Considered Options

- **A bare boolean `--label-frame` with an implicit frame (rejected).** Which frame is a good splash is game-specific: frame 0 is the safe title-screen default, but a cart with a fade-in or an animated title needs a later one. A required number keeps the choice explicit and visible in the command, and `--label-frame 0` is the short spelling of the default.
- **Scripted input to reach gameplay, e.g. `--label-input` (deferred).** A gameplay splash needs input to get past the title, which means the full playtest input grammar on `export`. The no-input title frame covers the common case; for a gameplay frame, `playtest run` then `--label <shot>` already works with the screenshot as-is (ADR-0015). Add the flag only if that two-step proves to be a real chore.
- **Precedence between `--label` and `--label-frame` (rejected in favour of an error).** Passing both is a mistake, not a fallback chain, so it fails as `label-flags-conflict` before anything runs.
- **Keeping the captured screenshot as an output (rejected for now).** It lives in a temp capture dir that is removed; the label is visible in the exported bundle, and a playtest session reproduces the exact same no-input frame to look at first (`playtest start <cart>`, `playtest step <id> --frames <n+1>`, `playtest shot <id>`). `playtest run` does NOT: it applies its generic input and fixed shot frames.

## Consequences

- The label step is shared by `export` and `serve` (`commands/label-cart.ts`) and is now async, taking the adapter's `drive`. Precedence is unchanged: the cart's own label wins (and then nothing is run), else `--label` or `--label-frame`, else PICO-8's labelless behaviour with the existing CTA.
- `--label-frame` needs PICO-8 even before the export step; absence is the usual structured `pico8-not-found`. A cart that never reaches frame `n` (boot error, backstop) fails as `label-frame-not-captured` with the exit reason and the last `printh` lines, and nothing is exported.
- `export` reports `labelSource` (`cart` / `image` / `frame` / `none`) so an agent can see which path produced the splash.
- The capture costs one extra headless run, roughly 40 ms per frame on PICO-8 0.2.7 because the cart drains one command block per PICO-8 frame, so large `n` is bounded by `--backstop-ms` (which now also covers the capture run; a timeout CTAs toward raising it).
- The `#include` resolver moved from `playtest` to `commands/cart-includes.ts` so both drive users share it. The idea note this came from (`export-label-frame-auto-screenshot`) is deleted, per the work/ contract for a built idea.
