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

`gfx set` on sprites 128-255 (which alias the shared map region) must implement the SMART REFUSAL (DECIDED, Q4 / ADR-0004). READ-FIRST, CORRECTED SEAM (the first build of this task caught a false premise): the shared bytes at risk live in the `__gfx__` `0x1000` bank, NOT in the text-format `__map__` section (a `.p8`'s `__map__` stores only rows 0-31; the shared rows 32-63 live in the `__gfx__` upper bank). So the check does NOT inspect `__map__` (`MapData` only holds rows 0-31, so `nonZeroTilesInRows(mapRowsForSprite(n))` is always 0 — that composition is a dead end, do not use it). Instead: inspect whether the TARGET SPRITE'S CURRENT `__gfx__` pixels are non-zero (does the shared region already hold data?). If all-zero OR authorised (`--allow-map-overlap` flag OR `allowMapOverlap` in `picopilot.json`), allow the write (noting the aliasing in the result); if the sprite's current pixels are non-zero AND nothing authorised the loss, REFUSE with a structured `{ok:false, reason:"map-overlap", detail, remedy}` + nonzero exit, leaving the sprite's `__gfx__` bytes BYTE-UNCHANGED. Warn-and-succeed is explicitly rejected (an agent treats exit-0 as done).

## Acceptance criteria

- [ ] `engine/gfx` round-trips `__gfx__` hex → char grid → hex as an IDENTITY (asserted).
- [ ] `gfx show <sprite>` prints the grid with a CTA to `gfx set`; `gfx set <sprite>` writes the grid back via the cart model.
- [ ] `gfx set` on a 0-127 sprite always succeeds (no overlap possible).
- [ ] `gfx set` on a 128-255 sprite whose CURRENT `__gfx__` pixels are all-zero → succeeds (notes the shared-region aliasing); current pixels non-zero + unauthorised → structured `map-overlap` refusal + nonzero exit + the sprite's `__gfx__` bytes UNCHANGED (assert the bytes); `--allow-map-overlap` or `allowMapOverlap` config → succeeds (overwrites).
- [ ] The refusal envelope uses incur's `error({code, message, cta})` shape.
- [ ] Tests cover the codec identity + all overlap branches; the "refusal leaves the sprite's `__gfx__` bytes untouched" assertion is the silent-corruption regression guard. (Test carts place data by setting the 128-255 sprite's own pixels non-zero — NOT by writing text `__map__` rows, which no sprite aliases.)

## Blocked by

- `cart-model-and-p8-io` — reads/writes `__gfx__` through the cart model (`GfxSheet`). The overlap check reads the TARGET SPRITE'S current `__gfx__` pixels (via `GfxSheet`/`spriteOrigin`), NOT `__map__`. Note: `mapRowsForSprite`/`MapData.nonZeroTilesInRows` model different row spaces and do NOT compose for this check — ignore them here (a follow-up may reconcile or remove them; out of scope for this task).
- `init-scaffold` — the `--allow-map-overlap` config authorisation reads `allowMapOverlap` from `picopilot.json`, whose schema + reading `init-scaffold` defines. (The `--allow-map-overlap` FLAG works without it; the CONFIG path needs the schema to exist first.)

## Prompt

> Goal: give the agent an EDIT surface for pixel art — a char grid it reads and writes — and make `gfx set` incapable of silently destroying map data.
>
> FIRST, drift-check: confirm `cart-model-and-p8-io` landed with addressable `__gfx__`/`__map__` region access; build the codec on it.
>
> Domain (see the CORRECTED `work/notes/findings/pico8-api-reference.md` gfx/map-overlap section + `docs/adr/0004-gfx-map-overlap-smart-refuse.md` + `CONTEXT.md`): `__gfx__` holds 256 8x8 sprites as per-pixel hex; the char grid is the "SVG for pixels" (`.` = transparent, `0-F` = the 16 palette indices). Sprites 128-255 (`0x1000`) occupy the shared map region — but those shared bytes are stored in the `__gfx__` upper bank, NOT the text `__map__` section (which holds only rows 0-31). So "data at risk" IS the target sprite's own current `__gfx__` pixels. The invariant (Q4/ADR-0004): picopilot never SILENTLY overwrites existing shared-region data that nothing authorised. Authorisation = `--allow-map-overlap` on the invocation OR `allowMapOverlap` in `picopilot.json` (the config `init` defined). Blanket-refuse-all-128-255 and warn-and-succeed were both rejected — implement the SMART refuse (only stops in the real-data-loss corner: a 128-255 sprite whose current pixels are non-zero, unauthorised).
>
> CRITICAL — do NOT re-derive the broken composition: the previous build of this task STOPPED because `mapRowsForSprite(n)` (rows 32-63) and `MapData.nonZeroTilesInRows` (rows 0-31 only) cannot compose — the check would always see 0 tiles and never fire. Inspect the sprite's `__gfx__` pixels directly instead (`GfxSheet` + `spriteOrigin`). Ignore the `__map__` path for this check.
>
> Where to look: `engine/gfx` (new codec home); the cart model's `GfxSheet`/`spriteOrigin` for reading the target sprite's current pixels; incur's `error()` envelope for the structured refusal. This task OWNS the gfx module; the `gfx render` task extends it later, so keep the codec cleanly separable.
>
> Seams to test at: codec round-trip identity; every overlap branch, especially "refusal leaves the sprite's `__gfx__` bytes untouched" (the regression guard). Place test data by setting the 128-255 sprite's own pixels non-zero (NOT by writing text `__map__` rows — no sprite aliases those). Done = the agent can read a sprite, fix it, write it back, and can never silently clobber shared-region data. Record any refusal-code/exit-code choice you make in the done record.
