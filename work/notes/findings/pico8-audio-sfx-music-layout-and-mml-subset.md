---
title: PICO-8 sfx/music layout + the picopilot-MML subset spec (the MML→SFX mapping, closed)
slug: pico8-audio-sfx-music-layout-and-mml-subset
source: 'SPIKE (ADR-0005, design-artifact). Part A byte layout VERIFIED EMPIRICALLY against PICO-8 v0.2.7 (AppImage ~/.AppImages/pico-8/pico8) on Linux, 2026-07-05: throwaway carts poked KNOWN bytes into 0x3200 (sfx) / 0x3100 (music) RAM, cstore + save() regenerated the .p8 text sections, and each __sfx__/__music__ hex row was decoded byte-for-byte (single-field probes to isolate every nibble/bit). Cross-checked against the Lexaloffle PICO-8 manual (~/.AppImages/pico-8/pico-8_manual.txt: SFX Editor / Music Editor / Memory sections, and the SFX()/MUSIC() API). Part B (picopilot-MML grammar + mapping) is a picopilot DESIGN DECISION set built ON those verified facts; every choice is stated with rationale. Temp carts were written under ~/.lexaloffle/pico-8/carts and deleted; no product code touched.'
---

# PICO-8 sfx/music layout + the picopilot-MML subset (spike output, decisions CLOSED)

This is the durable output of the ADR-0005 audio spike. It has two parts. **Part A** is verified PICO-8 ground truth (the exact text-format + RAM byte layout of `__sfx__`/`__music__`). **Part B** is the picopilot-MML subset spec: grammar + the exact token→`__sfx__`-field mapping table + the structural `__music__` authoring model + every non-1:1 mismatch with a decision made. A v2 implementer should be able to write the transpiler from this doc without re-opening these questions.

Ground truth already captured in `pico8-api-reference.md` and NOT re-derived here: 4 channels, 64 SFX slots, `__sfx__` at `0x3200`, `__music__`/song at `0x3100`, and the `sfx(n,[channel,[offset]])` / `music([n,[fade,[mask]]])` playback calls. This finding nails down the **LAYOUT** and the **MAPPING**.

---

## PART A: PICO-8 sfx/music memory + text-format layout (verified)

### A.1 `__sfx__` text row: one SFX = one line of 168 hex chars

Empirically confirmed: each SFX serializes to **one text row of exactly 168 hex characters** = an **8-char header** + **32 notes × 5 hex chars**. There are 64 rows (SFX 0..63). Trailing all-zero SFX rows are trimmed by PICO-8 on save.

```
row = HHHHHHHH  n0n0n0n0n0 n1... (32 notes, 5 hex chars each, no separators)
      \_8 hex_/ \__ 160 hex chars = 32 notes × 5 ___________________________/
```

**Header (first 8 hex chars = 4 bytes), left to right:**

| bytes (hex chars) | field        | range | meaning |
|---|---|---|---|
| `[0:2]` | editor mode  | 0/1   | 0 = pitch mode, 1 = tracker mode (cosmetic; does not affect playback) |
| `[2:4]` | **speed (SPD)** | 1..255 | ticks per note. 1 = fastest, 3 = 3× slower, etc. |
| `[4:6]` | **loop start** | 0..63 | note index to loop back TO |
| `[6:8]` | **loop end**   | 0..63 | note index to loop back FROM |

Looping is OFF when `loop_start >= loop_end` (manual). Special case (manual, load-bearing for music timing): if `loop_end == 0` and `loop_start > 0`, `loop_start` is reinterpreted as a **LEN** (note count / pattern length), not a loop point. This is how sub-32-row patterns (e.g. 3/4 time) are authored.

VERIFIED: poking header bytes `00 10 02 05` produced header `00100205`; poking `00 01 00 00` produced `00010000`.

### A.2 `__sfx__` note: 5 hex nibbles = `PP W V E`

Each note is **5 hex nibbles** `[N0 N1 N2 N3 N4]`, read left to right:

| nibbles | field     | range | notes |
|---|---|---|---|
| `N0 N1` | **pitch**     | `0x00`..`0x3f` (0..63) | linear chromatic semitone index, `0 = C0`, `60 = C5`. (Manual: "frequency C0..C5".) Full byte, only 0..63 valid. |
| `N2`    | **waveform / instrument** | 0..15 | **0..7 = the 8 built-in waveforms**; **8..15 = "custom instrument" = SFX 0..7 used as an instrument** (bit 3 = the custom-instrument flag). |
| `N3`    | **volume**    | 0..7 | 0 = silent (also how a note is "deleted"/rest). |
| `N4`    | **effect**    | 0..7 | see effect table A.4. |

VERIFIED with semantic single-field probes (RAM packing → text):
- pitch 24 (`0x18`) → `18000`; pitch 63 → leading `3f`.
- waveform 7 → `00700`; waveform 12 (custom SFX-instr 4) → `00d00`.
- volume 7 → `00070`; effect 7 → `00007`.
- combined `pitch32,wave5,vol3,eff2` → `20532`; `pitch63,wave1,vol6,eff4` → `3f164`.

**The 8 built-in waveforms (waveform nibble 0..7)** (manual, SFX editor instrument list order):

| # | waveform |
|---|---|
| 0 | triangle |
| 1 | tilted saw |
| 2 | saw |
| 3 | square |
| 4 | pulse |
| 5 | organ |
| 6 | noise |
| 7 | phaser |

(Manual note: NOIZ filter applies only to instrument 6; BUZZ + instrument 6 with NOIZ off = brown noise. Filters are per-SFX switches, see A.6, and they are NOT in the per-note bytes.)

### A.3 RAM ↔ text cross-check (0x3200)

The RAM store at `0x3200` is **2 bytes per note** (byte0 `b0`, byte1 `b1`); the text nibbles are a re-serialization, NOT a raw hex dump of those 2 bytes. Verified bit sourcing:

- **pitch** = `b0` bits 0..5 → text `N0 N1` (low 6 bits; `b0` bit6/bit7 belong to waveform, see below).
- **waveform nibble N2** (4 bits) is assembled from: `b0.bit6 → 1`, `b0.bit7 → 2`, `b1.bit0 → 4`, `b1.bit7 → 8`. (I.e. waveform low 2 bits sit in the top of byte0, the 3rd bit in `b1.bit0`, and the custom-instrument flag in `b1.bit7`.)
- **volume N3** and **effect N4** occupy `b1` bits 1..3 and 4..6 respectively.

Per-note RAM byte layout (bit → field), derived from the isolated-bit probes:

```
byte0 (b0):  bit7 bit6 | bit5..bit0
             \__wave__/   \_pitch_/     (wave low 2 bits, pitch 6 bits)
byte1 (b1):  bit7  | bit6 bit5 bit4 | bit3 bit2 bit1 | bit0
             wave3   \___effect___/   \__volume____/   wave2
             (custom-instr flag)                        (waveform 3rd bit)
```

The **text format is the friendlier surface** and is what a transpiler should EMIT: writing the `__sfx__` line directly avoids reproducing this bit-scatter. picopilot should generate `PP W V E` nibbles, not poke RAM.

Header in RAM lives at `0x3200 + 64*sfx + 64` .. `+67` (i.e. after the 64 note bytes): `+64` editor mode, `+65` speed, `+66` loop start, `+67` loop end. VERIFIED (poked at `0x3200+64..67`, appeared as the 4 header bytes).

### A.4 Effects (effect nibble 0..7)

Manual, verbatim semantics:

| # | effect | behaviour |
|---|---|---|
| 0 | none | |
| 1 | slide | slide to the next note's pitch and volume |
| 2 | vibrato | rapidly vary pitch within a quarter-tone |
| 3 | drop | rapidly drop frequency to very low values |
| 4 | fade in | ramp volume up from 0 |
| 5 | fade out | ramp volume down to 0 |
| 6 | arpeggio fast | iterate over the group of 4 notes at speed 4 |
| 7 | arpeggio slow | iterate over the group of 4 notes at speed 8 |

Manual caveat to carry into the spec: **if SFX speed <= 8, the arpeggio speeds halve to 2 and 4.** (Relevant if picopilot ever validates arpeggio timing.)

### A.5 `__music__` text row: one pattern = `FF CCCCCCCC`

Empirically confirmed: each pattern serializes to **`<flagbyte> <space> <4 channel bytes>`** = `FF CCCCCCCC` (2 hex flag + space + 8 hex = 4 channel bytes). Patterns are listed top to bottom = song order (pattern 0 first). Trailing empty patterns are trimmed on save.

**Flag byte (leading 2 hex chars):** a bitmask of the 3 pattern flow flags:

| bit | value | flag | meaning |
|---|---|---|---|
| 0 | `0x01` | **loop start** | a `music` loop-back searches back to the nearest pattern with this flag (or pattern 0). |
| 1 | `0x02` | **loop back** | at end of this pattern, jump back to the loop-start pattern. |
| 2 | `0x04` | **stop** | music stops after this pattern. |

VERIFIED: loop-start → flag `01`; loop-back → `02`; stop → `04`; loop-start + stop combined → `05`.

**Each channel byte (4 of them, ch0..ch3):**

| bits | field | meaning |
|---|---|---|
| 0..5 | **SFX index** | 0..63, which SFX plays on that channel this pattern. |
| bit6 `0x40` | **channel off** | this channel is silent for this pattern (byte stays e.g. `0x41` = off + sfx 1). VERIFIED: `0x40|17` → text channel byte `51`. |
| bit7 `0x80` | (RAM only) | in RAM this is where the 3 flow flags live (bit7 of ch0/ch1/ch2 = loop-start/loop-back/stop). In the TEXT format they are hoisted into the leading flag byte, and the channel bytes show only bits 0..6. |

So the text channel bytes are `00..3f` for an active channel, `40..7f` for an "off" channel (bit6 set). A future implementer emitting text should: put flow flags in the leading flag byte, and set bit6 (`+0x40`) on any channel it wants silent.

### A.6 Things NOT in the note bytes (scope boundary)

- **Per-SFX filter switches** (NOIZ, BUZZ, DETUNE-1, DETUNE-2, REVERB, DAMPEN) are SFX-level, not per-note, and live in a separate metadata region, not in the 5-nibble note. **DECISION (v2 scope):** picopilot-MML v2 does NOT expose filters (see B.7). If needed later, add as SFX-level directives.
- **Custom waveform instruments** (drawing a 64-byte looping waveform into SFX 0..7) are authored by content in SFX 0..7 themselves; a note merely REFERENCES them via waveform nibble 8..15. picopilot-MML expresses the reference (`@0..@7`), not the drawing.

---

## PART B: the picopilot-MML subset spec (decisions this spike exists to CLOSE)

picopilot-MML is a small MML dialect **defined by picopilot** (not a compatibility claim with any existing dialect; ADR-0005 rejected targeting one). Its entire reason to exist over ABC: it can express PICO-8's per-note **waveform, volume, and effect**, which score notations cannot. One picopilot-MML string transpiles to **exactly one SFX** (one `__sfx__` row of up to 32 notes). Music is assembled structurally from SFX references (B.6), NOT written in MML.

### B.1 Grammar (EBNF-ish)

```
sfx        := ( directive | token )*
directive  := speed | loop                          # SFX-level, see B.5
token      := note | rest | tie | set-wave | set-vol | set-oct | set-eff | set-len
              | octave-up | octave-down

note       := note-letter [ accidental ] [ length ] [ dots ]
note-letter:= "c" | "d" | "e" | "f" | "g" | "a" | "b"   # case-insensitive
accidental := "+" | "#" | "-"                        # sharp (+/#), flat (-)
length     := integer                                # 1,2,4,8,16,32 : whole..1/32 (see B.4)
dots       := "."+                                   # dotted note (×1.5, ×1.75, ...)

rest       := "r" [ length ] [ dots ]
tie        := "^" [ length ] [ dots ]                # extend previous note (B.4)

set-oct    := "o" integer                            # absolute octave 0..5
octave-up  := ">"                                     # +1 octave
octave-down:= "<"                                     # -1 octave
set-wave   := "@" hexdigit                            # waveform 0..7, or 8..F = custom SFX-instr
set-vol    := "v" digit                               # volume 0..7
set-eff    := ( "e" digit ) | fx-shortcut            # effect 0..7 (see B.3)
set-len    := "l" integer [ dots ]                    # default note length (persists)

fx-shortcut:= "~" | "@@" ... (see B.3, chosen glyphs)
```

State model: `@` (waveform), `v` (volume), `e` (effect), `o`/`l` (octave, default length) are **sticky/modal**: they set the CURRENT value applied to every subsequent note until changed. This is standard MML behaviour and maps naturally to how a tracker fills columns. A bare note emits one PICO-8 note using the current modal state.

### B.2 Pitch / octave mapping (DECISION)

PICO-8 pitch is a **linear chromatic index 0..63, C0 = 0**. picopilot-MML octaves map directly:

- octave `o0`..`o4` fully available; `o5` reachable up to `D#5` (pitch 63). Default octave = **`o2`** (pitch 24 = C2 = the PICO-8 SFX-instrument reference pitch; a sensible mid-range default).
- pitch = `12 * octave + semitone(note-letter, accidental)`, with `c=0,d=2,e=4,f=5,g=7,a=9,b=11`; `+`/`#` = +1, `-` = −1.
- **Mismatch + DECISION:** PICO-8 has no notes above pitch 63 (D#5) or below C0. If MML requests an out-of-range pitch (e.g. `o5 g`), the transpiler must **error with a structured, actionable message** (`audio-mml-pitch-out-of-range`, naming the offending token and the C0..D#5 range) rather than silently clamp. Rationale: silent clamping produces wrong-sounding music the author can't see; PICO-8's ceiling is a hard fact the author should be told about, matching picopilot's smart-refuse philosophy (cf. gfx/map overlap).
- `#`/`+` at the top of the range that would exceed 63 is the same error.

### B.3 Effect mapping (DECISION: the "which letter means which effect" call)

MML has no native concept of PICO-8's effects, so picopilot DEFINES the tokens. Chosen mapping (**numeric `e0..e7` is the canonical, unambiguous form**); readable shortcuts are sugar that expand to the same:

| MML token | expands to | PICO-8 effect | # |
|---|---|---|---|
| `e0` | (none) | none | 0 |
| `e1` / `sl` | slide | slide | 1 |
| `e2` / `vb` | vibrato | vibrato | 2 |
| `e3` / `dr` | drop | drop | 3 |
| `e4` / `fi` | fade in | fade in | 4 |
| `e5` / `fo` | fade out | fade out | 5 |
| `e6` / `a4` | arpeggio fast | arpeggio fast | 6 |
| `e7` / `a8` | arpeggio slow | arpeggio slow | 7 |

**DECISION:** the two-letter shortcuts (`sl vb dr fi fo a4 a8`) are OPTIONAL sugar; a conformant transpiler MUST accept `e0..e7` and SHOULD accept the shortcuts. Rationale: numeric `eN` is 1:1 with the hardware field (zero ambiguity for the implementer and for round-tripping), while the mnemonics aid hand-authoring. Effect is modal like volume/waveform: `e2` applies to all following notes until changed; `e0` clears it.

### B.4 Duration, rests, ties (DECISION: the timing mismatch)

**This is the biggest MML↔PICO-8 mismatch and it must be stated loudly.** MML durations are musical fractions (`c4` = quarter note) resolved against a tempo. **PICO-8 has NO per-note duration**: every note in an SFX occupies exactly ONE tracker row, and ALL rows share ONE SFX-level `speed` (ticks/row). You cannot mix a quarter note and an eighth note as single rows of different length within one SFX.

**DECISION: durations are expressed in TRACKER ROWS, not musical fractions:**

- A picopilot-MML "length" N means **N tracker rows**, not 1/N of a bar. `c` (or `c1`) = 1 row; `c2` = the note held for 2 rows; `c4` = 4 rows; etc. The whole/half/quarter framing is dropped because PICO-8 has no bar.
- Holding a note for M rows is emitted as: the note in row 1, then **(M−1) TIE rows**. A tie row repeats the note's pitch/waveform but is realized as either (a) the same note re-struck, or (b) a sustained note. PICO-8 has no true "sustain a previous row" bit, so **DECISION:** a tie/hold re-emits the SAME pitch/waveform/volume in the following rows (audibly a held/repeated note at the SFX speed). If the author wants a smooth sustain they use `e1` (slide) or a low SFX speed. Document this limit; do NOT pretend PICO-8 sustains across rows.
- `.` (dot) multiplies the row count: `c4.` = 6 rows (4 × 1.5). Fractional results round to the nearest whole row (rows are integers); the transpiler warns if rounding changed the value.
- `r` (rest) = a row with **volume 0** (pitch/waveform irrelevant). `r4` = 4 silent rows.
- `^` (tie) = extend the previous note by its length in rows (same emission as a multi-row note).
- `l4` sets the default row-length for subsequent bare notes.
- **Hard cap:** an SFX has 32 rows. If the accumulated rows exceed 32, **error** (`audio-mml-sfx-overflow`, reporting the row count and the 32 cap). Rationale: 32 is a hard PICO-8 limit; splitting across multiple SFX + a music pattern is a STRUCTURAL decision (B.6) the author makes explicitly, not something the transpiler should do silently.

**Tempo:** picopilot-MML has NO tempo/BPM token. Speed is the SFX `speed` field (B.5), in ticks/row, which is the only timing PICO-8 exposes. Stating a BPM would be a lie (PICO-8 measures in ticks, ~1/120s each, not beats). If a friendlier tempo is ever wanted, it is a v2+ convenience that COMPUTES a speed, flagged as lossy.

### B.5 SFX-level controls: speed and loop (DECISION)

Expressed as directives that set the `__sfx__` header (A.1), placed anywhere in the string (last-writer-wins; conventionally at the front):

| directive | sets header field | notes |
|---|---|---|
| `s<N>` (e.g. `s16`) | **speed** (ticks/row), 1..255 | 1 = fastest. Required-ish; default `s16` if omitted (a moderate tempo). |
| `{` ... `}` loop markers | **loop start / loop end** | see below |

**DECISION: loop points as bracket markers, not indices.** the author places `{` where the loop should return TO and `}` where it loops FROM, inline in the note stream. The transpiler resolves them to the row indices for the header (`loop start` = row at `{`, `loop end` = row after the last row before `}`). Rationale: authors think in "loop this phrase", not in absolute row numbers; markers survive edits that indices wouldn't. If `{`/`}` are absent, loop is off (header `0 0`). If only `{` is present (no `}`), it is treated as the **LEN** special case (A.1), i.e. "this SFX is N rows long for music-pattern purposes", and the transpiler emits `loop_start = N, loop_end = 0`; document this dual use explicitly.

### B.6 `__music__` authoring model (CONFIRM ADR: structural, not notation)

**CONFIRMED:** ADR-0005's decision holds under the verified layout. A `__music__` pattern is 4 channel bytes + 3 flow flags (A.5): there is NO melodic content in `__music__` at all; melody lives entirely in the referenced SFX. Authoring music AS a notation would be a category error. picopilot v2 assembles music **structurally**.

**Specified list format** (the shape the `music from-patterns` command consumes; concrete serialization (JSON/TOON/CLI args) is a v2 task decision, this fixes the MODEL):

```
song := ordered list of patterns
pattern := {
  channels: [ ch0, ch1, ch2, ch3 ]     # each: an SFX index 0..63, or null/off
  loopStart?: bool                       # flag 0x01
  loopBack?:  bool                       # flag 0x02
  stop?:      bool                       # flag 0x04
}
```

- Each channel entry is either an SFX index (0..63) or "off" (emit channel byte with bit6 `0x40` set, per A.5). "off" vs "sfx 0" are DIFFERENT (sfx 0 is a real, playing SFX), so the model must distinguish null/off from index 0.
- Pattern order in the list = song order.
- `loopBack` without a `loopStart` anywhere → PICO-8 returns to pattern 0 (manual); the model allows it, and the transpiler MAY warn.
- Pattern length / polyrhythm: when channels reference SFX of different lengths, PICO-8 ends the pattern when the **left-most non-looping channel** finishes (manual). picopilot exposes this only through the SFX LEN/speed each referenced SFX already carries (B.5); the music model itself stores no per-pattern length. Document this so authors know pattern timing is inherited from channel 0's SFX.

### B.7 Every non-1:1 mismatch, with its decision (the "nastier than assumed?" audit)

ADR-0005 warned the mapping might be nastier than assumed. Verdict: **the byte layout is clean and pleasant (Part A round-trips perfectly); the mismatches are all on the MML side, and they are real but each is closable.** Enumerated:

1. **No per-note duration (biggest).** PICO-8 = fixed rows at one SFX speed. → DECISION B.4: durations are ROW COUNTS emitted as tie rows; no bar/tempo; hard 32-row cap errors. This RESHAPES the mental model the v2 command surface should present: authors write "rows at a speed", not "sheet music". The v2 `sfx from-mml` docs must lead with this.
2. **No true sustain across rows.** → DECISION B.4: a held note re-emits the same row; smoothness only via slide effect or low speed. Stated as a limit, not hidden.
3. **No tempo/BPM.** → DECISION B.4: only `speed` (ticks/row). Any BPM sugar is explicitly lossy/optional.
4. **Pitch ceiling C0..D#5 (0..63).** → DECISION B.2: out-of-range = structured error, no silent clamp.
5. **Waveform is per-note AND doubles as custom-instrument selector (nibble 0..15).** MML has no timbre-per-note concept. → DECISION B.1/B.3: `@0..@7` = built-in waveforms, `@8..@F` = SFX 0..7 as instruments. This is a first-class, modal token, the whole point of picopilot-MML over ABC.
6. **Effects have no MML equivalent.** → DECISION B.3: `e0..e7` canonical + optional mnemonics.
7. **Per-SFX filters (NOIZ/BUZZ/DETUNE/REVERB/DAMPEN) are out of the note bytes.** → DECISION A.6/B: NOT exposed in v2 picopilot-MML. Deferred; add as SFX-level directives later if needed. Flag if a v2 use case demands them.
8. **Music is not notation.** → DECISION B.6: structural pattern list, ADR confirmed.
9. **"off channel" vs "sfx 0".** → DECISION B.6: modelled as distinct (null/off sets bit6; index 0 is a real SFX).
10. **Loop points: indices vs phrase.** → DECISION B.5: `{`/`}` markers; single `{` = LEN special case.

None of these forces a redesign; but #1/#2/#3 mean the v2 `sfx from-mml` **command and its docs must frame authoring as "tracker rows at a speed", not tempo-based sheet music.** That is the one place the ADR's "reshape before committing the command surface" applies. Recommend the v2 `sfx from-mml` task state this framing up front and reject tempo-style inputs with a clear message.

---

## Closed decisions (summary)

- **Part A layout: fully verified, byte-for-byte, on PICO-8 v0.2.7.** `__sfx__` = 168-char rows (8 header + 32×5-nibble notes, note = `PP W V E`, waveform nibble 0..15 with 8..15 = custom SFX-instrument). `__music__` = `FF CCCCCCCC` per pattern (flag byte loop-start=1/loop-back=2/stop=4; channel bytes 0..3f active, bit6 = off). Header = mode/speed/loopstart/loopend, with the `loop_end==0` LEN special case. A transpiler should EMIT the text nibbles directly (not poke the scattered RAM bits).
- **Part B grammar + mapping: CLOSED.** Modal `@`/`v`/`e`/`o`/`l`; pitch = `12*oct+semitone`, C0=0, default `o2`; effects `e0..e7` (+ mnemonics); durations = tracker ROWS via tie rows (no tempo, no cross-row sustain); `s<N>` speed; `{`/`}` loop markers; music = structural 4-channel pattern list. Out-of-range pitch and >32 rows are structured ERRORS, not silent clamps.
- **ADR-0005 confirmations:** ABC-rejection vindicated (waveform/effect/volume are per-note and essential); music-is-structural confirmed; the mapping is NOT nasty on the byte side. The only reshape needed is framing MML authoring as tracker-rows-at-a-speed (mismatches #1/#2/#3).

## Residual open questions (for the v2 tasks, NOT blockers)

- **Concrete serialization** of the music pattern list (JSON vs TOON vs CLI flags): a `music from-patterns` command-surface decision, not a mapping decision.
- **Multi-SFX overflow ergonomics:** when a melody exceeds 32 rows, do we error only (current decision) or offer an opt-in "split into SFX N..M + a pattern" helper? Deferred to the `sfx from-mml` task; the safe default (error) is specified here.
- **Optional tempo→speed sugar:** whether to offer a lossy BPM convenience. Specified as out-of-scope-by-default; revisit only if authors ask.
- **Filters (NOIZ/BUZZ/…):** deferred; revisit if a v2 use case needs them.

## Candidate ADRs (decisions that may clear the ADR bar: hard to reverse + surprising + a real trade-off)

- **"picopilot-MML durations are tracker ROWS, not musical note values (no tempo)."** Hard to reverse (it shapes the whole authoring model and command surface), surprising (users expect `c4`=quarter note), a real trade-off (fidelity to PICO-8 vs MML familiarity). Recommend promoting to an ADR before the v2 `sfx from-mml` command is committed, per ADR-0005's "reshape before committing" clause.
- **"Out-of-range pitch / >32 rows ERROR rather than clamp/split."** Reversible-ish but user-visible and opinionated (consistent with picopilot's smart-refuse stance, cf. gfx/map overlap). Worth a line in the `sfx from-mml` task; ADR-worthy only if the split-helper question (above) is answered "auto-split", which WOULD be hard to reverse.

## What the v2 audio tasks can now be written against

- `sfx from-mml` → implements B.1–B.5 (parse picopilot-MML → emit one `__sfx__` row per A.1–A.4). Lead its docs with the tracker-rows framing (B.4/B.7 #1).
- `music from-patterns` → implements B.6 (structural pattern list → `__music__` rows per A.5).
- `audio render` → uses the verified layout to write valid `__sfx__`/`__music__` sections; the PICO-8 playback is `sfx()`/`music()` (already in `pico8-api-reference.md`).

All three block on this finding and can now be tasked; the transpiler is writable from Part A + the B.3/B.4/B.5 tables without re-opening these questions.
