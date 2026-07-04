---
title: .p8 cart read/write model (parse sections, serialize round-trip)
slug: cart-model-and-p8-io
prd: picopilot
blockedBy: [cli-skeleton-and-verify-gate]
covers: []
---

## What to build

The in-memory cart model + text-format `.p8` I/O that EVERY cart-touching command depends on (gfx, tokens, verify, init). Parse a `.p8` text file into its sections (`__lua__`, `__gfx__`, `__gff__`, `__map__`, `__sfx__`, `__music__`, `__label__`), expose a typed model to read/modify each section, and serialize back to a byte-identical `.p8`. Round-trip (parse → serialize with no change) MUST be an identity.

This is the load-bearing seam, so it earns its own tested task rather than being folded into `init`. It is a self-contained chore (no user story owns "the cart model" directly — it enables 1, 2, 6, 7, 9, 12, 15), hence `covers: []` and it still names `prd: picopilot` for context.

Scope: the TEXT `.p8` format only (not the binary PNG cart — that round-trip goes through shrinko8 in a later task). Handle the `__gfx__`/`__map__` hex sections as addressable byte data so the gfx codec (next task) and the overlap check can read/write specific sprite/map regions.

## Acceptance criteria

- [ ] Parse a real `.p8` into a typed section model; serialize back to a byte-identical file (round-trip = identity, asserted on real fixtures).
- [ ] Individual sections are independently readable/writable (e.g. replace `__gfx__` without disturbing `__lua__`).
- [ ] `__gfx__` and `__map__` are exposed as addressable byte/region data (so the gfx codec + the 0x1000 overlap check can target specific sprites/map rows).
- [ ] Malformed/partial carts fail with a clear structured error, not a crash.
- [ ] Tests cover round-trip identity on multiple fixtures + section-level edits, mirroring the repo's test style.

## Blocked by

- `cli-skeleton-and-verify-gate` — needs the package/engine layout and build+test tooling.

## Prompt

> Goal: build picopilot's `.p8` cart model and text I/O — the seam every cart-touching command reads/writes through. Parse the section-delimited `.p8` text format, expose a typed model, serialize back byte-identically.
>
> FIRST, drift-check: confirm `cli-skeleton-and-verify-gate` landed and the `engine/` layout exists; build on it, don't re-scaffold.
>
> Domain: a `.p8` is a text file of sections marked `__lua__`, `__gfx__` (spritesheet hex), `__gff__` (sprite flags), `__map__` (map hex), `__sfx__`, `__music__`, `__label__`. See `work/notes/findings/pico8-api-reference.md` for the section list + the memory map. `__gfx__` holds 256 8x8 sprites as per-pixel hex; sprites 128..255 (`0x1000`) alias `__map__` rows 32..63 (the overlap the next task's smart-refuse depends on) — so expose gfx/map as addressable regions, not opaque strings.
>
> Where to look: `engine/` (this is the cart-model home). The gfx codec, tokens/shrinko adapter, and init all build on THIS model, so design the read/modify/serialize API for their needs (section-level get/set; byte/region access to gfx and map).
>
> Seam to test at: round-trip identity (parse → serialize = same bytes) on real `.p8` fixtures, plus section-level edits that leave other sections untouched. Done = the model round-trips faithfully and later tasks can target specific sprites/map rows. Record any non-obvious format-handling decision (whitespace/newline normalisation, how you address the hex grid) in the done record.
