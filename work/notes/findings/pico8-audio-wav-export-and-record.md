---
title: PICO-8 audio-to-WAV, offline export is broken upstream; record-a-running-cart works (but needs a real A/V session)
slug: pico8-audio-wav-export-and-record
source: 'SPIKE, tested live against PICO-8 v0.2.7 (both `pico8` and `pico8_dyn` at ~/.AppImages/pico-8/) on Linux, 2026-07-05. Every claim below was reproduced by running throwaway carts and inspecting the produced WAV (or the crash exit code) directly; the WAV frame counts come from Python `wave` header reads. Cross-checked against the Lexaloffle PICO-8 manual (extcmd audio_rec/audio_end + the Memory/Export sections) AND the Lexaloffle BBS (tid=50123 "Commandline/headless export crashes", tid=30838 "Headless crashes"). Temp carts + WAVs were written under ~/.lexaloffle/pico-8/carts and /tmp and deleted; no product code touched.'
---

# PICO-8 audio-to-WAV: what actually works (the tested recipe)

This is the durable output of the "how does `picopilot audio render` get a WAV out of a cart?" spike (the follow-up the ADR-0005 audio work deferred). Conclusion in one line: **PICO-8's offline headless WAV export is BROKEN upstream and unusable; the only working path is to RECORD a running cart's audio via `extcmd("audio_rec")`/`audio_end`, which works but requires a real (or virtual) audio+video session, not headless `-x`.** Everything below is the tested detail a builder would otherwise guess wrong.

## Part 1, Offline WAV `-export` is broken (do NOT build on it)

The documented-looking path `pico8 <cart.p8> -export "foo.wav"` DOES NOT WORK on this build, and it is not our environment's fault:

- **It crashes with SIGFPE (exit 136) and writes no file.** Reproduced on valid authored carts across three variants: `foo.wav`, `snd%d.wav`, and a cart carrying a `__music__` pattern. All SIGFPE, zero output.
- **It is WAV-SPECIFIC, not a general headless-export failure.** On the SAME carts: `.p8.png` export → exit 0 + a real file; `.bin` export → exit 0 (the exporter runs). So PICO-8's headless `-export` machinery is fine; only the audio/WAV code path faults.
- **Not a linking/dependency issue.** `pico8_dyn` (dynamically-linked SDL) SIGFPEs identically to the static `pico8`, and `ldd pico8_dyn` shows NO missing libraries (SDL2, asound, pulse, X11, ... all resolve). Ruled out: static-vs-dynamic build, a missing `.so`.
- **Not a display/config issue.** With `DISPLAY` unset it is instead a fatal `SDL Error: No available video device` (still no WAV); with a display present it is the SIGFPE. Neither `pico8.dat` nor `desktop_path`/`root_path` config changes this.
- **It is a KNOWN, CROSS-PLATFORM upstream limitation.** Lexaloffle BBS tid=50123 ("Commandline/headless export crashes") reports the identical crash on Windows: "I assumed the headless export option could export audio as it does graphics. Apparently it cannot! Specifying a .wav output crashes pico8.exe." It is filed as a FEATURE REQUEST (headless WAV export + a target-selection syntax that does not yet exist), with no dev fix. tid=30838 shows the same SIGFPE class in headless mode historically.
- **Even absent the crash, the mechanism is under-specified for automation.** The manual defines `EXPORT FOO.WAV` (non-`%d`) as exporting "the current pattern (when editor mode is MUSIC), or the current SFX", i.e. it depends on INTERACTIVE EDITOR STATE (which SFX/pattern is open) that does not exist in a headless `-export` run. So the render-target selection (whole-song vs single-sfx vs single-pattern) has no verifiable headless mapping onto `-export` even if the crash were fixed.

**Decision consequence:** picopilot must NOT ship an offline `cart → WAV` exporter on `-export`. There is no working offline path in PICO-8 v0.2.7. This is deferred (see ADR-0009) until Lexaloffle fixes it; if fixed, an offline exporter can slot in UNDER the same command surface without changing it.

## Part 2, Recording a running cart's audio DOES work (`audio_rec`/`audio_end`)

The working path is real-time RECORDING of a cooperating cart (the same family as `extcmd("screen")` screenshots and gif recording that `picopilot run` already orchestrates):

- **`extcmd("audio_rec")`**, start recording audio.
- **`extcmd("audio_end")`**, stop and save the WAV. **`extcmd("audio_end", 1)`** (P1 > 0) saves to the CURRENT folder; P1 omitted/0 saves to the desktop folder. VERIFIED: `audio_end(1)` wrote the WAV into PICO-8's `root_path` (`~/.lexaloffle/pico-8/carts/`), NOT the `-desktop <dir>` directory. (So `-desktop` redirects screenshots/gifs but NOT the `audio_end(1)`-to-current-folder path, a builder must control the WAV location by controlling PICO-8's working folder / root_path, or use `audio_end(0)` + `-desktop`.)
- **`extcmd("set_filename","name")`** before `audio_rec` names the WAV deterministically (`name.wav`), same as for screenshots.

### The load-bearing constraint: recording needs a REAL (or virtual) A/V session, NOT headless `-x`

This is the finding that shapes the whole feature. VERIFIED, three ways:

- **Headless `-x` → a valid but EMPTY WAV (0 frames).** The cart ran cleanly (no crash, sentinel fired), `audio_rec`/`audio_end` executed, and produced a well-formed 44-byte RIFF/WAVE file with `channels 1, rate 22050, 0 frames`. I.e. the file is real but silent: headless PICO-8 does not advance/mix an audio stream to capture. Same result with `SDL_AUDIODRIVER=dummy`, with a longer record window, and with `music(0)` instead of `sfx(0)`.
- **`-run` (a real windowed session with audio actually playing) → real audio.** The same cart under `pico8 -run` captured **5.341 s, 117,760 frames, a 235,564-byte WAV** (`22050 Hz mono 16-bit PCM`). So the recording mechanism genuinely captures the played audio; it just needs a live A/V session to have audio to capture.

**Consequence:** `audio record` (and `audio render` built on it, Part 3) CANNOT run under the headless `-x` path `picopilot run` uses for screenshots. It needs a real display + audio device (a developer's machine), OR a virtual A/V session (Xvfb + a PulseAudio null-sink) to be automatable. Per the chosen scope (option i), the feature targets the real-machine case: it works on a developer's machine, and a live recording is a MANUAL / opt-in test tier (mirroring how `picopilot run` treats live PICO-8). CI covers only the orchestration (against a fake runner) + the `pico8-not-found` structured failure. The virtual-A/V-session path (option ii) is captured as an idea (`work/notes/ideas/audio-record-virtual-av-session.md`), not built now.

## Part 3, Emulating the intended `audio render` (C) on top of record (B)

The intended `audio render` (US #13: "give me a WAV of my composed sfx/music, target-selected") can be EMULATED on the record mechanism NOW, so the value ships despite the broken offline export. The recipe (a harness-inject-and-record, the audio analogue of `run` adding a screenshot-on-timer to a cart):

1. Take the user's cart (its authored `__sfx__`/`__music__`), and a render TARGET (`sfx N`, `pattern P`, or the whole song).
2. Produce a THROWAWAY harness cart with the same audio sections whose `_update` does exactly: at t=start `extcmd("set_filename",...)` + `extcmd("audio_rec")` + the target's `sfx(N)` / `music(P)`; after enough frames `extcmd("audio_end",1)`; then `printh` a done-sentinel.
3. Run it in a real/virtual A/V session (NOT `-x`), watch the sentinel, collect the WAV from PICO-8's folder, return its path.

The user writes NO playback code; they get "render sfx 5 → a WAV" ergonomics. The HONEST caveat (state it in the command help): this is a REAL-TIME recording of playback (needs a real audio session), NOT a deterministic offline export. Timing/length come from the SFX speed + LEN (finding `pico8-audio-sfx-music-layout-and-mml-subset.md`), so the harness must record for at least the target's play duration. If PICO-8's offline `-export` is ever fixed, `audio render` can switch to it underneath without changing its surface.

## What this means for picopilot (the design conclusion)

- **Offline `audio render` on `-export` is a dead end (Part 1).** Deferred; not built. (ADR-0009.)
- **`audio record` (B) is the real primitive:** record a running, cooperating cart's audio to a WAV. Shipped as `picopilot audio record <cart>` (record the whole run) + `picopilot run --record-audio` (capture audio alongside a normal run). Needs a real/virtual A/V session; live path is a manual tier.
- **`audio render` (C) ships as a thin layer over B (Part 3):** inject a play-harness for the selected target, record, return the WAV. Same "needs a real session" caveat; same manual live tier. This is DIFFERENT from an offline export and must be named/documented as record-based, not offline.
- **Testing story (mirrors `run`):** CI tests the orchestration against a FAKE pico8 runner (assert the right `audio_rec`/target/`audio_end` calls + output-path handling + `pico8-not-found` structured failure). A real capturing run is a manual/opt-in tier because it needs an A/V session. The build-time verify-first check: confirm `audio_rec` captures NON-EMPTY audio in the builder's environment; if the environment is headless-only, the live tier stays manual and CI asserts only orchestration.
