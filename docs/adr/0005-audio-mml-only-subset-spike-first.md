# Audio authoring is MML-only (a documented picopilot-MML subset), de-risked with a design-artifact spike first

The v2 audio path authors sound in MML only — a small, DOCUMENTED picopilot-MML subset tuned to PICO-8's exact capabilities (8 waveforms, 8 effects, 4 channels, the SFX speed/note-length encoding). `__music__` is assembled structurally (an ordered list of up-to-4 SFX references per pattern), not from a notation. The MML→SFX mapping — the only true greenfield/algorithmic component — is de-risked BEFORE feature work by a spike whose output is durable design: a `work/notes/findings/` doc of the PICO-8 sfx/music memory layout plus the subset spec (grammar + the exact construct→waveform/effect/channel mapping). The v2 audio feature tasks block on that spike.

## Considered Options

- **ABC notation (rejected from the authoring path).** ABC is score-level and cannot express PICO-8's per-note waveform/volume/effect, so an ABC-authored SFX is timbre-less ("blind audio in a nicer font").
- **Chain `mml2abc` then ABC→SFX (rejected).** Chaining through ABC would discard exactly the waveform/effect information MML carries.
- **Target an existing MML dialect (rejected).** There are many dialects and none is a 1:1 fit for PICO-8; a documented subset avoids claiming a compatibility we would fail to fully implement.
- **A throwaway feasibility spike (rejected in favour of a design-artifact spike).** Parsing text was never the risk; the mapping decisions are, so the spike must CLOSE them in a durable spec the feature tasks implement against.

## Consequences

This ADR records a decision for work NOT yet tasked (v2). If the spike finds the mapping nastier than assumed, reshape before committing the v2 command surface.
