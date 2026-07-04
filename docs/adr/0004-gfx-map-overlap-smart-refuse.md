# `gfx set` smart-refuses writes that would silently clobber overlapping map data

Sprites 128-255 (`__gfx__` `0x1000`-`0x1fff`) alias `__map__` rows 32-63. `picopilot gfx set` on a 128-255 sprite inspects the overlapping `__map__` region: if it is empty/all-zero OR the loss is authorised (`--allow-map-overlap` flag OR `allowMapOverlap` in `picopilot.json`), the write proceeds (noting the aliasing); if it contains real tiles and nothing authorised the loss, `gfx set` REFUSES with a structured `map-overlap` result + nonzero exit, leaving `__map__` byte-unchanged. The single invariant: picopilot never SILENTLY overwrites existing map tiles that nothing authorised.

## Considered Options

- **Warn-and-succeed (rejected).** An agent treats exit-0 as done and ignores warnings, so a warn-then-write silently destroys map data — the exact failure this prevents.
- **Blanket-refuse all 128-255 writes (rejected).** Annoys the legitimate carts that use the upper sprite bank as pure sprite space with no map data at risk.

## Consequences

The overlap policy is agent-writable in `picopilot.json` (a rarely/once-set project setting the agent may set to match a human-in-the-loop instruction like "our map is tiny, let sprites use the overlap"). Safety does not rest on who writes the config; it rests on the smart-refuse, which only ever stops in the genuine data-loss corner.
