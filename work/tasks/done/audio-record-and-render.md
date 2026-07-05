---
title: audio record + render, record a running cart's audio to WAV, and render authored sfx/music over it (PICO-8-gated)
slug: audio-record-and-render
prd: picopilot
blockedBy: [audio-sfx-from-mml]
covers: [13]
---

## What to build

The "ears" of the audio loop, delivered the ONLY way PICO-8 v0.2.7 allows: by RECORDING a running cart's audio, NOT an offline export (which is broken upstream). This supersedes the retired `audio-render-wav` task. The binding spec is `work/notes/findings/pico8-audio-wav-export-and-record.md` (tested) + `docs/adr/0009-audio-render-is-record-based-not-offline-export.md` (the decision). Do NOT attempt `pico8 -export foo.wav`: it SIGFPEs cross-platform and writes nothing (finding Part 1).

One task, three surfaces over ONE record mechanism (the audio sibling of how `run` collects screenshots):

- **`picopilot audio record <cart>` (the primitive):** run the cart in a real A/V session and capture a WAV of whatever it plays. Uses `extcmd("audio_rec")` + `extcmd("audio_end",1)` (the cart cooperates, like `extcmd("screen")` for `run`). Return a structured envelope with the WAV path.
- **`picopilot run --record-audio` (the flag):** while `run` orchestrates a session, ALSO capture a WAV of the run's audio alongside the screenshots. Reuse `run`'s sentinel-watch + collect machinery; add the WAV as another collected artifact.
- **`picopilot audio render` (US #13, the convenience over the primitive):** inject a THROWAWAY harness cart (same `__sfx__`/`__music__`) whose `_update` plays a selected TARGET (`sfx N` / `music/pattern P` / whole song), record it, return the WAV. The author writes NO playback code and gets "render sfx 5 -> a WAV". render and record stay DISTINCT in intent (render injects a play-harness for a chosen target; record captures a cart's own playback) but share the capture seam.

Load-bearing constraints from the spike (honour all):

- **Recording needs a REAL (or virtual) A/V session; it does NOT work under headless `-x`** (finding Part 2: `-x` yields a valid but EMPTY 0-frame WAV; `-run` captured 5.34 s of real audio). Scope = option (i): target a developer's real machine; the live capturing run is a MANUAL / opt-in test tier (mirror `run`'s live-PICO-8 tier). CI covers only the orchestration (against a FAKE runner) + the structured `pico8-not-found` failure. (The virtual-A/V-session path is idea `audio-record-virtual-av-session`, NOT this task.)
- **`audio_end(1)` saves to PICO-8's current folder, NOT `-desktop`** (finding Part 2). Control the WAV location via PICO-8's working folder / `root_path` (or `audio_end(0)` + `-desktop`), and ISOLATE it to a temp/scratch dir in tests, asserting shared dirs (`~/Desktop`, the carts root) are untouched.
- **HONEST help text:** `audio render` is a REAL-TIME recording of playback (needs a real audio session), NOT a deterministic offline export. Say so, so "render" does not imply offline determinism. Record duration must cover the target's play length (from the SFX speed + LEN, finding `pico8-audio-sfx-music-layout-and-mml-subset.md`).
- **PICO-8 ABSENT -> structured `pico8-not-found`** + nonzero exit (mirror `run`), never a crash/hang.

## Acceptance criteria

- [ ] **BUILD-TIME VERIFY-FIRST (do this before designing the test story):** confirm in the builder's environment whether `audio_rec`/`audio_end` captures NON-EMPTY audio (finding Part 2's `-run` result) vs. an empty WAV (headless). Record the result in the done record; it decides whether ANY live assertion is possible here or the live tier is purely manual.
- [ ] `picopilot audio record <cart>` returns a structured envelope with the captured WAV path (and the run/exit state).
- [ ] `picopilot run --record-audio` collects a WAV alongside the existing screenshots/printh envelope (reusing `run`'s orchestration; the flag is additive).
- [ ] `picopilot audio render` injects a play-harness for a selected target (sfx / pattern / whole song), records it, and returns the WAV path, with help text stating it is a real-time recording, not an offline export.
- [ ] PICO-8 absent -> structured `pico8-not-found` + nonzero exit (NOT a crash/hang). **This is the CI-testable path.**
- [ ] The orchestration (harness/target -> `audio_rec`/`audio_end` calls -> collect the WAV path) is unit-tested against a FAKE pico8 runner; a real capturing run is a MANUAL/opt-in tier.
- [ ] **Shared-write:** the WAV goes to a controlled/temp dir; tests assert `~/Desktop` AND PICO-8's carts root are untouched (the `audio_end(1)`-to-current-folder quirk is the trap).

## Blocked by

- `audio-sfx-from-mml` (soft), render is most useful once a cart HAS authored sfx/music, and it reuses the audio target vocabulary. The HARD reuse is `engine/pico8`'s `Pico8Adapter` seam + injectable runner + the sentinel/`-desktop` collect machinery from `run-command-and-debug-skill` (already landed). This task extends `run`/`engine/pico8`, so serialise on those.

## Prompt

> Goal: ship audio-to-WAV the ONLY way PICO-8 v0.2.7 allows, RECORDING a running cart, as `audio record` (primitive) + `run --record-audio` (flag) + `audio render` (US #13, emulated as a harness-inject over the primitive). NOT an offline export (broken upstream).
>
> FIRST, read the binding docs, they are the LIVE-TESTED spec and this task REPLACES the retired `audio-render-wav` (which correctly STOPPED on discovering the offline export is broken):
> - `work/notes/findings/pico8-audio-wav-export-and-record.md`, Part 1 (offline `-export` WAV SIGFPEs cross-platform: DO NOT build on it; ruled out as ours via `pico8_dyn` + `ldd` + display tests + BBS tid=50123), Part 2 (`audio_rec`/`audio_end` WORKS but needs a real A/V session: `-x` -> empty 0-frame WAV, `-run` -> 5.34 s real audio; `audio_end(1)` saves to the current folder not `-desktop`), Part 3 (the harness-inject recipe to emulate `audio render`).
> - `docs/adr/0009-audio-render-is-record-based-not-offline-export.md`, the decision + why (record-based, option i, honest framing, swap-in preserved).
> - `docs/adr/0006-run-is-a-thin-orchestration-command.md` + `work/notes/findings/pico8-run-and-screenshot.md`, the sentinel-watch + collect machinery you REUSE (and `run`'s live-PICO-8-is-manual test discipline).
>
> Drift-check: covers prd US #13 (reshaped from "export a WAV" to "record a run's WAV" per ADR-0009). Confirm `engine/pico8`'s `Pico8Adapter` seam + injectable runner + the `run` command exist (from `run-command-and-debug-skill`'s `## Decisions`) and EXTEND them; do not re-invent the pico8-not-found detection or the collect loop. If reality has drifted from the finding, the finding (tested) wins.
>
> Domain: `CONTEXT.md` (the pico8-not-found boundary mirrors shrinko-not-found; the audio target vocabulary from `sfx from-mml`/`music from-patterns`). incur `error({code,...})` for the failure; incur CTAs to chain compose -> render/hear.
>
> Where to look: `engine/pico8` (extend the adapter with a record/capture call), `src/commands/run.ts` (the sentinel-watch + `-desktop` collect + temp-dir isolation pattern to mirror + the `--record-audio` flag), the audio findings for what a valid target/duration is. Decide the render-target surface (sfx N / pattern P / whole song), a command-surface call; the finding leaves it open.
>
> Seam to test at: (1) pico8-absent -> structured `pico8-not-found` + nonzero (the CI test); (2) the record/harness orchestration unit-tested against a FAKE runner (assert the right `audio_rec`/target-play/`audio_end` calls + the collected WAV path), no real binary in CI; (3) WAV-dir isolation (temp; `~/Desktop` AND the carts root untouched, the `audio_end(1)` trap). Live capture is a manual/opt-in tier. START with the build-time verify-first check (does `audio_rec` capture non-empty audio here?). Done = an agent can record a running cart's audio, capture audio during `run`, and render an authored sfx/pattern to a WAV on a real machine, or get a clean pico8-not-found when PICO-8 is absent.
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block (the render-target surface, the record-duration heuristic, the WAV-location mechanism chosen, envelope shapes, and the verify-first result). Most of the design is already ADR-0009; note-level for the rest unless something new clears the ADR bar.
