---
title: audio render, export a WAV from a cart's sfx/music (PICO-8-gated)
slug: audio-render-wav
prd: picopilot
blockedBy: [audio-sfx-from-mml]
covers: [13]
---

## What to build

`picopilot audio render`, export a cart's audio to a WAV so the developer (or a future eval) can HEAR the result and the agent can iterate on feedback. This is the "ears" half of the feedback loop, the audio counterpart to `gfx render`'s eyes. It is PICO-8-GATED: rendering audio requires the user's PICO-8 binary (mirroring `run` / PNG-or-bin `export`), so the CI-testable path is the structured PICO-8-absent failure.

End-to-end vertical (engine/pico8 render -> command -> structured result -> tests):

- **`engine/pico8` extension:** invoke the user's PICO-8 to render a cart's `__sfx__`/`__music__` to a WAV. Use PICO-8's own audio-export mechanism (the finding + the PICO-8 manual/CLI are the source; confirm the exact flag/extcmd at build time, e.g. the `EXPORT foo.wav` path or the CLI export flag, since this is PICO-8's capability, not ours). Reuse the existing `Pico8Adapter` seam + the injectable-runner discipline from the `run` work.
- **`picopilot audio render` command:** take a cart + a target (which music pattern / sfx, or the whole song), shell out via `engine/pico8`, and return a structured envelope with the output WAV path. PICO-8 ABSENT -> the structured `{ok:false, reason:"pico8-not-found", remedy:"set PICO8_PATH or install PICO-8", needs:["pico8"]}` + nonzero exit (identical shape to `run`; NEVER a crash/hang). CTA toward listening / iterating.
- **Shared-write discipline:** the WAV goes to a run-controlled dir (temp/scratch by default, or a user-given path); tests isolate it and assert no pollution of shared/desktop dirs.

## Acceptance criteria

- [ ] PICO-8 absent -> structured `pico8-not-found` + nonzero exit (not a crash/hang). **This is the CI-testable path** (PICO-8 is a paid binary, not on CI).
- [ ] `audio render` returns a structured envelope with the output WAV path (and the render target it used).
- [ ] Live WAV render is a MANUAL/opt-in test tier (mirror the existing `engine/pico8` runner-absent test discipline, do NOT require a real pico8 in CI).
- [ ] Output isolation: the WAV is written to a controlled/temp dir by default; tests assert no shared-location pollution.
- [ ] Reuses the `Pico8Adapter` seam + injectable runner (no re-inventing the absent-detection built by the `run` task).

## Blocked by

- `audio-sfx-from-mml`, soft: rendering is most useful once a cart HAS authored sfx/music, and this task should reuse the audio domain vocabulary/target-selection the sfx task establishes. The hard dependency is the `engine/pico8` `Pico8Adapter` seam, which already exists from `run-command-and-debug-skill`.

## Prompt

> Goal: build `picopilot audio render` as a PICO-8-gated WAV exporter, giving the agent EARS to iterate on audio (the audio counterpart to `gfx render`'s eyes). Thin command over the user's PICO-8 audio-export capability + the structured pico8-not-found boundary.
>
> FIRST, drift-check + read: confirm `engine/pico8` and the `Pico8Adapter` seam + injectable runner exist (built by `run-command-and-debug-skill`, see its `## Decisions`: the adapter interface + the pico8-not-found structured result + the temp-dir isolation lever). REUSE them; do not re-invent absent-detection. Read `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` (Part A, so you render valid sfx/music) and `work/notes/findings/pico8-run-and-screenshot.md` (the PICO-8 CLI/headless discipline). Confirm the EXACT PICO-8 audio-export mechanism against the local PICO-8 install/manual at build time (it is PICO-8's feature, the `EXPORT`/CLI path, not ours); if PICO-8 offers no headless WAV export, that is a needs-attention finding to surface, not a thing to fake.
>
> Domain: `CONTEXT.md` (the pico8-not-found boundary mirrors shrinko-not-found: structured, nonzero, never crash/hang). incur `error({code,...})` for the failure; incur CTAs for the iterate loop.
>
> Where to look: `engine/pico8` (extend the adapter for a render/export call); `src/commands/run.ts` (the pico8-gated command pattern to mirror, structured result, absent handling, temp-dir isolation); the audio findings for what constitutes valid sfx/music to render.
>
> Seam to test at: (1) pico8-absent -> structured `pico8-not-found` + nonzero (the CI test); (2) the render invocation unit-tested against an injected FAKE pico8 runner (assert it forms the right export call + returns the WAV path), no real binary in CI; (3) output-dir isolation (temp, shared dirs untouched). Live WAV render is manual/opt-in. Done = an agent can render a cart's audio to a WAV path, or gets a clean pico8-not-found when PICO-8 is absent.
>
> RECORD non-obvious decisions in a `## Decisions` block (the exact PICO-8 export mechanism chosen, the render-target selection surface, envelope shape, output-dir default/flag). If PICO-8's export forces a surprising, hard-to-reverse shape, consider an ADR (`ADR-FORMAT.md`).

## Requeue 2026-07-05

Superseded by audio-record-and-render: PICO-8 offline WAV -export is broken upstream (SIGFPE, cross-platform); audio-to-WAV is now record-based per ADR-0009 + finding pico8-audio-wav-export-and-record. This task is retired.
