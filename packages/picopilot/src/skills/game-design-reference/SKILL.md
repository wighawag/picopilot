---
name: game-design-reference
description: Reference body of universal game-design principles (fairness, human reaction budget, readability, visibility, originality method). A shared reference other skills point at (game-jam, and any make-a-game skill); not fired on its own.
disable-model-invocation: true
---

# game design reference

Universal principles of a GOOD game, true of any game regardless of engine, clock, or theme. This is a shared REFERENCE body: another skill (e.g. `game-jam`) points you here and you apply every principle below. It is engine-agnostic; where a check needs a concrete PICO-8 procedure (drive a cart, count frames), that lives in the loop skill `picopilot-debug` (playtest), which you follow the pointer into.

The one failure mode that unites the traps below: **an agent playtests as a frame-perfect machine and never models a human player.** You can hit any button on the exact right frame and see every pixel, so a game that is fair-and-playable TO YOU can be unfair or impossible for a human. Every check here is you deliberately putting on the human's eyes and hands.

## Fairness: never a dead state

A game is UNFAIR when it can reach a state the player did nothing wrong to reach, from which EVERY available action leads to a loss. A death the player could not have avoided reads as the GAME cheating, not the player failing, and it damages fairness far more than a hard-but-fair challenge does. Fairness is "the player can always still win, even after a setback": from every state, at least one legal move is non-losing.

This is distinct from DIFFICULTY. Hard is fine; a dead state punishes the player for the game's own design gap.

**The self-check (the one that gets skipped).** When a game has HAZARDS plus LIMITED control (a few discrete actions), verify BOTH properties, not just the first:

1. **Goal reachability** — from spawn/rest states, some sequence of actions reaches the objective. (Agents check this one.)
2. **Hazard avoidability** — from EVERY state the player can settle/rest into, at least ONE available action is non-fatal. (Agents SKIP this one.) If a resting position exists where all actions force a loss, that is a DEAD STATE: a fairness defect. Fix the geometry (widen an exit, move the hazard, add a safe lane) so no such pocket exists.

For a discrete-control game this is enumerable: drive the player into every corner/pocket it can settle in, then try EACH action and assert not-all-fatal. Do this with the playtest loop (`picopilot-debug`) deliberately, it will not happen by accident.

## Reaction budget: a human is not frame-perfect

Simple human reaction time is ~200-300ms (see a thing, press a button) and that is DETECTION only, before deciding what to do. At PICO-8's 30fps that is roughly **6-9 frames** just to react. So:

- **Any required-input WINDOW narrower than ~6-9 frames is effectively frame-perfect** and unplayable by a human as a reaction (only as a memorised pattern).
- **Do not tune difficulty against your own `--input` scripts.** If the ONLY way you can clear a level is a hand-timed frame sequence you authored, a human cannot clear it. That is the trap: you tuned against a frame-perfect player (yourself).
- **Telegraph, then require.** Fast games stay fair by relying on PREDICTION: give a readable wind-up so the player acts on anticipation, not on a sub-reaction-time window. Difficulty should come from planning/prediction pressure, not from beating the reaction-time floor.

**The self-check.** Before calling a level done, ask: could a HUMAN with ~250ms reaction clear this, relying on telegraphed anticipation rather than frame-perfect timing? If clearing it needs your exact scripted frames, widen the window or add telegraphing.

## Visibility: the player must see the player

If you `spr(n)` an entity, sprite n must actually be DRAWN (a non-empty sprite), or the entity is invisible and the game is unplayable however correct the logic. Prefer primitives (`circfill`, `rectfill`, `line`) for the player and key entities unless you have authored real sprites, primitives can never be an empty slot. The player, and every entity the player must track, must be visible and distinguishable on screen.

## Readability and feedback

The player must be able to READ the game state at a glance and get FEEDBACK for every action: what am I, what is a hazard, what is a goal, did my input register, did I score or get hit. Motion trails, colour contrast, a HUD, particles/shake/sfx on events, these are not polish for its own sake, they are how the player perceives the state they must act on.

## Difficulty curve and progression

A good game GOES SOMEWHERE: it escalates. Ramp difficulty by introducing or combining MECHANICS (a new hazard type, a new interaction) over the playthrough, not merely by piling more of the same obstacle. More-of-the-same reads as samey and does not deepen; a new wrinkle does. Aim for a difficulty ARC with a satisfying peak, not a flat loop. Keep the first contact with each new mechanic gentle enough to learn it before it is tested under pressure.

Progression can take MANY FORMS, a ladder from cheapest to richest:

1. **A difficulty ramp within one loop** (speed / spawn rate / hazard density rises as you play) — the smallest way to "go somewhere".
2. **Escalating waves / rounds** (new hazard TYPES arrive in later waves, not just more) — deepens one screen without new scenes.
3. **Discrete levels / stages** (hand-built rooms, each teaching or combining a mechanic) — a real authored arc.
4. **Worlds / acts** (sustained progression across many levels, new mechanics unlocking) — the top of the ladder.

Each rung "goes somewhere" more than the one below; each also costs more to build and finish. WHICH rung a given game should reach is not universal, it depends on how much you can build and FINISH (a rough over-reach loses to a finished smaller arc). Pick the highest rung you can complete well.

## Originality: a method, not a menu

Novelty is a real design quality and it is the axis judges cap hardest. But it cannot be handed to you as a list of mechanics, if it were, every game would converge on the same listed idea and it would be the list-writer's creativity, not yours. So this section teaches a METHOD to GENERATE and then TEST your own idea. It deliberately lists NO example mechanics. (If you are editing this skill: do not add concrete example mechanics here. A listed lever becomes the answer every agent copies, run after run, the exact trap this framing exists to avoid.)

**Interrogate your idea (questions to ask about YOUR idea, not answers to copy):**

- What is the OBVIOUS version of this theme, the first thing anyone would build? (Name it, so you can avoid it.)
- Could you SUBVERT the expectation the theme sets, rather than meet it?
- Could you INVERT the role, act on the world instead of the avatar, or control the thing usually controlled against you?
- Could the CONSTRAINT itself become the mechanic, rather than a limit you work around?
- Could two unrelated ideas COMBINE into something neither is alone?
- Could you RECONTEXTUALISE a familiar mechanic into a setting that changes its meaning?

**The self-check (load-bearing).** Before you commit to an idea: name the obvious version of this theme; is your idea just that with a reskin? If a judge (or player) has almost certainly seen this exact game before, go again. Commit only to an idea that passes this check, then build it well, a fresh idea executed roughly beats a stale idea executed perfectly.
