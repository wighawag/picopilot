---
"picopilot": minor
---

Held notes no longer stutter. In picopilot-MML a note longer than one row (`c4`, `l4 c`, `c ^3`) is now ONE note: fade in (`e4`) lands on its first row, fade out (`e5`) becomes a volume ramp that ends on its last row, and drop (`e3`) is a one-row hit followed by silence, instead of every row re-triggering the effect (`l4 e5 c` used to fade out four times). Vibrato, slide and arpeggio still continue on every row, and separate one-row notes (`e5 c c c c`) still re-trigger. Two new tokens shape held notes: `v[...]` is a per-note volume envelope (one digit per row, the last held, an optional release after `/`, e.g. `v[3 2 2 2 1/1 0] a12`) and `~N` starts vibrato from a held note's row N. A volume, effect, waveform, envelope or vibrato change between a note and its `^` tie, which used to be silently ignored, is now refused as `audio-mml-tie-state-change`. Re-transpiling existing MML that held a fade or drop changes its sound (ADR-0019).
