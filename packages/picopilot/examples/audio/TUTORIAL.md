# Composing PICO-8 sound + music as text with your AI agent + picopilot

This walks through building the audio for a PICO-8 cart end to end with picopilot's own commands: four one-shot sound effects (coin / jump / hurt / boom) and a looping bass+melody tune, all authored as TEXT, plus a tiny Lua demo that plays them. It mirrors the `rogue` / `platformer` examples' shape and honesty, but covers the audio loop (`sfx from-mml` -> `music from-patterns` -> `audio render`). Everything below is the workflow as actually experienced, rough edges included.

## Why picopilot (the problem it solves)

PICO-8's `__sfx__` and `__music__` sections are hex blobs. An agent "composing" by hand-writing hex is composing blind. And ABC/score notation cannot even NAME PICO-8's per-note waveform, volume, and effect, so a score-authored SFX is timbre-less ("blind audio in a nicer font"). picopilot gives the agent a small, documented MML dialect (picopilot-MML) that CAN name all of it, transpiles it into the exact `__sfx__` bytes, and closes the loop by recording a WAV you can actually hear.

## The one reframe that matters: TRACKER ROWS, not tempo

The single thing a model gets wrong here (the `picopilot-audio` skill leads with it): **PICO-8 has no per-note duration and no tempo/BPM.** An SFX is a column of up to 32 tracker ROWS; all rows share one `speed` (ticks/row, `s<N>`). So an MML length is a ROW COUNT: `c4` = the note C held for 4 ROWS, not a quarter note. Compose thinking "rows at a speed", not sheet music. A tempo-style token is refused, not guessed at.

## Setup (how it was invoked here)

```sh
picopilot init          # scaffold main.p8 (+ main.lua, AGENTS.md, picopilot.json)
# load the picopilot-audio skill as the agent's guide, then compose:
```

`init` created `main.p8` (whose `__lua__` is a single `#include main.lua`), the editable `main.lua`, an `AGENTS.md` carrying the PICO-8 reference, and `picopilot.json`. It deliberately touches no VCS.

## Step 1 - The four one-shot sound effects (`sfx from-mml`)

Each SFX is one MML string -> one slot (`0..63`); only that slot changes, every other section stays byte-identical. Modal attributes (`@` waveform, `v` volume, `e` effect, `o` octave, `s` speed) are sticky.

```sh
# SFX 0 - coin pickup: a snappy 3-note rising blip (tilted-saw @1)
picopilot sfx from-mml 0 "s5 @1 v6 o3 e g > c"

# SFX 1 - jump: an upward slide (saw @2, slide effect e1 across a rising arpeggio)
picopilot sfx from-mml 1 "s4 @2 v6 e1 o2 c e g > c"

# SFX 2 - hurt: a sharp downward drop (noise @6, drop effect e3, high -> low)
picopilot sfx from-mml 2 "s5 @6 v7 e3 o3 g o2 c o1 g"

# SFX 3 - boom: a DESIGNED explosion - DAMPEN body + REVERB tail on a
# descending noise sweep with a volume decay (noise @6)
picopilot sfx from-mml 3 "s6 !dampen2 !reverb @6 o3 v7 g o1 c o0 g v6 e v5 c v4 g v3 c v2 g v1 c"
```

A tuning note worth its own callout (from actually LISTENING, Step 6): the first
boom was 8 identical low noise rows and sounded like a MACHINE GUN, not an
explosion. The first fix was a strictly DESCENDING pitch sweep (high falling to
low) so the noise "falls" like a real boom. But even a maxed-out descending sweep
+ hand-drawn volume decay STILL read as a descending zap, not an explosion: the
boom needed the two SFX FILTERS `!dampen2` (the low BODY) + `!reverb` (the
resonant TAIL), which no pitch/volume MML can synthesize (see "The boom hit a
real tool limit", now CLOSED). With them the same notes finally read as a boom.
Same descending idea for the hurt: start high and drop. This is the ears loop
doing its job: you cannot hear a rattle-vs-boom problem in the hex, only by
rendering and listening, then re-composing the contour AND reaching for the right
filter.

Each call reports `rows`, `speed`, the `__sfx__` hex row, any rounding `warnings`, and a CTA toward `verify` + `audio render`. Reading one back: `sfx from-mml 0` printed

```
rows: 3   speed: 6
row: "000600002816024160341600..."
```

The row is the finding's layout: header `0006` (`speed 6`), then 5-nibble notes `PP W V E`. `28160` = pitch `0x28`, wave `1`, vol `6`, effect `0`. So the text IS readable if you want it, but you never hand-write it.

The picopilot-MML I actually used, mapped to intent:
- `@1`..`@6` picked the timbre (tilted-saw, saw, noise) per sound.
- `e1` (slide), `e3` (drop), `e5` (fade out) are the PICO-8 effects a score notation could never express, and they are exactly what makes a "jump" sound like a jump.
- `!dampen2` / `!reverb` on the boom are the SFX FILTERS: the low body + resonant tail that turn `@6` noise from a rattle into an explosion. See the filters section of the `picopilot-audio` skill for all 5 (`!noiz !buzz !detune1/!detune2 !reverb !dampen[2]`).
- `>` / `<` shift octave; `s<N>` sets the per-SFX speed (a "coin" wants a fast `s6`, a "boom" a slower `s6`).

## Step 2 - The looping tune: two voices (`sfx from-mml`), then arrange (`music from-patterns`)

Music in PICO-8 holds NO melody: the melody lives in SFX, and `__music__` just references them. So author each voice as an SFX first:

```sh
# SFX 4 - walking bass (organ @5, low octave). l2 = every note is 2 rows, so
# 8 notes = exactly 16 rows (matching the melodies).
picopilot sfx from-mml 4 "s12 @5 v5 l2 o1 c e g a > c < b g e"

# SFX 5 - melody A (triangle @0, 16 rows): a rising-then-falling phrase
picopilot sfx from-mml 5 "s12 @0 v6 o3 c e g > c < b g e c d f a > d < c a f d"

# SFX 6 - melody B (triangle @0, 16 rows): a CONTRASTING answer phrase
picopilot sfx from-mml 6 "s12 @0 v6 o3 e g > c e < b > d < g b a > c < f a e g c e"
```

All are `s12`, and the bass is exactly 16 rows via `l2` (default length 2 rows), so they line up. Getting the bass to exactly 16 rows is a good illustration of the tracker-rows reframe: my first tries came out 15 and 18 rows because each `2`-length note adds 2 rows and I was counting by ear like note values; setting `l2` and giving 8 notes (8 x 2 = 16) is the clean way.

Then arrange them as a 2-pattern A/B loop (the anti-repetition fix, see Step 6): pattern 0 plays melody A over the bass, pattern 1 plays melody B over the same bass, then loops.

```sh
picopilot music from-patterns '[
  {"channels":[4,5,null,null],"loopStart":true},
  {"channels":[4,6,null,null],"loopBack":true}
]'
```

This wrote `__music__`:

```
01 04054040
02 04064040
```

Reading it against the finding: each row is `FF CCCCCCCC` = flag byte + 4 channel bytes. `01` = loop-start, `02` = loop-back; channels `04 05 40 40` = sfx 4 (bass), sfx 5 (melody A), and two OFF channels (`40` = bit6 set); the second pattern swaps melody A -> melody B (`...06...`). Crucial subtlety the skill flags: `null` (OFF) is NOT `sfx 0` - `null` becomes byte `40`, a real sfx 0 would be `00`. The two patterns form an A/B loop (loop-start on the first, loop-back on the second).

## Step 3 - The refusals are loud and actionable (not silent clamps)

Two deliberate mistakes, to see the guardrails. Both refuse with a structured error + a nonzero exit and change NO bytes:

```sh
# ask for a note PICO-8 cannot play (o5 g = pitch 67 > D#5=63):
picopilot sfx from-mml 7 "o5 g"
# -> code: audio-mml-pitch-out-of-range
#    "note 'g' at octave o5 maps to pitch 67, outside PICO-8's range C0..D#5
#     (0..63). ... pick an octave in range rather than transposing off the keyboard."

# ask for more than 32 rows in one SFX:
picopilot sfx from-mml 6 "s8 @0 v6 o2 c c c ... (33 notes)"
# -> code: audio-mml-sfx-overflow
#    "... an SFX holds at most 32 rows. Split the melody across multiple SFX + a
#     music pattern, or shorten it."
```

Each refusal's CTA tells you the fix (transpose; or split across SFX slots). This is the same "refuse loudly rather than silently do the wrong thing" stance as the gfx/map overlap guard - a silent clamp would produce wrong-sounding audio you cannot see.

## Step 4 - The demo Lua (so a human can actually play the sounds)

The audio is data; `main.lua` just triggers it so opening the cart in PICO-8 lets you hear each sound:

```lua
function _init() music(0) end            -- start the A/B bass+melody loop
function _update()
  if btnp(4) then sfx(0) end             -- z -> coin
  if btnp(5) then sfx(1) end             -- x -> jump
  if btnp(2) then sfx(2) end             -- up -> hurt
  if btnp(3) then sfx(3) end             -- down -> boom
  if btnp(0) then                        -- left -> pause / resume the music
    playing = not playing
    if playing then music(0) else music(-1) end
  end
end
```

One honest PICO-8 limit here: `music(-1)` STOPS the music and `music(0)` restarts it from the TOP (pattern 0). PICO-8 has no native "pause here, resume from the same spot" - so left is really stop/restart, not a true pause. Good enough for a demo, but worth knowing.

## Step 5 - The static gate (`verify`, `tokens`, `lint`)

```sh
picopilot verify   # status: pass  (integrity + tokens; 100/8192 tokens)
picopilot tokens   # tokens: 100  pct: 1
picopilot lint     # clean: true  (no findings)
```

All green. The cart is a complete, well-formed audio cart, authored entirely as text.

## Step 6 - Hear it (`audio render`) - and the honest A/V-session caveat

This is the "ears" of the loop, and the one command that behaves differently than you might expect (by design, ADR-0009). PICO-8's OFFLINE WAV export is broken upstream (it crashes), so picopilot gets a WAV the only way that works: by RECORDING a real-time playback session. That means it needs a real display + audio device.

```sh
picopilot audio render --sfx 0 --wav-dir ./out    # record the coin to a WAV
```

- On a **developer machine with a display + speakers**, this injects a throwaway harness cart that plays sfx 0, records it with `audio_rec`/`audio_end`, and writes a real WAV you can open and listen to. The record window is derived from the SFX's own speed + row count (so it captures exactly the sound's length); override with `--seconds`.
- In a **headless / non-interactive context** (like this tutorial was authored in, or CI), PICO-8 cannot init a video device, so the command HONESTLY reports `captured: false` with a CTA to run it on a real machine - it does NOT crash, hang, or fake a WAV:

```
wav: null
captured: false
printh: "SDL Error: No available video device ..."
cta: "... Run on a developer machine with a display + audio device (not headless CI)."
```

Related commands (same record mechanism):
- `picopilot audio render --pattern 0` (or no target = the whole song) records the tune.
- `picopilot audio record main.p8` records the cart's OWN playback.
- `picopilot run --record-audio` captures a WAV alongside a normal `run`.

With PICO-8 absent entirely, all of these return the structured `pico8-not-found` (`set PICO8_PATH or install PICO-8`) + a nonzero exit, never a crash.

## Step 7 - Wrap-up: what picopilot did, honestly

### The workflow
Compose each sound as one MML string (`sfx from-mml`), reading back `rows`/`speed`/hex; arrange the voices structurally (`music from-patterns`) with loop flags and OFF channels; gate on `verify`/`tokens`/`lint`; then RECORD a WAV to hear it (`audio render`, on a real machine). The whole `__sfx__`/`__music__` binary was produced without ever hand-writing a hex nibble, and picopilot-MML named the waveform/volume/effect a score notation cannot.

### What genuinely worked
- All six SFX + the 2-pattern song transpiled to correct `__sfx__`/`__music__` on the first try, each merge byte-preserving every other section.
- Both refusals (pitch out-of-range, >32-row overflow) fired with precise, fix-oriented messages and touched no bytes.
- `verify`/`tokens`/`lint` all green; the cart boots under `run`.
- `audio render` / `audio record` / `run --record-audio` all wired correctly and degraded HONESTLY (`captured:false` + CTA) when there was no A/V session, and returned the structured `pico8-not-found` when PICO-8 was absent.

## Tuning by ear (the iterate step - you cannot skip it)

The first pass composed the SFX "blind" (no listening). Rendering + actually playing the cart surfaced exactly what you would expect the ears loop to catch, and nothing the hex could have told you:

- **coin**: ok-ish -> made it a snappier 3-note rise.
- **jump**: great as-is (the `e1` slide sells it).
- **hurt**: ok -> started it higher so the drop has further to fall.
- **boom**: sounded like a MACHINE GUN (8 identical low noise rows) -> recomposed as a strictly descending pitch sweep, THEN given `!dampen2 !reverb` (the SFX filters) for the low body + resonant tail so it finally reads as an explosion, not a zap.
- **music**: too repetitive (both patterns identical) -> split into an A/B structure (melody A, then a contrasting melody B) over a walking bass.

The lesson: compose, render, LISTEN, re-compose the pitch contour / structure. picopilot makes each turn cheap (one `sfx from-mml` line), but the judgement is yours and needs a real playback.

### The boom hit a real tool limit — now CLOSED (the finding that became a feature)

The boom was originally pushed to the CEILING of the pre-filter grammar: a steep descending pitch "crack" plus a hand-drawn volume DECAY envelope across rows (`v7 v7 v6 v5 v4 v3 v2 v1` on the `@6` noise). That was everything picopilot-MML could do, and it STILL read as a descending zap, not an explosion. The reason was not composition skill: a real PICO-8 explosion needs the per-SFX FILTERS (DAMPEN for the low "body", REVERB for the resonant tail, NOIZ for the noise texture), which the grammar could not express (a conscious deferral in the audio spike, ADR-0005). This dogfood was exactly the "flag if a v2 use case demands them" trigger, recorded in `work/notes/observations/picopilot-mml-cannot-express-sfx-filters-limits-designed-sounds.md`.

**That gap is now closed.** The `audio-mml-sfx-filters` task decoded the filter byte layout byte-for-byte (finding A.7) and added the 5 filters as `!`-directives, so the boom above is re-authored with `!dampen2 !reverb @6` — the low body + resonant tail — and finally reads as an explosion. Strip the two filters and the SAME notes revert to the descending zap; the filters are the tool, not the composition. It is a clean example of the ears loop earning its keep: the gap was invisible in the hex, only audible on playback, and it drove a real tool improvement.

## Rough edges found (the real payoff of dogfooding)

- **`audio render` needs an interactive A/V session; it cannot capture from a headless/agent shell.** This is by design (ADR-0009: PICO-8's offline WAV export is broken, so we record a real-time run), and the command is honest about it (`captured:false` + a clear CTA). But it means the "hear it" rung of the loop is NOT reachable from CI or a non-interactive agent context - only from a real desktop session. The tutorial was authored headless, so the actual listening was done separately. A future option (captured as an idea) is a virtual A/V session (Xvfb + a PulseAudio null-sink) to make capture automatable.
- **`audio_end(1)` saves to PICO-8's current folder, not `-desktop`.** picopilot steers the WAV into `--wav-dir` via PICO-8's `root_path` (verified it does not leak to `~/Desktop` or the carts root), but it is a sharp PICO-8 quirk worth knowing if you ever drive the recording by hand.
- **A plain audio-demo cart has no `run` screenshot.** `run` captures screenshots only when the CART cooperates (`extcmd("screen")`); a pure "press a key to hear a sound" demo does not, so `run` boots it and hits the timeout backstop with no shot. Expected, but a first-timer might read the backstop CTA as a fault.
- **PICO-8 drops `log.txt` (and, with `record_activity_log`, `activity_log.txt`) into the launch cwd** when `audio render`/`run` shell out to it. These are gitignored (as in the `rogue` example).
- **The record window for a `--pattern`/whole-song target is a fixed default (8s), not derived.** PICO-8 stores no per-pattern length and following loop flags statically is out of scope, so for music you override with `--seconds` to capture exactly one loop. Only `--sfx` targets get an exact auto-window (from speed + rows).
- **No true music pause/resume.** `music(-1)` stops and `music(0)` restarts from pattern 0; PICO-8 has no "resume from the current spot", so the demo's left button is stop/restart, not a real pause. Not a picopilot thing, a PICO-8 one.
- **Getting an SFX to an EXACT row count is fiddly by ear** (the tracker-rows reframe): `l<N>` + a fixed note count is the reliable way to hit exactly 16 rows, rather than counting each `2`-length note. The bass took two tries (15, then 18 rows) before `l2` + 8 notes landed it at 16.

## Extensions to try (drive the agent for each)
- Add a custom-instrument SFX: author SFX 0..7 as an instrument, then reference it from another SFX with `@8`..`@f`.
- Use `{`/`}` loop markers to make a sustained SFX (e.g. an engine hum) loop, or a lone `{` to set a pattern LEN for an odd time signature.
- Layer a third voice: author a drum SFX and add it as channel 2 in the music patterns (replace a `null`).
- On a real machine: `picopilot audio render --pattern 0 --seconds 6` and listen to the loop; iterate the melody's `@`/`e`/`s` and re-render.

## The finished files
- `main.p8` - the cart: 6 SFX + a 2-pattern song in `__sfx__`/`__music__`, all text-authored, plus the `#include main.lua`.
- `main.lua` - the demo that plays the sounds on button press and loops the tune.
- `AGENTS.md`, `picopilot.json` - scaffolded by `init`.
