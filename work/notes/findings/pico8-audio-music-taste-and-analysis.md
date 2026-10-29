---
title: What makes PICO-8 game music grating or pleasant, measured (the calibration behind `audio analyze`)
slug: pico8-audio-music-taste-and-analysis
source: 'The conquest dogfood (pico-8-games/conquest), 2026-10-28/29: the user listened to three agent-written soundtracks and judged them (first track "shrill, monotonous, grating"; a revision "far too violent", too loud; two accepted tracks). Measurements: the user measured all three with hand-rolled numpy WAV analysis during that session; on 2026-10-29 the first and the accepted tracks were re-rendered from conquest git history (f1c4871 = first track, 40f3b17 = accepted; the "violent" revision was never committed, so only the user numbers exist for it) with `picopilot audio render` on PICO-8 0.2.7 and re-measured with `picopilot audio analyze`, and its SFX were rendered for the music-vs-SFX check. Perceptual judgements are one listener''s, on one game; treat thresholds as calibrated defaults, not laws.'
---

# PICO-8 game music: what grates and what works, in numbers

A model that cannot hear needs numbers that track what a listener reports. These are the measurements of the conquest soundtracks, which a human judged, and the thresholds `picopilot audio analyze` derives from them. All figures are over the recording minus its first second, in 2048-sample frames at 22050 Hz: mean RMS of the frames, the median energy-weighted spectral centroid (DC excluded), the share of spectral energy above 2 kHz, the dynamic range as p90 minus p10 of the non-silent frames' level in dB, and the repetition length from spectral self-similarity.

## The three tracks

| track | judgement | mean RMS | centroid | > 2 kHz | dyn. range | loop |
|---|---|---|---|---|---|---|
| first track (f1c4871, title) | shrill, monotonous, grating | 0.156 | 1346 Hz (user: 1286) | 13.2 % | 1.7 dB (user: 1.9) | 14.9 s (user: ~15) |
| revision (uncommitted) | "far too violent", too loud | 0.195 | 612 Hz | 3.1 % | | |
| accepted title (40f3b17, pattern 0) | accepted | 0.096 (user: 0.097) | 473 Hz (user: 459) | 0.2 % | 7.0 dB | 34.0 s |
| accepted in-game (40f3b17, pattern 8) | accepted | 0.068 (user: 0.069) | 407 Hz (user: 378) | 0.4 % | 8.2 dB (user: 8) | 63.8 s (user: ~64) |

picopilot's centroid reads about 5 % above the user's because it leaves the inaudible DC bin out of the weighting (with DC included it reproduces 1289 Hz for the first track). A MAGNITUDE-weighted centroid is the wrong tool here: it read 3.6 kHz for the first track, because the long low-level tail of PICO-8's spectrum dominates it.

## What caused each verdict

- **Shrill:** the first track's lead and arpeggio sat at `o4` (pitch 48-59, 1.0-2.0 kHz fundamentals, see the layout finding A.8) on square and pulse waves, with 16th-note arpeggios at a constant volume. Hence 13 % of the energy above 2 kHz and a flat 1.7 dB of dynamics. It also looped every 15 s.
- **Violent:** the revision fixed the register but added a kick (triangle with the `e3` drop effect at `v6`), a noise snare, a saw bass and a flanged (`!detune1`) lead. Brightness was moderate (612 Hz, 3.1 %); loudness (0.195) and the percussive attacks were the problem.
- **Accepted:** lead around `o2`-`o3` (440-880 Hz), bass at `o1`, pads `o1`-`o2`; triangle (`@0`) for lead, bass and bells, a quiet dampened organ (`@5`) for the pad; `!dampen` on every voice; volumes mostly `v1`-`v2` with `v3` only on attacks, shaped per note (attack, sustain, release) instead of re-triggered fades; no drums; the title is 8 patterns with A/B sections, the in-game loop is 12 slow bars (~64 s) where the melody only plays in some bars; in-game music uses 3 channels (`music(n, fade, 7)`), leaving channel 3 to SFX.
- **Music under the SFX:** against conquest's own SFX (`audio render --sfx 2/7/8`, mean RMS of their non-silent frames 0.10-0.14), the accepted in-game music sits 3.4 to 6.4 dB below them; the first track sat 0.8 to 3.8 dB ABOVE them.

## The thresholds `audio analyze` uses

| warning | fires when | why there |
|---|---|---|
| loud | mean RMS > 0.12 | accepted 0.07-0.10; first track 0.156, violent 0.195 |
| shrill | centroid > 900 Hz or > 8 % above 2 kHz | first track 1.3 kHz / 13 % |
| bright (milder) | centroid > 550 Hz or > 2 % above 2 kHz | violent revision 612 Hz / 3.1 %; accepted < 500 Hz / 0.2-0.4 % |
| monotonous | dynamic range < 4 dB | first track 1.7-1.9 dB; accepted 7-8 dB |
| spikes | loudest frame > 3x the median frame | the accepted title peaks at 2.5x (unison notes summing), so 3x leaves it unflagged |
| near-clipping | 99.9th-percentile sample > 0.9 | headroom |
| repetitive | detected loop < 20 s | first track 15 s; accepted 34 s (title) and 64 s (in-game) |
| music-over-sfx (with `--against`) | music mean RMS > reference SFX non-silent RMS - 3 dB | accepted -3.4 to -6.4 dB; first track +0.8 to +3.8 dB |
| near-silent | mean RMS < 0.01 | nothing captured |

A loop is only detectable when the recording contains it at least twice, so render a long loop for more than twice its length (`music from-score` reports each song's `seconds`).
