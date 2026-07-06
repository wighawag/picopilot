---
title: Game-design fairness — a game must never enter a state where every action is a forced loss
slug: game-design-fairness-solvability
source: 'Game-design literature on balance/solvability, cross-checked against the "one button: Gravity Turns" jam entry where a real forced-loss state was observed by a human playtester (2026-07-06). Web sources: Wikipedia "Game balance" (solvability); CEUR-WS "Game Balancing — A Semantical Analysis" (Vol-2486): "The player perceives fairness by always being able to win, even after early [mistakes]"; r/gamedesign "Solvability and Game Design".'
---

# Fairness / solvability: the player must always have a legal, non-losing move

## The principle

A game is UNFAIR when it can enter a state the player did nothing wrong to reach, from which EVERY available action leads to a loss. Fairness, as perceived by players, is grounded in "always being able to win, even after an early setback": the player must always retain at least one legal move that does not force a loss. A death the player could not have avoided (a forced-loss / soft-lock / no-win state) reads as the GAME cheating, not as the player failing, and it tanks perceived fairness far more than a hard-but-fair challenge does.

This is distinct from DIFFICULTY. A hard game is fine; an UNFAIR game punishes the player for the game's own design gap. The test is not "is it hard" but "from every reachable state, does the player have a non-losing option?"

## The concrete failure that surfaced this (the "trapped between two reds")

In the jam entry "one button: Gravity Turns", the only control is a discrete gravity rotation (4 directions: down/left/up/right). Spikes are static boxes; the ball clamps ~6px from each wall. Nothing in the code guaranteed that from every position the ball can settle into, at least one of the 4 gravity directions leads somewhere non-fatal. So the ball could drift into a pocket where all four "downs" push it into a spike: ZERO legal moves, a guaranteed life-loss with no player mistake. A human immediately identified it as bad design ("you cannot do anything but lose a life without having done anything wrong").

Root cause worth naming: the agent playtested the game with FRAME-PERFECT scripted input and verified only COIN REACHABILITY ("can I, the machine, reach the coins?"). It never verified the DUAL property: HAZARD-AVOIDABILITY from every rest state ("from anywhere the player can end up, is at least one move non-fatal?"). Reachability alone is not fairness.

## The self-check an agent can actually run

When a game has HAZARDS + LIMITED control (few discrete actions), verify BOTH properties, not just reachability:

1. **Goal reachability** — from the spawn/rest states, some sequence of actions reaches the objective.
2. **Hazard avoidability (the one that gets skipped)** — from EVERY state the player can settle/rest into, at least ONE available action is non-fatal. If a resting position exists where all actions force a loss, that is a soft-lock / forced-loss state — a fairness DEFECT, fix the level geometry (widen exits, move the hazard, add a safe lane) so no such pocket exists.

For a discrete-control game this is enumerable: for each rest state, try each action, and assert not-all-fatal. An agent CAN do this with the playtest loop (drive the ball into corners/pockets, then try each action and check it does not force a hit) — it just has to think to.

## Why this belongs in a UNIVERSAL game-design skill (not the jam skill)

Fairness/solvability is true of ANY game, jam or not. It is a property of good design, independent of a clock or a theme. The JAM skill's job is only the situated call ("you found an unfair trap with 8 minutes left — fixing it beats adding a feature, because a forced-loss state hurts the playability score more than a missing feature costs"). The LAW lives in game-design; the under-the-clock DECISION lives in game-jam.
