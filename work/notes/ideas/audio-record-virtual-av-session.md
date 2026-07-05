---
title: Make audio record/render headless-automatable via a virtual A/V session (Xvfb + PulseAudio null-sink)
slug: audio-record-virtual-av-session
status: proposed
---

# Virtual A/V session so `audio record` / `audio render` work headless (option ii)

## The gap

`picopilot audio record` and the record-based `audio render` (ADR-0009) capture a WAV by RECORDING a running cart's audio (`extcmd("audio_rec")`/`audio_end`). The spike (`work/notes/findings/pico8-audio-wav-export-and-record.md`) found this needs a REAL audio+video session: under headless `pico8 -x` the WAV is a valid but EMPTY 0-frame file (PICO-8 mixes no audio to capture); only a live `pico8 -run` session produced real audio (5.34 s / 117,760 frames verified). picopilot ships this as option (i): works on a developer's real machine, live capture is a MANUAL test tier, CI covers only orchestration + `pico8-not-found`.

## The idea (option ii)

Give picopilot a VIRTUAL A/V session so recording works headless / in CI too:

- **Virtual display:** run PICO-8 windowed (`-run`) under `xvfb-run` (Xvfb), so there is a video device without a physical screen.
- **Virtual audio sink:** a PulseAudio (or PipeWire) null-sink as the SDL audio output, so PICO-8's mixer actually advances and produces samples for `audio_rec` to capture, with nothing audible on the host.
- Wrap the two into a "record session" the `audio record` / `audio render` command sets up and tears down, so the live capture path becomes automatable (headless CI, unattended `run` daemon) instead of manual-only.

## Why not now

- It adds real SYSTEM dependencies picopilot would have to detect / manage (Xvfb, a Pulse/PipeWire null-sink), heavier than the current PICO-8-only boundary, and easy to get subtly wrong (audio sink not actually selected → silent WAV again, the exact failure the spike hit with `SDL_AUDIODRIVER=dummy`).
- Option (i) already delivers the value on a developer's machine; the virtual-session path is a CI/automation convenience, not a capability gap.
- Needs its own spike: VERIFY that `xvfb-run` + a Pulse null-sink actually yields a NON-EMPTY WAV from `pico8 -run` (the spike only confirmed a real session works and headless `-x`/dummy-driver does NOT; the null-sink middle ground is untested).

## When to pick it up

When headless/CI audio capture becomes wanted (e.g. an audio eval in CI, or the `run` daemon needs to capture audio unattended). Spike the Xvfb + null-sink combo first; if it yields real audio, wire it as an opt-in "record session" backend behind the existing `audio record` / `audio render` surface (no command-shape change, per ADR-0009's swap-in note).
