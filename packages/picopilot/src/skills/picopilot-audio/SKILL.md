---
name: picopilot-audio
description: Compose PICO-8 sound as text with picopilot. The picopilot-MML authoring model (waveform/volume/effect per note), structural music assembly from SFX references, and why ABC is not used. Note the audio commands are v2 and land later; this skill carries the workflow so you compose correctly when they do. Use when authoring __sfx__ / __music__.
---

# picopilot audio

SFX and music live in the cart as hex blobs. picopilot lets you compose sound as
text you can reason about, then transpiles it into `__sfx__` / `__music__`.
(See `picopilot-overview` for the `#include` discipline; never hand-write the
audio hex sections.)

> Scope note: `sfx from-mml` (picopilot-MML to `__sfx__`) and
> `music from-patterns` (the structural pattern-list to `__music__`) have both
> LANDED. `audio render` is still v2 and lands later. This skill carries the
> authoring MODEL for all of them; if a command below is not yet available, that
> is expected, and the model it describes is the DECIDED one.

## Author in picopilot-MML (not ABC)

picopilot-MML is a small, documented MML (Music Macro Language) subset tuned to
PICO-8's exact audio: 8 waveforms, 8 effects, 4 channels, and the SFX
speed/note-length encoding. It is the ONLY authored notation.

ABC is deliberately NOT used: ABC is score-level and cannot name a per-note
waveform, volume, or effect, so an ABC-authored SFX would be timbre-less ("blind
audio in a nicer font"). Because picopilot-MML can express waveform/volume/effect
per note, compose in it directly rather than reaching for a score notation.

## SFX: `sfx from-mml`

`picopilot sfx from-mml <slot> "<mml>"` transpiles compact picopilot-MML text
into one `__sfx__` slot (0-63) and merges it into the cart (only that slot
changes; every other section stays byte-identical). Write the notes AND their
waveform/volume/effect in MML; that is exactly the information PICO-8 needs and
hand-written hex hides. The cart is the `--cart` option (default `main.p8`); pass
a longer source with `--file`.

### Author in TRACKER ROWS, not tempo (the key reframe, ADR-0008)

PICO-8 has NO per-note duration and NO tempo/BPM. Every note is one tracker ROW,
and all rows share one SFX `speed` (ticks/row, set with `s<N>`). So a
picopilot-MML length is a ROW COUNT, not a musical note value: `c4` = the note C
held for 4 ROWS (emitted as the note plus 3 tie rows), NOT a quarter note. Do not
reach for sheet-music timing; there is no tempo token, and a tempo-style input is
rejected with a clear message. An SFX holds at most 32 rows.

### The picopilot-MML tokens

Modal state (sticky until changed): `@<0-7>` waveform (`@8-@f` = SFX 0-7 as a
custom instrument), `v<0-7>` volume, `e<0-7>` effect (0 none, 1 slide, 2 vibrato,
3 drop, 4 fade in, 5 fade out, 6 arpeggio fast, 7 arpeggio slow), `o<0-5>`
octave (default `o2`), `l<N>` default length in rows, `>`/`<` octave shift. A
bare note (`c d e f g a b`, `+`/`#` sharp, `-` flat) emits one row in the current
state. `r<N>` = N silent rows; `^<N>` extends the previous note. `s<N>` = SFX
speed; `{`/`}` = loop markers (a lone `{` marks the pattern LEN).

Note `e` is BOTH a note letter and the effect prefix: `e0`-`e7` is the EFFECT; a
bare `e` is note E (hold it with `l4 e`). Effects have no letter mnemonics; use
the numeric `e0`-`e7`.

### Refused loudly, never clamped

A pitch below C0 or above D#5 (0-63) is refused (`audio-mml-pitch-out-of-range`,
nonzero exit) rather than silently clamped; more than 32 rows is refused
(`audio-mml-sfx-overflow`). Split a long melody across SFX slots yourself, then
arrange them with `music from-patterns`. A merged SFX CTAs toward `verify` (still
parses + in budget) and `audio render` (hear it).

## Music: `music from-patterns` (structural, not a notation)

`__music__` is assembled STRUCTURALLY, not from a notation: `picopilot music
from-patterns "<json>"` takes an ordered list of up-to-4 SFX-channel references
per pattern and writes `__music__` (only `__music__` changes; every other
section, including `__sfx__`, stays byte-identical). So author each voice as an
SFX in MML, then arrange those SFX references into patterns; you do not write
music in a melodic notation. The cart is the `--cart` option (default
`main.p8`); pass a longer song with `--file`.

### The pattern-list serialization (JSON)

The pattern list is JSON: an array of patterns, each
`{"channels":[c0,c1,c2,c3], "loopStart"?, "loopBack"?, "stop"?}`. Pattern order
= song order. A channel is an SFX index `0-63` OR `null` = OFF (silent this
pattern). `null` is NOT `sfx 0`: `null` sets the channel's bit6 (a silent
channel); `0` is a real, playing SFX. Keep them distinct.

The 3 pattern-flow flags (all optional, default false): `loopStart` (a
`music`-loop-back searches back to the nearest of these, or pattern 0),
`loopBack` (at this pattern's end, jump back to the loop-start pattern), `stop`
(music stops after this pattern). They combine (e.g. loopStart + stop). A
`loopBack` with NO `loopStart` anywhere is allowed but WARNS: PICO-8 falls back
to pattern 0.

Example: `[{"channels":[0,1,null,3],"loopStart":true},{"channels":[0,1,null,3],"loopBack":true}]`
is a 2-pattern loop whose channel 2 is silent.

### Pattern length is INHERITED from the SFX, not stored here

There is NO per-pattern length in the music model. PICO-8 ends a pattern when its
LEFT-MOST non-looping channel's SFX finishes, so pattern timing is inherited
from the referenced SFX (its `speed` + LEN, set with `sfx from-mml` / the `{`
LEN marker). To change how long a pattern plays, change the referenced SFX, not
the music. An out-of-range SFX index (outside 0-63) is refused
(`audio-music-sfx-out-of-range`, nonzero exit), never clamped. A merged song
CTAs toward `verify` and `audio render`.

## Hear it: `audio render`

`picopilot audio render` exports a WAV so the result can be heard and iterated on.
`audio render` requires PICO-8 (a licensed binary); absent it, it returns a
structured `pico8-not-found` result with a remedy, never a crash or hang. The
text authoring and transpile steps do not need PICO-8.
