---
title: sfx from-mml, picopilot-MML to __sfx__ transpiler (shrinko-free TS codec)
slug: audio-sfx-from-mml
spec: picopilot
blockedBy: []
covers: [12]
---

## What to build

The greenfield core of the v2 audio path: `engine/audio`, a shrinko-FREE TS codec that transpiles compact **picopilot-MML** text into one `__sfx__` row, plus the `picopilot sfx from-mml` command that merges it into a cart. This is "audio-as-text" for the SFX half: the agent composes a sound in a form that can EXPRESS PICO-8's per-note waveform/volume/effect (which ABC structurally cannot), instead of hand-writing hex.

The mapping is NOT open-ended: it is fully specified in `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` (the ADR-0005 design-artifact spike, byte-layout VERIFIED against PICO-8 v0.2.7). Implement THAT spec. The finding's Part A gives the exact `__sfx__` text row (168 chars = 8-char header + 32 notes x 5 nibbles, note = `PP W V E`); Part B gives the picopilot-MML grammar and the exact token to field mapping table.

End-to-end vertical (schema -> codec -> command -> cart merge -> tests):

- **`engine/audio` codec (new module, the seam):** a picopilot-MML parser + `__sfx__` emitter. Emit the TEXT nibbles directly (Part A.3: the text format is the friendly surface; do NOT reproduce the scattered RAM bit-packing). Implement the modal state model (`@` waveform, `v` volume, `e` effect, `o`/`l` octave + default length), pitch = `12*oct + semitone`, C0=0, default `o2`, the effect table (`e0..e7` canonical + the optional mnemonics), and durations-as-TRACKER-ROWS via tie rows (NOT musical fractions / tempo). SFX-level controls: `s<N>` speed, `{`/`}` loop markers (including the single-`{` = LEN special case).
- **Structured refusals (not silent clamps):** out-of-range pitch (below C0 / above D#5=63) -> structured `audio-mml-pitch-out-of-range` naming the offending token + the C0..D#5 range; accumulated rows > 32 -> `audio-mml-sfx-overflow` reporting the row count + the 32 cap. Use incur's `error({code,message,retryable,cta})` envelope + nonzero exit (mirror the existing shrinko/pico8 boundary shape).
- **`picopilot sfx from-mml` command:** parse MML (from an arg/stdin/file, match how existing commands take input), transpile to the `__sfx__` row for a target SFX slot (0..63), and merge into the cart via `engine/cart` `getSection`/`setSection` (byte-identical round-trip; only the target SFX row changes). Shrinko-FREE and PICO-8-FREE (pure text). Wire a CTA toward `verify` and/or the music/render step.

## Acceptance criteria

- [ ] Known picopilot-MML inputs produce known `__sfx__` hex, asserted BYTE-FOR-BYTE against the finding's Part A/B tables (a table-driven test over the mapping: pitch, all 8 waveforms + a custom-instrument `@8..@F`, volume 0..7, all 8 effects, rests, ties/multi-row notes, speed, loop markers + the LEN special case).
- [ ] Un-representable / out-of-range MML has the DEFINED behaviour, tested: out-of-range pitch -> `audio-mml-pitch-out-of-range` structured + nonzero exit; >32 rows -> `audio-mml-sfx-overflow` structured + nonzero exit. No silent clamp.
- [ ] `sfx from-mml` merges into the cart via `engine/cart` and leaves every OTHER section byte-identical (assert the untouched sections, mirroring the cart round-trip discipline).
- [ ] The codec + command are shrinko-FREE and PICO-8-FREE (no adapter calls; work with both absent).
- [ ] Tests mirror the existing `engine/gfx` codec + command test style (table-driven, seam-level, deterministic).
- [ ] Writes nothing outside its own temp fixtures (pure text transform into a cart file the test owns).

## Blocked by

- None, the spike that de-risked this LANDED as `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md`. `engine/audio` is a fresh module (declared as a future seam in `engine/index.ts`); `engine/cart` `getSection`/`setSection` already exists as the merge seam.

## Prompt

> Goal: build `engine/audio` (the picopilot-MML -> `__sfx__` transpiler) and the `picopilot sfx from-mml` command, implementing the CLOSED spec from the spike. This is the one true greenfield/algorithmic component; the mapping is already decided, so this is "implement the documented table", not open-ended design.
>
> FIRST, read the binding spec, it is the LIVE-VERIFIED source of truth and every field/bit was confirmed byte-for-byte against PICO-8 v0.2.7:
> - `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md`, Part A (the `__sfx__` text row: 8-char header `mode/speed/loopstart/loopend` incl. the `loop_end==0` LEN case; note = 5 nibbles `PP W V E`, waveform nibble 0..15 with 8..15 = custom SFX-instrument) and Part B (the picopilot-MML grammar B.1, pitch/octave B.2, effect mapping B.3, durations-as-rows B.4, SFX speed/loop B.5, and the full mismatch decisions B.7).
> - `docs/adr/0005-audio-mml-only-subset-spike-first.md`, WHY MML-only, why ABC is rejected, and the "reshape before committing the command surface" clause.
>
> Drift-check: this task covers prd US #12 (the `sfx from-mml` half). Confirm `engine/cart` exposes `getSection`/`setSection` (the merge seam) and that `engine/audio` does NOT yet exist (create it; mirror the `engine/gfx` codec shape: a pure module + an index re-export, no adapter). If the finding and the prd disagree on any point, the finding (verified, later) wins, route to needs-attention only if something is genuinely contradictory.
>
> Domain: `CONTEXT.md` glossary (picopilot-MML, cart sections, the structured-failure envelope). The KEY reframe to honour and surface in the command's help text: PICO-8 has NO per-note duration or tempo, durations are TRACKER ROWS at one SFX speed (finding B.4/B.7 #1). Do not present tempo/BPM; reject tempo-style inputs with a clear message. This is the ADR's "reshape the command surface" point made concrete.
>
> Where to look: `engine/gfx` (the codec + command pattern to mirror); `engine/cart` (`getSection`/`setSection`, byte-identical round-trip); `src/commands/gfx.ts` (how a command registers, takes input, emits a structured result + CTA); incur `error({code,...})` for the two refusals.
>
> Seam to test at: table-driven codec tests (known MML -> known `__sfx__` hex, every field per the finding's tables) + the two structured refusals + the cart-merge-leaves-other-sections-untouched assertion. Pure TS, no shrinko/PICO-8. Done = an agent can write a picopilot-MML string and get a correct `__sfx__` merged into its cart, with out-of-range / overflow refused loudly.
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block on completion (e.g. input surface arg-vs-stdin-vs-file, the exact refusal codes/exit, how rounding of dotted-note rows is reported, whether the mnemonic effect shortcuts ship). If any meets the ADR bar (the finding already flags two CANDIDATE ADRs: "durations are tracker rows, no tempo" and "out-of-range/overflow errors rather than clamp") write the durable WHY as an ADR in `docs/adr/` (`work/protocol/ADR-FORMAT.md`).
