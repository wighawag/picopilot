---
title: picopilot-audio skill, the MML authoring loop + tracker-rows framing
slug: audio-skill
prd: picopilot
blockedBy: [audio-sfx-from-mml, audio-music-from-patterns]
covers: [20]
---

## What to build

The `picopilot-audio` skill: the hard-won workflow knowledge for composing PICO-8 audio as text, loaded on-demand by the audio command group (US #20, incur `sync: { depth: 1 }`). It carries what a model gets WRONG without guidance, so the audio commands are usable without re-deriving the mapping each turn.

The single most load-bearing thing to teach (the finding's key reframe): **PICO-8 has NO per-note duration or tempo, you compose in TRACKER ROWS at one SFX speed, not sheet music.** A model will reach for `c4 = quarter note` and BPM; the skill must correct that up front (durations are row counts; `s<N>` sets ticks/row; there is no tempo). This is the ADR-0005 "reshape before committing the command surface" made into agent-facing guidance.

Content the skill teaches:

- **The picopilot-MML grammar in brief:** notes/octaves/accidentals, the modal attributes (`@` waveform 0..7 + `@8..@F` custom SFX-instrument, `v` volume 0..7, `e` effect 0..7 with the mnemonic shortcuts), rests (`r`), ties/holds (`^` and multi-row durations), `l` default length, `s<N>` speed, `{`/`}` loop markers (+ the single-`{` LEN case). Point at the finding's Part B tables as the canonical reference rather than duplicating them wholesale.
- **The tracker-rows-not-tempo reframe** and its consequences (no true cross-row sustain: use slide `e1` or low speed; dotted notes round to whole rows; 32-row hard cap -> split into multiple SFX + a music pattern, which is a STRUCTURAL choice the author makes).
- **The structural music model:** music is NOT notation, it is an ordered list of up-to-4 SFX references per pattern with loop/stop flags (`music from-patterns`). "Channel off" is not "sfx 0". Pattern timing is inherited from the referenced SFX.
- **The authoring loop:** `sfx from-mml` (compose a sound) -> `music from-patterns` (arrange) -> `audio render` (HEAR it, the ears loop) -> iterate. Mirror how `picopilot-art` frames the eyes loop.
- **Honest limits + the refusals:** out-of-range pitch (C0..D#5) and >32 rows are hard refusals with structured errors, teach the agent what they mean and how to fix (transpose / split), so a refusal is actionable, not a dead end.

## Acceptance criteria

- [ ] The `picopilot-audio` skill documents the picopilot-MML authoring loop and the structural music model, pointing at `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` Part B as the canonical mapping reference.
- [ ] It LEADS with the tracker-rows-not-tempo reframe (the #1 thing a model gets wrong) and the no-cross-row-sustain / 32-row-cap consequences.
- [ ] It explains the two structured refusals (pitch out-of-range, sfx overflow) and how to resolve them (transpose / split into SFX + pattern).
- [ ] It teaches the `sfx from-mml` -> `music from-patterns` -> `audio render` loop (the ears loop), mirroring the `picopilot-art` eyes-loop framing.
- [ ] Matches the existing skill file shape/length under `src/skills/` (token-conscious: carry what models get wrong, not the whole finding).

## Blocked by

- `audio-sfx-from-mml` and `audio-music-from-patterns`, the skill teaches the loop those commands provide (and references their actual surface/flags/refusal codes), so it lands AFTER them to avoid documenting a surface that then changes. `audio-render-wav` is a soft input (the ears step); if it has not landed, describe the loop and mark render as forthcoming.

## Prompt

> Goal: write the `picopilot-audio` skill so an agent composes PICO-8 audio as text correctly on the first try, carrying the hard-won reframe (tracker rows, not tempo) and the authoring loop, without bloating every turn.
>
> FIRST, drift-check: confirm `audio-sfx-from-mml` and `audio-music-from-patterns` landed and read their ACTUAL command surface + `## Decisions` (input surface, refusal codes, the pattern-list serialization, whether the effect mnemonics shipped), the skill must describe what was BUILT, not what this task guessed. Read `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` (the canonical mapping; point at it, don't duplicate the tables) and `docs/adr/0005-audio-mml-only-subset-spike-first.md` (the why).
>
> Domain: `CONTEXT.md` (picopilot-MML, structural music, the skill grouping). The existing skill stub is `src/skills/picopilot-audio/SKILL.md`, replace/extend it. Mirror the shape + length of a sibling skill (e.g. `picopilot-art/SKILL.md` for the eyes-loop framing this parallels; `picopilot-debug` for the recipe-teaching style).
>
> Where to look: `src/skills/picopilot-audio/SKILL.md` (the target); `src/skills/picopilot-art/` (the parallel eyes-loop skill to mirror); the two landed audio commands (their help text + Decisions) for the accurate surface; the finding Part B (the canonical mapping to reference).
>
> The load-bearing content: LEAD with "no tempo, compose in tracker rows at one speed" (the #1 model error), then the modal grammar in brief, the structural music model (off != sfx 0), the two refusals + how to resolve them, and the `sfx from-mml -> music from-patterns -> audio render` ears loop. Keep it token-conscious: what models get WRONG, not the whole finding.
>
> Done = an agent loading `picopilot-audio` composes a valid SFX + arranges a pattern + renders to hear it, without reaching for tempo or hand-writing hex. Record any framing choice in a `## Decisions` note if non-obvious.
