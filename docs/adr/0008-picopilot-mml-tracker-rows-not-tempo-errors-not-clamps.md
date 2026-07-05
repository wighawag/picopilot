# picopilot-MML durations are tracker ROWS (no tempo), and un-representable input ERRORS rather than clamps

The `sfx from-mml` command surface presents picopilot-MML authoring as "tracker rows at one SFX speed", NOT tempo-based sheet music, and refuses un-representable input loudly instead of clamping it. This makes concrete the two candidate ADRs the audio spike flagged (finding B.4/B.7 #1 and B.2/B.4) and honours ADR-0005's "reshape the command surface before committing" clause. It is the load-bearing framing every later audio task and skill inherits.

## Context

PICO-8 has NO per-note duration and NO tempo: every note in an SFX occupies exactly one tracker ROW, and all rows share one SFX-level `speed` (ticks/row). This is the opposite of MML's usual model, where `c4` is a quarter note resolved against a BPM. The audio spike (`work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md`, verified byte-for-byte against PICO-8 v0.2.7) closed the mapping; this ADR records the two user-visible decisions that mapping forces onto the command.

## Decisions

- **Durations are ROW COUNTS, not musical note values; there is no tempo/BPM token.** A picopilot-MML length `N` means N tracker rows (`c4` = the note held for 4 rows, emitted as the note plus 3 tie rows that re-strike it), NOT 1/N of a bar. Speed is the SFX `speed` field (`s<N>`, ticks/row), the only timing PICO-8 exposes. A tempo-style token (e.g. `t120`) is a parse error whose message reframes toward tracker rows. The command description and help lead with this so an author never reaches for sheet-music timing. (There is also no true cross-row sustain: a held note re-emits the same row; smoothness comes only from a low speed or the slide effect.)

- **Out-of-range pitch and >32 rows ERROR (structured), never silent clamp.** A note below C0 or above D#5 (0..63) raises `audio-mml-pitch-out-of-range` naming the offending token and the range; accumulated rows over 32 raise `audio-mml-sfx-overflow` reporting the count and the cap. Both surface as incur's `error({code,...})` envelope with a nonzero exit, mirroring the gfx/map smart-refuse stance (ADR-0004): a silent clamp produces wrong-sounding music the author cannot see, so picopilot refuses loudly and tells the author how to author within the hardware. Splitting a >32-row melody across SFX is a STRUCTURAL choice the author makes explicitly, not something the transpiler does silently.

## Considered options

- **Offer a tempo/BPM sugar that computes a speed (rejected for v1 audio).** Stating a BPM would be a lie: PICO-8 measures in ticks (~1/120s), not beats, and the mapping is lossy. Deferred as an explicitly-lossy convenience only if authors ask (finding residual question).
- **Silently clamp out-of-range pitch / auto-split >32 rows (rejected).** Both hide a real hardware limit and produce output the author did not intend and cannot see. Auto-split would additionally be hard to reverse (it decides SFX slot allocation for the author); the safe default is to error and let the author split.
- **Ship the finding's optional two-letter effect mnemonics `sl vb dr fi fo a4 a8` (rejected; canonical `e0..e7` only).** Every mnemonic collides with a note-letter sequence in this tracker-row grammar (`a4`/`a8` = note A + length; `dr` = note D + rest; `sl` shares its head with the `s` speed directive), so shipping them would silently re-mean genuine note sequences. The canonical numeric `e0..e7` is unambiguous, covers all 8 effects, and is the form the finding REQUIRES; the mnemonics were only a SHOULD.
