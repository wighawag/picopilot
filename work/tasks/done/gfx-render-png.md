---
title: gfx render — upscaled palette-accurate PNG (shrinko-free TS encoder)
slug: gfx-render-png
spec: picopilot
blockedBy: [gfx-grid-codec-show-set]
covers: [7, 8]
---

## What to build

The see-and-fix art loop's JUDGE surface. `picopilot gfx render <sprite|sheet>` emits an UPSCALED (nearest-neighbour to ~256px), true-16-colour-palette PNG to a known path, so a multimodal agent can LOOK at the actual pixels and judge whether the sprite reads as intended. The char grid is the edit surface; the rendered PNG is the judge surface (models generate structured visual source well but read it back poorly — author-observed, the SVG parallel).

The encoder is a shrinko-FREE TS hex→PNG codec using PICO-8's fixed 16-colour palette (the RGB table in the findings doc). It extends `engine/gfx` (hence blockedBy the codec task — same module, serialized to avoid conflicts). Wire the CTA loop: `gfx render` (look) → `gfx set` (fix) → `gfx render` (re-look). The tool ALWAYS emits both the PNG path and the grid; the non-multimodal fallback (view the PNG, else reason over the grid) lives in the `picopilot-art` skill (the skills task), not here — but the tool must emit both so the skill can branch.

Note: `gfx render` (VIEWING, upscaled, palette-accurate) is DISTINCT from `gfx export` (a raw 128x128 spritesheet round-trip for external tools, which is shrinko-backed and lives in v1-rest).

## Acceptance criteria

- [ ] `gfx render <sprite>` writes an upscaled (nearest-neighbour, ~256px) PNG with the CORRECT PICO-8 palette RGB per index (assert PIXEL BYTES for known hex input, not just "a file exists").
- [ ] `gfx render sheet` renders the whole spritesheet similarly.
- [ ] The result reports the PNG path AND the grid (so the skill can pick view-vs-imagine).
- [ ] The encoder uses NO shrinko (pure TS hex→PNG with the fixed palette).
- [ ] CTA wiring: `gfx render` → `gfx set` → `gfx render`.
- [ ] Tests assert deterministic pixel output against the palette table for known sprites.

## Blocked by

- `gfx-grid-codec-show-set` — extends `engine/gfx`; serialized on the same module to avoid merge conflicts.

## Prompt

> Goal: make "the agent gets eyes" literally true — render a sprite to a viewable, upscaled, palette-accurate PNG so a multimodal agent can judge its art, closing the loop the char grid opens.
>
> FIRST, drift-check: confirm `gfx-grid-codec-show-set` landed and `engine/gfx` exists; extend it.
>
> Domain: PICO-8's palette is a FIXED 16 RGB values — the exact table is in `work/notes/findings/pico8-api-reference.md` (index → R,G,B). Use THAT table as the single source of truth (the same table the AGENTS.md reference cites — do not re-invent RGB values). Nearest-neighbour upscale an 8x8 sprite (or the 128x128 sheet) to ~256px so it is actually viewable. This is a pure-TS PNG encoder — shrinko-free (keeps the eyes-loop dependency-light, in v1-core).
>
> Where to look: `engine/gfx` (extend the codec); `work/notes/findings/pico8-api-reference.md` (palette RGB); incur CTAs (wire render→set→render). The non-multimodal fallback text is the `picopilot-art` skill's job (separate task) — here, just ensure the tool emits BOTH the PNG path and the grid.
>
> Seam to test at: deterministic pixel bytes — feed known `__gfx__` hex, assert the PNG's pixels are the exact palette RGB at the right upscaled positions. Done = an agent can render, look, fix, re-look. Record any encoder choice (PNG lib vs hand-rolled, upscale factor) in the done record.
