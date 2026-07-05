---
name: picopilot-audio
description: Compose PICO-8 sound as text with picopilot. The #1 reframe (no tempo, compose in TRACKER ROWS at one speed), the picopilot-MML grammar (waveform/volume/effect per note), structural music assembly from SFX references, the two loud refusals, and the compose to hear ears loop. Use when authoring __sfx__ / __music__.
---

# picopilot audio

SFX and music live in the cart as hex blobs you cannot read. picopilot lets you
compose sound as TEXT you can reason about, then transpiles it into `__sfx__` /
`__music__`. (See `picopilot-overview` for the `#include` discipline; never
hand-write the audio hex.) The exact byte layout + the full grammar/mapping
tables are the canonical reference in
`work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` (Part A =
layout, Part B = the picopilot-MML grammar + mapping). This skill carries what a
model gets WRONG, not the whole finding.

## Read this first: no tempo, compose in TRACKER ROWS (ADR-0008)

The one thing a model gets wrong: it reaches for sheet music. PICO-8 has NO
per-note duration and NO tempo/BPM. An SFX is a column of up to 32 tracker ROWS,
and ALL rows share ONE SFX `speed` (ticks/row, set with `s<N>`). So a
picopilot-MML length is a ROW COUNT, not a musical note value: `c4` = the note C
held for 4 ROWS (emitted as the note plus 3 tie rows), NOT a quarter note. There
is no tempo token; a tempo-style input is refused with a clear message, not
guessed at. Consequences you must design around:

- **No true sustain across rows.** A held note is RE-STRUCK each following row
  (PICO-8 has no cross-row sustain bit). For a smooth hold use effect `e1`
  (slide) or a low `s<N>` speed, not a long length. Do not expect a legato tie.
- **Dotted notes round to whole rows.** `c4.` = 6 rows; a fractional result
  rounds to the nearest whole row and the result WARNS. Rows are integers.
- **32-row hard cap.** A melody past 32 rows is refused (see below). Splitting it
  into several SFX arranged by a music pattern is a STRUCTURAL choice YOU make,
  not something the transpiler does silently.

## The ears loop: `sfx from-mml` -> `music from-patterns` -> `audio render`

This is the audio analogue of the `picopilot-art` render/look/set eyes loop:

1. `picopilot sfx from-mml <slot> "<mml>"`: compose one sound as text.
2. `picopilot music from-patterns "<json>"`: arrange SFX into a song.
3. `picopilot audio render`: RECORD a WAV and HEAR it, then iterate.

These steps are wired as CTAs (a merged SFX or song points you at `verify` then
`audio render`), so follow the suggested next command.

## `audio render` / `audio record`: get a WAV by RECORDING (ADR-0009)

PICO-8 has NO working offline WAV export (it SIGFPEs upstream), so picopilot gets
audio-to-WAV the only way that works: by RECORDING a running session
(`extcmd("audio_rec")`/`audio_end`). Two commands, both PICO-8-gated and both
REAL-TIME recordings that need a real audio+video session (a developer machine,
NOT headless CI), NOT deterministic offline exports:

- **`picopilot audio render`** injects a THROWAWAY play-harness for a chosen
  target and records it, so you write NO playback code. Pick the target with
  `--sfx <n>` (one SFX slot), `--pattern <p>` (one music pattern), or NEITHER
  (the whole song, `music 0`). The record window is derived from an `--sfx`
  target's speed+rows; override any target with `--seconds <n>`. An empty slot or
  out-of-range target is REFUSED loudly (nothing to render), never a silent
  recording of silence.
- **`picopilot audio record <cart>`** records the cart's OWN playback (it keeps
  the cart's code and appends a cooperative recorder); use it to capture a whole
  run's audio. `picopilot run --record-audio` does the same alongside a normal
  `run` (a WAV next to the screenshots).

The WAV goes to an isolated dir (`--wav-dir`, default a temp dir), never
`~/Desktop` or the carts root (the `audio_end(1)`-saves-to-the-current-folder
trap; picopilot steers it with PICO-8's `root_path`). PICO-8 absent -> a
structured `pico8-not-found` (remedy `set PICO8_PATH or install PICO-8`), never a
crash. On a headless machine the recording succeeds but captures NO audio
(`captured:false` + a nudge to run on a machine with a display + audio device):
that is honest, not a failure of the recipe.

## `sfx from-mml`: one MML string -> one SFX slot

`picopilot sfx from-mml <slot> "<mml>"` transpiles picopilot-MML into one
`__sfx__` slot (`0-63`) and merges it (only that slot changes; every other
section stays byte-identical). Cart is `--cart` (default `main.p8`); pass a
longer source with `--file` (give EITHER the argument OR `--file`).

Write notes AND their waveform/volume/effect in MML: that is exactly the
information PICO-8 needs and hand-written hex hides. This is why picopilot-MML,
not ABC: ABC is score-level and cannot name a per-note waveform, volume, or
effect, so an ABC-authored SFX is timbre-less ("blind audio in a nicer font").

### The picopilot-MML grammar in brief

Modal state (sticky until changed): `@<0-7>` waveform (`@8`-`@f` = SFX 0-7 as a
custom instrument), `v<0-7>` volume, `e<0-7>` effect (0 none, 1 slide, 2 vibrato,
3 drop, 4 fade in, 5 fade out, 6 arpeggio fast, 7 arpeggio slow), `o<0-5>` octave
(default `o2`), `l<N>` default length in rows, `>`/`<` octave shift. A bare note
(`c d e f g a b`, `+`/`#` sharp, `-` flat) emits one row in the current state.
`r<N>` = N silent rows; `^<N>` extends the previous note; `s<N>` = SFX speed
(default `s16`); `{`/`}` = loop markers (a LONE `{` marks the pattern LEN, the
finding's LEN special case). Whitespace + `|` bars are cosmetic. See finding
Part B for the full tables.

Note `e` is BOTH a note letter AND the effect prefix: `e0`-`e7` is the EFFECT; a
bare `e` is note E (hold it with `l4 e`, not `e4`). Effects have NO letter
mnemonics (the finding's `sl`/`vb`/... sugar did NOT ship: each collides with a
real note-plus-length sequence); use the numeric `e0`-`e7`.

Example: `picopilot sfx from-mml 0 "s8 @3 v6 e2 c e g > c"` is a square-wave
(`@3`) vibrato (`e2`) arpeggio at speed 8.

## `music from-patterns`: structural, NOT a notation

`__music__` holds NO melody: melody lives entirely in the referenced SFX. A song
is an ORDERED LIST of up-to-4 SFX-channel references per pattern.
`picopilot music from-patterns "<json>"` writes `__music__` (only `__music__`
changes; `__sfx__` and every other section stay byte-identical). So author each
voice as an SFX with `sfx from-mml`, THEN arrange the references here; you never
write music in a melodic notation. Cart is `--cart` (default `main.p8`); longer
songs via `--file`.

### The pattern-list JSON

An array of patterns, each
`{"channels":[c0,c1,c2,c3], "loopStart"?, "loopBack"?, "stop"?}`. Pattern order =
song order. A channel is an SFX index `0-63`, OR `null` = OFF (silent this
pattern). **`null` is NOT `sfx 0`**: `null` sets the channel's off bit; `0` is a
real, playing SFX. Keep them distinct. The 3 flow flags (optional, default
false): `loopStart`, `loopBack` (jump back to the loop-start pattern at this
pattern's end), `stop` (music stops after this pattern); they combine. A
`loopBack` with NO `loopStart` anywhere is allowed but WARNS (PICO-8 falls back
to pattern 0).

Example: `[{"channels":[0,1,null,3],"loopStart":true},{"channels":[0,1,null,3],"loopBack":true}]`
is a 2-pattern loop whose channel 2 is silent.

**Pattern length is INHERITED from the SFX, not stored here.** PICO-8 ends a
pattern when its LEFT-MOST non-looping channel's SFX finishes, so pattern timing
comes from the referenced SFX (its `speed` + LEN). To change how long a pattern
plays, change the referenced SFX, not the music.

## The two refusals: loud, never clamped

Both stop you with a structured error + nonzero exit (no bytes change on a
refusal) so a refusal is ACTIONABLE, not a dead end:

- **`audio-mml-pitch-out-of-range`** (`sfx from-mml`): a note fell below C0 or
  above D#5 (`0-63`). PICO-8 has no notes outside that range. Fix: TRANSPOSE, pick
  an octave (`o0`-`o5`) that keeps every note in range, rather than transposing
  off the keyboard.
- **`audio-mml-sfx-overflow`** (`sfx from-mml`): more than 32 rows. Fix: SPLIT the
  melody across multiple SFX slots yourself, then arrange them with
  `music from-patterns`.

Related: `music from-patterns` refuses an out-of-range SFX index with
`audio-music-sfx-out-of-range` (to silence a channel use `null`, not an
out-of-range number); a malformed JSON payload is `audio-music-parse-error`. And
`audio render`/`audio record` require PICO-8, so they return a structured
`pico8-not-found` (remedy `set PICO8_PATH or install PICO-8`) when absent, never
a crash. The text authoring + transpile steps need neither PICO-8 nor shrinko.
