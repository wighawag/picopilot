---
title: A picopilot-game-jam (or game-design) skill carrying the jam-originality method, so the benchmark prompt stays minimal
slug: game-jam-design-skill
status: proposed
---

# A game-jam / game-design skill (move the originality method out of the prompt)

## The observation that prompts this

Across every "one button" benchmark run, the agent's UN-nudged originality sat at 2/5 ("well-worn template") and only rose when the prompt taught it how to be original:

- add "combine two familiar mechanics" -> the agent combined the two most OBVIOUS mechanics -> originality 3/5 (86/100).
- broaden to a menu (subvert / invert-the-role / constraint / unexpected-combine, WITH concrete example mechanics) -> the agent lifted "invert the role: control the environment not the avatar" almost verbatim ("you control the shadow, not the jumper... you're the level, not the avatar") -> originality 4/5 (88/100).

Two signals:
1. The agent does NOT reach for originality on its own; it needs the method taught.
2. When the prompt listed CONCRETE example mechanics, the agent could shop from the list, so the benchmark risked measuring the PROMPT-WRITER'S creativity, not the agent's ("is the prompt too leaning if it did exactly what you nudged?"). We since stripped the concrete examples back to pure method-framing (think outside the box / break convention + a one-sentence self-check).

## The idea

Put the DURABLE originality/design METHOD in a skill (e.g. `picopilot-game-jam` or a broader `game-design` skill the agent loads on demand), NOT in the benchmark prompt. Then:

- The benchmark prompt stays MINIMAL ("make an original, playable game on this theme in N minutes"), so it measures the agent + its skills, not bespoke prompt engineering baked into one harness.
- The method lives once, versioned, reusable by any agent doing PICO-8 game work with picopilot (not just the benchmark), the same way `picopilot-audio` / `picopilot-debug` carry hard-won workflow knowledge.
- It composes with the existing skills: `picopilot-debug` (the run/playtest loop), `picopilot-art`/`picopilot-audio` (the asset loops), and this one for the DESIGN/idea loop.

## What the skill would carry (sketch, to be grilled)

- The originality METHOD as transferable heuristics (subvert the expectation, invert the role, make the constraint the mechanic, combine unexpected mechanics, recontextualize), phrased as a THINKING method with the self-check, and framed so an agent GENERATES rather than picks-from-a-list (the concrete-example trap we just hit).
- Jam discipline: scope tiny (one screen/mechanic/goal), get to a playable slice in the first third, triage ruthlessly near the deadline, a rough playable game beats a broken ambitious one.
- The "player + entities must be VISIBLE" rule (draw what you `spr()`, or use primitives), which the benchmark's invisible-player lint enforces.
- Pointers into the loop skills (playtest to SEE it play; verify to gate).

## Open question for the grilling

Does teaching originality in a skill just relocate the "too-leaning" problem (now the SKILL supplies the ideas)? Probably not, if the skill teaches a METHOD to generate ideas + a self-check, rather than a menu of ready-made mechanics; but the line between "method" and "answer menu" is exactly what to get right (it is why the benchmark prompt now avoids concrete example mechanics). Worth a design pass before building. Also decide: a narrow `picopilot-game-jam` skill vs. a broader reusable `game-design` skill.

## When to pick it up

When the benchmark work settles (post the 50-minute run) or when game-design guidance is wanted outside the benchmark. For now the method lives (minimally) in the benchmark prompt; this idea is the durable home.
