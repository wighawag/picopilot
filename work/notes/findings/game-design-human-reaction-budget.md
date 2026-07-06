---
title: Game-design reaction budget — calibrate timing windows to human reaction time, not frame-perfect input
slug: game-design-human-reaction-budget
source: 'Reaction-time / game-design sources, cross-checked against the "one button: Gravity Turns" jam entry a human found unplayable-by-a-human. Web: retrogamedeconstructionzone.com "Reaction Time and Game Design" (at 60fps, a 200-300ms simple reaction = 12-18 frames; a typical gamer needs ~15 frames to make a simple reaction); braingameszone.com genre reaction figures (casual play workable under ~250ms, competitive FPS 140-180ms); r/gamedesign "you should know what human reaction time is". Simple-reaction-time ~200-300ms is the standard figure.'
---

# Human reaction budget: leave a reaction margin; do not tune against frame-perfect input

## The numbers (verified external ground truth)

- **Simple human reaction time is ~200-300ms** (see a stimulus, press a button). This is DETECTION only, before any decision.
- At **60fps** that is ~12-18 frames; a typical gamer needs on the order of **15 frames** for a simple reaction.
- At **PICO-8's default 30fps** that is roughly **6-9 frames** to react, before deciding WHAT to do. Choice/decision reactions are slower still.
- Casual play is workable under ~250ms; competitive FPS players sit at 140-180ms. Design for the AUDIENCE: a casual/jam game should assume ~250-300ms, not pro reflexes.

Consequence: any required-input WINDOW narrower than ~6-9 frames (at 30fps) is at or below the floor of human simple reaction and is effectively frame-perfect — unplayable by a human as a REACTION (only as a memorized/predicted pattern). Fast action games stay fair by relying on PREDICTION and telegraphing, not raw reaction: they give readable wind-ups so the player acts on anticipation, not on a sub-reaction-time window.

## The concrete failure that surfaced this

The jam entry "one button: Gravity Turns" was found unplayable by a human ("it accelerates to a point that no human can play"). The mechanism is subtler than "too fast": ball speed is actually CAPPED (max 3px/frame) and fixed across levels. What made it unplayable is that the ONLY input is an edge-triggered rotation and the ball drifts continuously, so the correct-press window is a few frames wide. The agent tuned every level by scripting EXACT frame numbers (`5:x, 45:x, 85:x, ...`) in its playtest `--input`, which a computer hits perfectly and a human cannot. It calibrated difficulty against its OWN frame-perfect input.

Root cause (shared with the fairness finding): the agent playtests AS A FRAME-PERFECT MACHINE and never models a human player with reaction latency. It can verify "hittable by me", never "hittable by a human in time".

## The self-check an agent can actually run

- **Budget a reaction margin.** Any moment that requires the player to react (dodge, press-at-the-right-time) must give a window comfortably above human simple reaction: at 30fps, aim for well more than ~9 frames of readable warning/telegraph before the decisive moment, not a frame-perfect window.
- **Do not tune difficulty against your own `--input` scripts.** Frame-perfect scripted input is the jam trap: if the ONLY way you can beat a level is a hand-timed frame sequence, a human cannot. Before calling a level "done", ask: could a human with ~250ms reaction clear this, relying on telegraphed anticipation rather than frame-perfect timing?
- **Telegraph, then require.** Prefer predictable, readable hazards (visible wind-up, consistent speed) over surprises that demand sub-reaction-time responses. Difficulty should come from PLANNING/PREDICTION pressure, not from beating the reaction-time floor.

## Why this belongs in a UNIVERSAL game-design skill (not the jam skill)

Reaction budgeting is true of ANY real-time game. The universal skill states the law (calibrate to ~6-9 frames at 30fps, telegraph, do not require frame-perfect reaction). The JAM skill only carries the situated anti-pattern the agent-under-a-clock actually hits ("you tuned this against your own frame-perfect --input script — that's the jam trap; leave a reaction margin before you call a level done").
