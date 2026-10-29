---
name: picopilot-audio
description: Compose PICO-8 sound and music as text with picopilot, and judge it without ears. Covers tracker-row picopilot-MML (held notes, volume envelopes, the 5 SFX filters), whole songs with `music from-score`, the render then analyze loop, and the taste rules that keep game music soft, varied and under the SFX. Use when authoring __sfx__ / __music__.
---

# picopilot audio

You cannot hear, so you compose sound as TEXT (picopilot-MML), let picopilot write `__sfx__` / `__music__`, and judge the result with NUMBERS from `audio analyze`. Never hand-write the audio hex. The byte layout and full grammar live in `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md`; the measurements behind the taste rules in `work/notes/findings/pico8-audio-music-taste-and-analysis.md`.

## The loop: compose, render, analyze, iterate

1. **Compose.** Game SFX: `picopilot sfx from-mml <slot> "<mml>"` (one sound, up to 32 rows). Music: `picopilot music from-score --file score.json --slots 16-63` (whole songs, any length).
2. **Render.** `picopilot audio render --pattern <startPattern> --seconds <n> --analyze`. Record more than twice the song's `seconds` (from-score reports it, and its next-step hint does this) so the loop length is measurable. `--sfx <slot> --analyze` analyzes a one-shot with only the checks that apply to it (near-silent, near-clipping).
3. **Analyze.** Read `analysis.warnings` and the numbers. Check music against an SFX with `picopilot audio analyze music.wav --against sfx.wav`.
4. **Iterate** until the music analysis has no warnings and the score follows the taste rules below. A clean analysis is the done bar; "it compiled" is not.

## Tracker rows, not sheet music (ADR-0008)

PICO-8 has no tempo and no per-note duration. An SFX is up to 32 ROWS at one `speed` (`s<N>` ticks per row, 1/120 s each). A length is a ROW COUNT: `c4` is C held for 4 rows. A tempo token is refused.

**A held note is ONE note (ADR-0019).** PICO-8 plays consecutive same-pitch rows as one continuous tone, so picopilot shapes a held note across its rows: fade in (`e4`) on its first row, fade out (`e5`) as a volume ramp ending on its last row, drop (`e3`) as a one-row hit then silence; vibrato, slide and arpeggio continue. Separate one-row notes (`e5 c c c c`) still re-trigger, which is how you write repeated plucks. Shape held notes with:

- **`v[...]` volume envelope**, one digit per row, last value held, the part after `/` is the release on each note's last rows: `v[3 2 2 2 1/1 0] a12`. Modal; `v<N>` clears it.
- **`~N` delayed vibrato**: rows from N on get vibrato, so a long note starts plain and blooms: `~6`. `~0` turns it off.

The `e` trap: `e0`-`e7` is an EFFECT, so note E with a length is `l8 e`, never `e8` (refused) or `e4` (silently effect 4).

## Taste: what makes game music pleasant (measured)

These rules come from a soundtrack a listener called shrill and grating, a revision called "far too violent", and the accepted versions (the taste finding has the numbers).

- **Register.** Lead at `o3` or below (`o2 a` is 440 Hz), bass around `o1`, pads `o1`-`o2`. A lead and arpeggio at `o4` on square/pulse is what made the first track shrill.
- **Timbre.** Soft: triangle `@0` and a quiet dampened organ `@5`. Harsh at volume: square `@3`, pulse `@4`, saw `@2`. Put `!dampen` on music voices. Noise drums and drop-kicks (`e3`) read as aggressive at default volumes; leave drums out of ambient music, or keep them at `v1`-`v2`.
- **Density.** Rests are music. Write held notes with envelopes and gaps, not wall-to-wall 16th-note arpeggios at one volume.
- **Form.** Title and in-game are DIFFERENT songs. In-game loops run about a minute, with sections (A/B), and a melody that plays only in some bars (a silent channel in a pattern costs nothing: it becomes OFF).
- **Volume headroom.** Music mostly `v1`-`v2`, `v3` only on attacks; SFX `v4`-`v7` sit on top.
- **Leave a channel for SFX.** Write music on channels 0-2 and play it with a mask: `music(n, fade, 7)` (channels 0-2), so `sfx()` always has channel 3.

The analyzer's thresholds, for reading its output: mean RMS above 0.12 is loud (accepted music 0.07-0.10); centroid above 900 Hz or more than 8 % of energy above 2 kHz is shrill (accepted: under 500 Hz, about 0.2 %); dynamic range under 4 dB is monotonous (accepted 7-8 dB); a loop under 20 s is repetitive; with `--against`, music should sit at least 3 dB under the SFX.

## `music from-score`: whole songs (ADR-0020)

The score is JSON: songs, each up to 4 channels of picopilot-MML of ANY length.

```json
{"songs": [
  {"name": "title", "speed": 16, "channels": [
    {"filters": "!dampen", "mml": "@0 ~6 v[3 2 2 2 1/1 0] o2 a12 > d4 f8 l8 e | d16 c8 < a+8"},
    {"filters": "!dampen", "mml": "@0 v[2 2 2 1 1 1/0] o1 d16 a16 | < a+16 > f16"},
    null]},
  {"name": "game", "speed": 20, "loopFrom": 0, "channels": ["...", "...", "..."]}
]}
```

picopilot cuts every channel at the same 32-row boundaries (`patternRows` for other bar lengths), turns a channel silent for a whole pattern into OFF, shares identical SFX, writes `__sfx__` + `__music__`, and reports each song's `startPattern` (play it with `music(startPattern, 0, 7)`), its `seconds`, and which slot holds what. Per song: `speed` (shared by its channels), `loop` (default true; false stops at the end), `loopFrom`. `|` bars are cosmetic: use them to check every channel's bars add up to the same rows.

Slots: pass `--slots 16-63` (a range the music OWNS: overwritten and cleared on every run, so re-runs are clean). Without it, only empty slots are used, from 63 down, and nothing with notes is touched. `picopilot sfx clear <slots>` empties slots (`5`, `16-63`, `3,5,9`).

`music from-patterns '<json>'` still exists for arranging hand-made SFX: a list of `{"channels":[c0,c1,c2,c3], loopStart?, loopBack?, stop?}` where a channel is an SFX index or `null` (OFF, which is different from SFX 0). Music is structural either way: melody lives in SFX, `__music__` only references them.

## `sfx from-mml`: one sound

Modal (sticky) state: `@0`-`@7` waveform (0 triangle, 1 tilted saw, 2 saw, 3 square, 4 pulse, 5 organ, 6 noise, 7 phaser; `@8`-`@f` = SFX 0-7 as an instrument), `v0`-`v7` or `v[...]`, `e0`-`e7` effect (1 slide, 2 vibrato, 3 drop, 4 fade in, 5 fade out, 6/7 arpeggio fast/slow), `~N`, `o0`-`o5` octave (default `o2`), `l<N>` default length, `>`/`<` octave shift. Notes `c d e f g a b` with `+`/`#`/`-`; `r<N>` rest; `^<N>` extends the previous note; `s<N>` speed; `{`/`}` loop (a lone `{` sets the LEN). picopilot-MML, not ABC, because ABC cannot name a per-note waveform, volume or effect.

**Filters make DESIGNED sounds** (per SFX, anywhere in the string): `!dampen`/`!dampen2` low-pass body, `!reverb` echo tail, `!noiz` (only on `@6`), `!buzz`, `!detune1` (flange) / `!detune2` (octave). An explosion is `!dampen2 !reverb @6` over a falling pitch and volume: `s6 !dampen2 !reverb @6 o3 v7 g o1 c o0 g v6 e v5 c v4 g v3 c v2 g v1 c`.

## `audio render` / `record` / `analyze`

PICO-8 has no working offline export of audio, so `render` and `record` are REAL-TIME recordings of a PICO-8 session (ADR-0009), not an offline export. They work headless (picopilot starts a virtual display when there is none) and require PICO-8. `render` plays a target you pick (`--sfx`, `--pattern`, or the whole song); `record <cart>` captures the cart's own playback. `--seconds` sets the window and the safety backstop follows it. The WAV goes to an isolated temp dir (`--wav-dir`). When `captured` is false, read `noAudioReason` and `pico8LogTail`, then run `picopilot verify`.

`audio analyze <wav>` needs neither PICO-8 nor Python. It skips the first second (as the calibration did; `--skip 0` for an SFX, plus `--kind sfx`) and reports loudness (mean, loudest frame and when), brightness (centroid, share above 2 kHz), dynamic range, a per-half-second loudness `sparkline`, the loop length, and `warnings` with the fix for each.

## Refusals (no bytes change)

- `audio-mml-pitch-out-of-range`: a note outside C0..D#5. Pick an octave in range (in a score, the message names song and channel; watch accumulated `<`/`>`).
- `audio-mml-sfx-overflow`: over 32 rows in `sfx from-mml`. Use `music from-score`.
- `audio-mml-tie-state-change`: a `v`/`e`/`@`/`~`/`v[...]` between a note and its `^`. Use an envelope or a new note.
- `audio-mml-filter-level-out-of-range`: `!dampen3`, `!reverb2`, `!noiz2`, `!detune` without 1/2.
- `audio-score-*`: speed mismatch between channels, `{`/`}` in a score, over 64 patterns, not enough free slots (pass `--slots`).
- `audio-backstop-too-small`: an explicit `--backstop-ms` that cannot fit the window. Omit it.
