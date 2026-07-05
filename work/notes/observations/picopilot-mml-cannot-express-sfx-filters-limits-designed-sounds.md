---
title: picopilot-MML cannot express PICO-8's 5 SFX filters, so "designed" sounds (explosion, pad, engine) are unreachable
slug: picopilot-mml-cannot-express-sfx-filters-limits-designed-sounds
spotted: 2026-07-05
---

# picopilot-MML cannot express the SFX filters, capping sound-design quality

Spotted while dogfooding the audio example (`packages/picopilot/examples/audio`, built + tuned by ear with a human listening). The "explosion" SFX could NOT be made to sound like an explosion, no matter how well the picopilot-MML was written. The root cause is a real expressiveness gap in the grammar, NOT composition skill, and it is worth recording because a human specifically asked "is this an MML->PICO-8 mapping problem or just our MML skills?"

## The evidence (why it is the tool, not the skill)

The boom was pushed to the CEILING of the current grammar: a steep descending pitch "crack" (`o3 g` down to `o0 c`) plus a hand-drawn volume DECAY envelope across rows (`v7 v7 v6 v5 v4 v3 v2 v1`) on the noise waveform `@6`. That is everything picopilot-MML can do. It still reads as "descending zap / machine-gun tail", not "explosion", because a real PICO-8 explosion needs the per-SFX FILTERS the grammar cannot name:

- **NOIZ** (pure white noise for instrument 6) - the texture; `@6` alone is the raw noise, not filtered.
- **DAMPEN** (low-pass at 2 levels) - the BODY/weight that makes noise a "boom" instead of a "hiss/rattle". THIS is the biggest missing piece for an explosion.
- **REVERB** (echo, 2 or 4 tick delay) - the resonant TAIL.
- **BUZZ**, **DETUNE-1/2** - buzzy/flange/overtone textures for other designed sounds.

Pitch and volume envelopes ARE expressible (per-row `vN` + note contour), so that part is skill/tedium. The filters are NOT expressible at all, so the whole class of "produced" sounds (explosion, pad, engine hum, thick lead) is out of reach. The pitch/wave/vol/effect mapping is CORRECT for what it covers (the hex round-trips perfectly); it just covers a strict SUBSET of PICO-8's SFX capability, and the filters are the missing ~30% between "notes with a waveform" and "designed sound effects".

## This was a KNOWN, deferred decision (now with a concrete use case)

The audio spike explicitly deferred filters: `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` A.6 / B.7 #7 ("Per-SFX filters ... NOT exposed in v2 picopilot-MML. Deferred; add as SFX-level directives later if needed. Flag if a v2 use case demands them.") and ADR-0005. This observation IS that flag: the demo is the v2 use case that demands them.

## Feasibility (a quick spike confirms filters are FINDABLE)

Poke-and-readback on PICO-8 v0.2.7 (same method as the original audio spike): poking the SFX header's first byte at `0x3200+64` changed the serialized `__sfx__` row header (it is NOT just a cosmetic "editor mode" byte, it carried the poked bits). So the filter switches live in the SFX header / metadata region and are reachable by the same empirical decode method that nailed the note layout. A proper spike would map each of the 5 filter bits to its exact header nibble/bit. So adding them is a BOUNDED task, not an open-ended risk.

## Recommendation

A v2 task (drafted as `work/tasks/ready/audio-mml-sfx-filters.md`): spike the filter byte layout, then extend picopilot-MML + `sfx from-mml` with SFX-level filter directives (e.g. `!noiz !dampen2 !reverb`, or a `--filter` flag), so an agent can author explosions/pads/engines. The music-repetitiveness in the same demo is a SEPARATE, smaller thing (composition skill + more turns + a third/drum voice), not a tool gap.
