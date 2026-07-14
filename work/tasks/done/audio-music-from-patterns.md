---
title: music from-patterns, structural pattern list to __music__ (shrinko-free TS codec)
slug: audio-music-from-patterns
spec: picopilot
blockedBy: [audio-sfx-from-mml]
covers: [12]
---

## What to build

The music half of the v2 audio path: `picopilot music from-patterns`, which assembles an ordered list of up-to-4 SFX-channel references per pattern into `__music__` and merges it into a cart. Confirmed by ADR-0005 and the spike: music is authored STRUCTURALLY (a pattern list), NOT from a notation. There is no melodic content in `__music__` at all; the melody lives entirely in the referenced SFX (built by `sfx from-mml`).

The exact layout is closed in `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md`: Part A.5 gives the `__music__` text row (`FF CCCCCCCC` = a 2-hex flag byte + 4 channel bytes; flag bits loop-start=0x01 / loop-back=0x02 / stop=0x04, combinable; each channel byte = sfx 0..63, bit6=0x40 = channel-off) and Part B.6 gives the structural authoring model to implement.

End-to-end vertical (schema -> codec -> command -> cart merge -> tests):

- **`engine/audio` extension:** a pattern-list -> `__music__` emitter. Input model (Part B.6): an ordered list of patterns, each `{ channels: [ch0..ch3], loopStart?, loopBack?, stop? }` where a channel is an SFX index 0..63 OR "off" (null). CRITICAL: "off" and "sfx 0" are DIFFERENT (off sets bit6; index 0 is a real, playing SFX), the model MUST distinguish them. Pattern order = song order. Emit the text rows directly (hoist the 3 flow flags into the leading flag byte per A.5; set bit6 on off channels).
- **`picopilot music from-patterns` command:** take the pattern list (concrete serialization, JSON/TOON/flags, is this task's call; the finding leaves it open as a command-surface decision), transpile, and merge into the cart via `engine/cart` `getSection`/`setSection` (byte-identical; only `__music__` changes). Shrinko-FREE and PICO-8-FREE. CTA toward `verify` / `audio render`.
- **Validation:** reject sfx index out of 0..63; a `loopBack` with no `loopStart` anywhere MAY warn (PICO-8 falls back to pattern 0, document, don't hard-fail). Pattern timing is inherited from the referenced SFX (left-most non-looping channel), so the music model stores no per-pattern length, note this in help so authors understand it.

## Acceptance criteria

- [ ] Known pattern lists produce known `__music__` hex, asserted BYTE-FOR-BYTE against the finding's Part A.5 (cover: a plain pattern, each flow flag alone, combined flags e.g. loop-start+stop=0x05, an off channel = bit6 set, and off-vs-sfx-0 distinctness).
- [ ] `music from-patterns` merges into the cart via `engine/cart` and leaves every OTHER section (incl. `__sfx__`) byte-identical.
- [ ] Out-of-range sfx index is a structured refusal + nonzero exit; `loopBack`-without-`loopStart` warns (documented behaviour), not a crash.
- [ ] The codec + command are shrinko-FREE and PICO-8-FREE.
- [ ] Tests mirror the `audio-sfx-from-mml` / `engine/gfx` codec test style; write nothing outside temp fixtures.

## Blocked by

- `audio-sfx-from-mml`, same `engine/audio` module and the same cart-merge seam; serialized on that module to avoid conflicts, and to reuse its established codec/command shape and error conventions.

## Prompt

> Goal: build the pattern-list -> `__music__` codec and the `picopilot music from-patterns` command, implementing the CLOSED structural model from the spike. No notation, this is "list of 4-channel patterns with flags -> hex".
>
> FIRST, read `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` Part A.5 (the `__music__` row layout, VERIFIED byte-for-byte on PICO-8 v0.2.7: flag byte loop-start=1/loop-back=2/stop=4 combinable; channel byte = sfx 0..63 with bit6=off) and Part B.6 (the structural authoring model + the off-vs-sfx-0 distinction + inherited pattern timing). Also `docs/adr/0005-...` (music-is-structural is the confirmed decision).
>
> Drift-check: covers prd US #12 (the `music from-patterns` half). Confirm `audio-sfx-from-mml` landed (this extends the SAME `engine/audio` module and reuses its cart-merge + error conventions). If it did NOT land, this is blocked, do not build the shared module twice.
>
> Domain: `CONTEXT.md` (structural music model, cart sections). The load-bearing subtlety: "channel off" (bit6) is NOT "sfx 0"; the model must keep them distinct. Pattern length is inherited from the referenced SFX (left-most non-looping channel), so store no per-pattern length, say so in help.
>
> Where to look: `engine/audio` (extend it, next to the sfx emitter); `engine/cart` (`getSection`/`setSection`); the sibling `sfx from-mml` command for the input-surface + error-envelope + CTA pattern to mirror. Decide the pattern-list serialization (JSON/TOON/flags), the finding intentionally left this open as a command-surface call.
>
> Seam to test at: table-driven codec tests (known list -> known `__music__` hex, every flag + off-channel + off-vs-sfx-0) + the cart-merge-leaves-other-sections-untouched assertion + the out-of-range refusal. Pure TS. Done = an agent can assemble a song structurally and get correct `__music__` merged into its cart.
>
> RECORD non-obvious decisions in a `## Decisions` block (the serialization choice is the big one; also any refusal code/exit, and the loopBack-without-loopStart warning wording). ADR only if something clears the bar (`ADR-FORMAT.md`), the structural model itself is already ADR-0005, so most choices here are note-level.
