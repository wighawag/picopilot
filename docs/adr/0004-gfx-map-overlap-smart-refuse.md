# `gfx set` smart-refuses writes that would silently clobber overlapping map data

Sprites 128-255 (`__gfx__` `0x1000`-`0x1fff`) alias the shared map region (the map's rows 32-63). `picopilot gfx set` on a 128-255 sprite inspects whether the TARGET SPRITE'S CURRENT `__gfx__` shared-bank bytes are non-zero (i.e. the shared region already holds data): if they are all-zero OR the loss is authorised (`--allow-map-overlap` flag OR `allowMapOverlap` in `picopilot.json`), the write proceeds (noting the aliasing); if they are non-zero and nothing authorised the loss, `gfx set` REFUSES with a structured `map-overlap` result + nonzero exit, leaving the sprite's bytes unchanged. The single invariant: picopilot never SILENTLY overwrites existing shared-region data that nothing authorised.

## The row-space correction (why the check is on `__gfx__`, not `__map__`)

The overlapping bytes live in the `0x1000` gfx bank, NOT in the text-format `.p8` `__map__` section. A `.p8`'s `__map__` stores only map rows 0-31; the shared rows 32-63 are stored in the `__gfx__` upper bank. So there is no `__map__` text to inspect for the overlapping rows — "the data at risk" IS the sprite's own current `__gfx__` shared-bank pixels. (The first `gfx-grid-codec-show-set` build caught the original framing's false premise: it said inspect the `__map__` region, but `mapRowsForSprite(n)` returns rows 32-63 while `MapData` only holds rows 0-31, so composed the check could never fire. This ADR was corrected to inspect the `__gfx__` shared bytes directly.)

## Considered Options

- **Warn-and-succeed (rejected).** An agent treats exit-0 as done and ignores warnings, so a warn-then-write silently destroys map data — the exact failure this prevents.
- **Blanket-refuse all 128-255 writes (rejected).** Annoys the legitimate carts that use the upper sprite bank as pure sprite space with no map data at risk.

## Consequences

The overlap policy is agent-writable in `picopilot.json` (a rarely/once-set project setting the agent may set to match a human-in-the-loop instruction like "our map is tiny, let sprites use the overlap"). Safety does not rest on who writes the config; it rests on the smart-refuse, which only ever stops in the genuine data-loss corner (non-zero shared-bank bytes about to be overwritten, unauthorised).
