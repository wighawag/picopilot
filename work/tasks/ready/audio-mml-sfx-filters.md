---
title: picopilot-MML SFX filters, expose NOIZ/BUZZ/DETUNE/REVERB/DAMPEN so designed sounds (explosion, pad, engine) are reachable
slug: audio-mml-sfx-filters
prd: picopilot
blockedBy: [audio-sfx-from-mml]
covers: [12]
---

## What to build

Close the expressiveness gap the audio dogfood surfaced (`work/notes/observations/picopilot-mml-cannot-express-sfx-filters-limits-designed-sounds.md`): picopilot-MML currently cannot express PICO-8's 5 per-SFX FILTER switches (NOIZ, BUZZ, DETUNE-1, DETUNE-2, REVERB, DAMPEN), so a whole class of "designed" sounds (explosion, pad, engine hum, thick lead) is unreachable no matter how good the MML. The pitch/wave/vol/effect mapping is correct but covers only a SUBSET of PICO-8's SFX capability; the filters are the missing piece. This was a KNOWN deferral (finding A.6 / B.7 #7, ADR-0005: "add as SFX-level directives later if needed. Flag if a v2 use case demands them.") and the demo is now that use case.

This has a SPIKE-FIRST rung, because the exact filter byte layout is not yet fully decoded (the original audio spike deliberately scoped filters out).

- **Spike (do first, extend the finding):** decode WHERE each of the 5 filter switches lives in the `__sfx__` text row / `0x3200` RAM, byte-for-byte, by poke-and-readback on the local PICO-8 (same method as `pico8-audio-sfx-music-layout-and-mml-subset.md`). A quick probe already showed the SFX header's first byte (`0x3200+64`, the "editor mode" byte in the current finding) carries more than mode: poking it changed the serialized row header. So the filters are SFX-level (in the header/metadata region), findable, and each maps to a specific nibble/bit + level (DAMPEN and REVERB have 2 levels each per the manual). Record the exact layout as an ADDENDUM to the existing audio finding (or a new finding), verified against PICO-8 v0.2.7.
- **Grammar + codec:** add SFX-level filter directives to picopilot-MML (they are per-SFX, like `s<N>` speed, NOT per-note). Pick a syntax that does not collide with the tracker-row note grammar (the mnemonic-collision trap from ADR-0008): e.g. a `!`-prefixed directive `!noiz !dampen2 !reverb` (DAMPEN/REVERB take a level), OR a `--filter noiz,dampen=2,reverb` command flag, OR both. Emit the filter bits into the correct header byte(s) per the spike; every other section + the note rows stay byte-identical.
- **Command:** wire the filter surface into `sfx from-mml` (extend `engine/audio` + the command). Shrinko-FREE, PICO-8-FREE (pure text transpile). Update the `picopilot-audio` skill + the audio example (make the explosion a real explosion with `!dampen !reverb`).

## Acceptance criteria

- [ ] The spike decodes each of the 5 filters' exact bit/nibble location + levels (DAMPEN/REVERB 2 levels) in the `__sfx__` row, recorded as a cited finding addendum, verified byte-for-byte on PICO-8 v0.2.7 (poke a known filter state, read the row back).
- [ ] picopilot-MML expresses all 5 filters (+ levels) via SFX-level directives whose syntax does NOT collide with the note grammar; known inputs produce known `__sfx__` header bytes, asserted byte-for-byte against the spike.
- [ ] `sfx from-mml` merges the filter bits into the target slot leaving every other section + the note rows byte-identical.
- [ ] An out-of-range filter level is a structured refusal (mirror the existing audio refusals), not a silent clamp.
- [ ] The codec + command are shrinko-FREE and PICO-8-FREE; tests mirror the existing `engine/audio` table-driven style; nothing written outside temp fixtures.
- [ ] The `picopilot-audio` skill documents the filters + when to use them (DAMPEN for body, REVERB for tail, NOIZ for noise texture); the audio example's explosion is re-authored with filters (and the tutorial notes the before/after).

## Blocked by

- `audio-sfx-from-mml`, extends the SAME `engine/audio` codec + `sfx from-mml` command and its `__sfx__` emission; serialise on that module. The note layout it relies on is already in `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md`.

## Prompt

> Goal: make DESIGNED sounds (explosion, pad, engine hum) reachable in picopilot-MML by exposing PICO-8's 5 per-SFX filters, which the grammar currently cannot express. The dogfood proof this is a TOOL gap (not composition skill): even a maxed-out boom (steep pitch crack + hand-drawn volume decay envelope on `@6` noise) still reads as a machine-gun rattle, because "boom body" = DAMPEN and "tail" = REVERB, which no pitch/volume MML can synthesize.
>
> FIRST read: `work/notes/observations/picopilot-mml-cannot-express-sfx-filters-limits-designed-sounds.md` (the gap + the feasibility probe), `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` (A.6 = filters are SFX-level, out of the note bytes, DEFERRED; A.1 = the SFX header the filters live near; the poke-and-readback method), and `docs/adr/0005-...` (filters were a conscious deferral). The PICO-8 manual (`~/.AppImages/pico-8/pico-8_manual.txt` "Filters" section) lists the 5 switches + that DAMPEN/REVERB have 2 levels and NOIZ applies only to instrument 6.
>
> SPIKE FIRST: the exact filter byte layout is NOT yet decoded. Use the SAME empirical method that nailed the note layout: author a cart, poke a KNOWN filter state into the `0x3200` SFX header region (a quick probe showed `0x3200+64` carries more than "editor mode"), `cstore` + `save()`, read the `__sfx__` row back, and decode which bit/nibble each filter (and its level) sets. Record it as a cited addendum to the audio finding, verified on PICO-8 v0.2.7. Do NOT guess the layout from the manual; the manual documents the switches but not their bytes.
>
> CRITICAL PICO-8 CLI FOOTGUN (this task's PREDECESSOR RUN HUNG on exactly this): NEVER invoke `pico8 --help`, `pico8 --version`, or bare `pico8` to inspect flags or check the binary. PICO-8 is a GUI app with no headless diagnostic mode: those calls LAUNCH THE INTERACTIVE APP and BLOCK your tool call forever (verified: `timeout 5 pico8 --help` exits 124, zero output). The ONLY safe, non-blocking invocations are `pico8 -x <cart>` / `pico8 -run <cart>` / `pico8 <cart> -export ...`, ALWAYS with `</dev/null` and a `timeout --signal=KILL <secs>` wrapper. For the spike's save-and-readback, run headless `env -u DISPLAY pico8 -x <gen.p8> </dev/null` with a `stop()`/sentinel and a timeout (see `work/notes/findings/pico8-gotchas.md` section 0 and `pico8-run-and-screenshot.md`). To learn a CLI flag, read `~/.AppImages/pico-8/pico-8_manual.txt`, never ask the binary.
>
> Drift-check: covers prd US #12 (extends the SFX authoring surface). Confirm `audio-sfx-from-mml` landed and extend its `engine/audio` codec + `sfx from-mml` command; reuse its error-envelope + test conventions. Honour ADR-0008's mnemonic-collision lesson when picking filter syntax (do not shadow note letters / directives).
>
> Seam to test at: table-driven codec tests (known filter directive -> known `__sfx__` header bytes, per the spike) + the byte-identical merge (note rows + other sections untouched) + a level-out-of-range refusal. Pure TS. Done = an agent can author an explosion with `!dampen !reverb` (or the chosen syntax) and it sounds like one; the audio example's boom is re-authored to prove it.
>
> RECORD non-obvious decisions in a `## Decisions` block (the filter syntax chosen + why it avoids collisions, the header-byte layout found, level encoding, refusal codes). The filter byte layout is a genuine new finding; if any syntax/encoding choice clears the ADR bar (`ADR-FORMAT.md`), write it up.

## Requeue 2026-07-05

Predecessor run hung on the pico8 --help CLI footgun (now warned in the task prompt + pico8-gotchas + picopilot-debug skill). No branch was produced; re-drive fresh.
