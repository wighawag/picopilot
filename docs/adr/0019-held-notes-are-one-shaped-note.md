# A held picopilot-MML note is ONE shaped note: per-row effects land once, volume is stepped across its rows

A picopilot-MML length (`c4`, `l4 c`, `c ^3`) now means one note HELD for N tracker rows, not N copies of a one-row note. PICO-8 plays consecutive rows of the same pitch and waveform as one continuous tone, so the transpiler shapes a held note by stepping its VOLUME across those rows and placing the one-row effects once: fade in (`e4`) on the first row, fade out (`e5`) on the last row over a linear volume ramp, drop (`e3`) on the first row with the rest of the note silent; vibrato, slide and arpeggio continue on every row. Two new modal tokens shape held notes directly: `v[...]` (a per-note volume envelope) and `~N` (delayed vibrato). A modal change between a note and its `^` tie is refused (`audio-mml-tie-state-change`). This amends ADR-0008, which said a held note is "re-struck" each row.

## Context

The conquest dogfood's first soundtrack stuttered: `l4 e5 c` emitted four rows that each carried `e5`, so PICO-8 faded the note out four times (four plucks, not one decaying note), and `e3`/`e4` re-triggered every row the same way. Fixing it took a 250-line Python script that wrote every row by hand with an explicit volume envelope (`conquest/tools/audio.py`). Verified on PICO-8 0.2.7 (2026-10-29, `audio render` + per-row RMS): six one-row `e5` notes drop to RMS ~0.02 at every row end (the stutter); the new held `e5 c6` decays in steps 0.20, 0.20, 0.16, 0.12, 0.08, 0.004; six plain same-pitch rows hold a constant level across row boundaries (no re-attack).

## Decisions

- **Per-row effects on a held note.** `e4` fade in: first row only (the attack), the other rows hold at the note's volume. `e5` fade out: the volume ramps `ceil(v * (1 - k/N))` across the N rows (never silent before the end) and the last row carries `e5`, fading the final step to 0. `e3` drop: first row only; the remaining rows are rests, because a drop ends far below the pitch and re-sounding the pitch would be a second, un-dropped note (a held kick is a hit followed by silence, as in any tracker). `e1` slide: every row; between equal pitches it is a no-op, and it smooths volume steps. `e2` vibrato: every row; it is continuous, and stopping it on tie rows would make a held note go dead. `e6`/`e7` arpeggio: every row; an arpeggio is defined over the 4-row group a row sits in, so tie rows must keep it for the group to keep its meaning.
- **`v[...]` volume envelope.** One digit 0-7 per row, spaces optional, the last value held for longer notes: `v[3 3 2 2 2 1 1 0] a8`. An optional tail after `/` is a release placed on each note's last rows when the note is longer than the tail: `v[3 2 2/1 0]`. Modal like every other setter (`v<N>` clears it). With an envelope, `e5` still fades only the last row. `[` after `v` was a parse error before, so no previously valid MML changes meaning.
- **`~N` delayed vibrato.** From row N of each held note, rows that carry no other effect get `e2`; `~0` turns it off. Delayed vibrato on long lead notes was what made the accepted conquest lead sound good. `~` was an unexpected token before.
- **One-row notes are untouched.** `e5 c c c c` still emits four `e5` rows, so the old repeated-pluck sound stays reachable by writing separate notes.
- **Refused: a modal change between a note and its `^` tie** (`c4 v3 ^4`, `c4 e5 ^2`, `c2 @3 ^2`). The tie used to copy the original note and silently ignore the change; under "one held note, one shape" the change has no meaning, so it is a structured `audio-mml-tie-state-change` pointing at `v[...]`. Octave and default-length changes stay allowed (a tie keeps its pitch, and `^` reads the length).

## Considered Options

- **Tie rows drop every effect to `e0` (rejected).** Fixes the stutter for fades, but a held fade-out then holds at full volume and cuts off at the last row's fade: it is not a decay. And it would kill vibrato on held notes.
- **Hold, then fade on the last row only (rejected as the default).** A sustain-then-release shape. It stays reachable with a flat envelope plus `e5` (`v[5] e5 c8`), but the musical meaning of a faded held note is a note that decays over its length, which is what the one-row `e5` does over its row.
- **Letter syntaxes for the envelope (`env3322`, `ve...`) or a postfix per-note form (`c8[3322]`) (rejected).** Letters collide with note sequences (ADR-0008's mnemonic lesson); a postfix bracket would make whitespace significant. `v[...]` extends the existing volume setter with a token that was a parse error.
- **Warn on every held `e3`/`e4`/`e5` that its meaning changed (rejected).** A warning that fires on correct, recommended usage gets ignored. The change is announced by this ADR and the changeset; the refusal covers the only genuinely ambiguous construct.

## Consequences

- Re-transpiling existing MML that held a fade or drop changes its sound (the intended fix). A song that relied on the per-row re-trigger must write separate notes.
- `music from-score` (ADR-0020) applies the same shaping to notes that cross a pattern boundary: the ramp continues into the next SFX.
