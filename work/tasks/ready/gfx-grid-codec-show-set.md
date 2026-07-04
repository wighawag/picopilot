---
title: engine/gfx hex↔char-grid codec + gfx show/set with map-overlap smart-refuse
slug: gfx-grid-codec-show-set
prd: picopilot
blockedBy: [cart-model-and-p8-io, init-scaffold]
covers: [6, 9, 10]
---

## What to build

The see-and-fix art loop's EDIT surface. Build `engine/gfx`, a shrinko-free TS codec converting a sprite's `__gfx__` hex ↔ a readable character grid (`.` = transparent, `0-F` = the 16 palette indices), and wire it to two commands:

- `picopilot gfx show <sprite>` — render a sprite from `__gfx__` to a char grid, with a CTA to `gfx set`.
- `picopilot gfx set <sprite>` — write a char grid back into `__gfx__`.

`gfx set` on sprites 128-255 (which alias `__map__` rows 32-63) must implement the SMART REFUSAL (DECIDED, Q4): inspect the overlapping `__map__` region; if empty/all-zero OR authorised (`--allow-map-overlap` flag OR `allowMapOverlap` in `picopilot.json`), allow the write (noting the aliasing in the result); if it contains real tiles AND nothing authorised the loss, REFUSE with a structured `{ok:false, reason:"map-overlap", detail, remedy}` + nonzero exit, leaving `__map__` BYTE-UNCHANGED. Warn-and-succeed is explicitly rejected (an agent treats exit-0 as done).

## Acceptance criteria

- [ ] `engine/gfx` round-trips `__gfx__` hex → char grid → hex as an IDENTITY (asserted).
- [ ] `gfx show <sprite>` prints the grid with a CTA to `gfx set`; `gfx set <sprite>` writes the grid back via the cart model.
- [ ] `gfx set` on a 0-127 sprite always succeeds (no overlap possible).
- [ ] `gfx set` on a 128-255 sprite: all-zero overlap → succeeds (notes aliasing); real tiles + unauthorised → structured `map-overlap` refusal + nonzero exit + `__map__` bytes UNCHANGED (assert the bytes); `--allow-map-overlap` or `allowMapOverlap` config → succeeds.
- [ ] The refusal envelope uses incur's `error({code, message, cta})` shape.
- [ ] Tests cover the codec identity + all overlap branches; the "refusal leaves map bytes untouched" assertion is the silent-corruption regression guard.

## Blocked by

- `cart-model-and-p8-io` — reads/writes `__gfx__` and inspects `__map__` through the cart model.
- `init-scaffold` — the `--allow-map-overlap` config authorisation reads `allowMapOverlap` from `picopilot.json`, whose schema + reading `init-scaffold` defines. (The `--allow-map-overlap` FLAG works without it; the CONFIG path needs the schema to exist first.)

## Prompt

> Goal: give the agent an EDIT surface for pixel art — a char grid it reads and writes — and make `gfx set` incapable of silently destroying map data.
>
> FIRST, drift-check: confirm `cart-model-and-p8-io` landed with addressable `__gfx__`/`__map__` region access; build the codec on it.
>
> Domain (see `work/notes/findings/pico8-api-reference.md` + `CONTEXT.md`): `__gfx__` holds 256 8x8 sprites as per-pixel hex; the char grid is the "SVG for pixels" (`.` = transparent, `0-F` = the 16 palette indices). Sprites 128-255 (`0x1000`) ALIAS `__map__` rows 32-63 — writing them can clobber map tiles the agent can't see. The invariant (Q4): picopilot never SILENTLY overwrites existing map tiles that nothing authorised. Authorisation = `--allow-map-overlap` on the invocation OR `allowMapOverlap` in `picopilot.json` (the config `init` defined). Blanket-refuse-all-128-255 and warn-and-succeed were both rejected — implement the SMART refuse (only stops in the real-data-loss corner).
>
> Where to look: `engine/gfx` (new codec home); the cart model for gfx/map region access; incur's `error()` envelope for the structured refusal. This task OWNS the gfx module; the `gfx render` task extends it later, so keep the codec cleanly separable.
>
> Seams to test at: codec round-trip identity; every overlap branch, especially "refusal leaves `__map__` bytes untouched" (the regression guard). Done = the agent can read a sprite, fix it, write it back, and can never silently clobber the map. Record any refusal-code/exit-code choice you make in the done record.
