---
title: picopilot export --label-frame — auto-capture a gameplay frame as the export __label__ splash
slug: export-label-frame-auto-screenshot
status: proposed
---

# export --label-frame: make the loading splash from the game itself, not a hand-supplied PNG

## The observation that prompts this

PICO-8's HTML export needs a `__label__` (the loading splash), and a labelless cart bails ("please capture a label first"), so `picopilot export` fails loud on it (ADR-0013). We added `export --label <png>` so a labelless cart can be given a splash without an interactive PICO-8 (F7) capture: decode a 128x128 PNG to palette indices, inject it as `__label__` in a throwaway copy, export that. That works, but it still makes the human/agent PRODUCE the image. For a real game the best splash is a frame OF THE GAME, and picopilot already knows how to run a cart headlessly and capture frames.

The concrete case: FLIPRUN (a 50-min jam cart) shipped with no label. To showcase it we hand-drew a FLIPRUN label PNG and passed `--label`. A real gameplay frame (the title screen, or a mid-run beat) would have been a better, zero-authoring splash.

## The idea

`export --label-frame` (and/or `--label-frame <n>`): when the cart has no `__label__`, RUN it headlessly, capture a frame, decode that PNG, and bake it in as the label, then export. No hand-supplied image, no interactive F7. Precedence stays: an existing `__label__` wins; else `--label <png>` (explicit) ; else `--label-frame` (auto from the game); else the current fail-loud CTA.

## Why it fits (and the real catch)

- The screenshot machinery already exists: the `Pico8Adapter` `run`/`drive` path captures screenshots into an isolated `-desktop` dir via the cart's `extcmd("screen")`, and `playtest` already TRANSFORMS a throwaway cart to inject a harness-owned frame loop (ADR-0011). `--label-frame` is the same shape: transform a throwaway copy to screenshot at frame N (and print the done-sentinel), run headless, collect the one PNG, decode it with the label builder we already have (`engine/gfx/label.ts`, `labelHexFromPng`), inject it, export.
- **Catch:** an arbitrary cart does NOT self-screenshot, so picopilot must inject the screenshot+sentinel harness (like the playtest drive transform), pick a frame (title screen at frame 0 is the safe default; a later frame risks a black/empty or spoiler frame), and handle the label being 128x128 while a PICO-8 screenshot is 128x128 already (good) but at the cart's palette state that frame. This is a live-PICO-8 path (manual/opt-in tier, only the absent boundary is CI-testable), and it is a real chunk of orchestration, hence a task, not a flag tweak.

## Scope note

`--label <png>` (explicit image) shipped first because it needed no new PICO-8 orchestration and is fully CI-testable (PNG decode + nearest-palette + inject, all pure). `--label-frame` is the higher-value but heavier follow-up: it turns "give me a label" into "make one from the game," reusing the run/drive capture + the playtest-style harness transform + the existing label builder.

## Related

- ADR-0013 (export is a thin structured wrapper; the label precedence lives here).
- ADR-0011 (playtest drives carts via a harness-owned frame loop — the transform to reuse).
- `engine/gfx/label.ts` (the PNG -> label-hex builder `--label` already uses).
