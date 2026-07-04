---
name: picopilot-audio
description: Compose PICO-8 sound as text with picopilot. The picopilot-MML authoring model (waveform/volume/effect per note), structural music assembly from SFX references, and why ABC is not used. Note the audio commands are v2 and land later; this skill carries the workflow so you compose correctly when they do. Use when authoring __sfx__ / __music__.
---

# picopilot audio

SFX and music live in the cart as hex blobs. picopilot lets you compose sound as
text you can reason about, then transpiles it into `__sfx__` / `__music__`.
(See `picopilot-overview` for the `#include` discipline; never hand-write the
audio hex sections.)

> Scope note: the audio COMMANDS (`sfx from-mml`, `music from-patterns`,
> `audio render`) are v2 and land after the audio design spike. This skill ships
> now with the authoring MODEL so that, when those commands arrive, you already
> know the discipline. If a command below is not yet available, that is expected;
> the model it describes is the DECIDED one.

## Author in picopilot-MML (not ABC)

picopilot-MML is a small, documented MML (Music Macro Language) subset tuned to
PICO-8's exact audio: 8 waveforms, 8 effects, 4 channels, and the SFX
speed/note-length encoding. It is the ONLY authored notation.

ABC is deliberately NOT used: ABC is score-level and cannot name a per-note
waveform, volume, or effect, so an ABC-authored SFX would be timbre-less ("blind
audio in a nicer font"). Because picopilot-MML can express waveform/volume/effect
per note, compose in it directly rather than reaching for a score notation.

## SFX: `sfx from-mml`

`picopilot sfx from-mml` transpiles compact picopilot-MML text into `__sfx__` and
merges it into the cart. Write the notes AND their waveform/volume/effect in MML;
that is exactly the information PICO-8 needs and hand-written hex hides.

## Music: `music from-patterns` (structural, not a notation)

`__music__` is assembled STRUCTURALLY, not from a notation: `music from-patterns`
takes an ordered list of up-to-4 SFX-channel references per pattern and writes
`__music__`. So author each voice as an SFX in MML, then arrange those SFX
references into patterns; you do not write music in a melodic notation.

## Hear it: `audio render`

`picopilot audio render` exports a WAV so the result can be heard and iterated on.
`audio render` requires PICO-8 (a licensed binary); absent it, it returns a
structured `pico8-not-found` result with a remedy, never a crash or hang. The
text authoring and transpile steps do not need PICO-8.
