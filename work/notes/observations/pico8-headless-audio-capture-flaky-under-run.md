---
title: PICO-8 real-time WAV capture (`-run` + audio_rec) is flaky/unavailable without a focused window; `-x` inits no audio; the SDL `disk` driver ticks no game loop
slug: pico8-headless-audio-capture-flaky-under-run
spotted: 2026-07-05
---

# PICO-8 headless audio capture is unreliable in an unattended shell

Spotted during the `audio-mml-sfx-filters` filter-decode spike, cross-cutting ADR-0009's "recording needs a real A/V session". On this box (`:0` X display present, pulseaudio, `/dev/snd`), `pico8 -root_path <dir> -run <cart>` with an `extcmd("audio_rec")`/`audio_end(1)` harness captured real WAVs INTERMITTENTLY (~30 succeeded early in the session, then it went durably silent: `_update` stops ticking and no WAV is written), apparently gated on the window getting focus/render. Separately: `pico8 -x <cart>` ticks `_update` reliably headless but initialises NO audio (no WAV at all), and forcing `SDL_AUDIODRIVER=disk` writes a real-time PCM file under `-run` but it is all-zero because the game loop is frozen (so `sfx()` never fires) while the disk callback keeps emitting silence. Net: there is no fully-deterministic headless PICO-8 audio-to-file path here; the working captures were opportunistic. This matches ADR-0009 (real-time recording, manual/opt-in tier) and reinforces that any audio-diff verification is a developer-desktop step, not a CI/unattended one. A future virtual-A/V idea (Xvfb + a PulseAudio null-sink) is already noted in the audio example's "rough edges".
