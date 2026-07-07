# A budget-relative "build progression" nudge makes the agent produce real content (levels/mechanics), not just polish

Spotted: 2026-07-07, experiment run before designing budget-tier skills.

## The gap this tests

The first three 50-minute "one button" runs (FLIPRUN 92, REVOLVE 90, FLIP 91) all shipped SHORT single-session games (win in ~30s-1min), then spent the back half POLISHING (juice, audio, fairness verification) rather than adding PROGRESSION. FLIPRUN even idled its last ~14 minutes. So the agent used surplus time to make a short game more FINISHED, not a bigger/deeper game. The user's read: 50 min should buy progression (more content, a real difficulty arc, maybe levels), and the right ambition is BUDGET-RELATIVE (3-min != 50-min != 24h) -- a 3-min jam SHOULD stay one-screen; a longer one should reach further.

Standing rule the user set: run the cheap experiment BEFORE building skill structure, to learn whether this is a WORDING gap (agent doesn't reach for progression) or a CAPABILITY gap (can't produce good progression even when told).

## The experiment

A 50-min "one button" run with a single METHOD-LEVEL nudge injected into the prompt (not the committed prompt; a temp variant, restored after). The nudge named the GOAL, not the answer: "scale ambition to the time; once you have a playable slice, spend the BULK of remaining time on PROGRESSION and CONTENT (a game that goes somewhere: escalating stages/levels, new mechanics introduced over the playthrough, a real difficulty arc), NOT only polish; you decide what progression means for your idea." No specific mechanics or level designs were supplied (avoiding the answer-menu trap).

## Result: clear WORDING gap, not a capability gap

The agent produced a genuinely bigger, deeper game ("BEACON HOP", charge-jump platformer, 93/100), and notably at ~2088 tokens vs the ~1300-1400 of the three polish-only runs (~50% more code):

- **10 hand-built levels**, each "introducing a NEW mechanic rather than more of the same."
- **Three mechanics unlocked over the playthrough** (moving platforms, bounce pads, optional gems) with a documented difficulty arc (1-4 core, 5-6 movers, 7-8 bounce, 9-10 combined + a peak gauntlet).
- A completion/scoring layer (3-star rating, timer, death count, gems) for replay value.

Crucially, progression COMPOSED with the design lenses rather than displacing them: it still drove every level 1-10 in playtest for fairness ("no dead state by construction"), applied the reaction budget ("no frame-perfect windows; plan on prediction"), and applied the DIFFICULTY-CURVE principle to its own progression -- it caught and softened two mechanic-introduction levels that tested a new mechanic under pressure on first contact ("each new mechanic gets a gentle first contact before it is combined with hazards"). And it chose its OWN progression (levels + 3 mechanics + stars), not a copied menu, so the nudge stayed method-level.

## Implication for the design (tier skills)

CAPABILITY is there: given a budget-relative "build progression" framing, the agent produces real content, deepens rather than feature-creeps, and keeps the design discipline. So the fix is FRAMING, which is exactly what a skill can carry. This green-lights the user's proposed design: budget/ambition TIERS (extra-short ~3-10min / short ~1h / medium ~24-48h / long-running 48h+), each an AMBITION PROFILE (time band = a hint, not a hard line; the agent still respects the exact clock but frames ambition by tier), with progression scaling up across tiers. A generic jam skill holds the budget-invariant core; the tiers layer the ambition framing, composing with game-design-reference the same shared-reference way. Next: grill that design (tier as separate skill file vs section vs parameter; who picks the tier; where progression-vs-difficulty-curve lives).

## Small-end confirmed (2026-07-07): the agent self-scopes tiny at 3 min with the plain prompt

Ran the OTHER half: a 3-minute "one button" run with the PLAIN committed prompt (no nudge). Result: "ORBIT FLIP", a tiny one-screen game (445 tokens -- the smallest of every run; 90/100), one mechanic, win-at-20 / lose-at-0. It explicitly chose to stay small ("SLICE: built one screen, one button"; "TRIAGE: kept scope to a single tight loop"), added a difficulty RAMP within the one loop (speed + spawn + bomb ratio scale with score) rather than levels -- the right KIND of progression for the budget -- and still ran the design lenses (no dead state, reaction budget, readability). No levels, no over-scoping.

So BOTH ends are now evidenced:
- 3-min plain -> tiny, correctly self-scoped (445 tokens).
- 50-min plain -> short game + heavy polish, UNDER-uses the time (~1300 tokens).
- 50-min + progression nudge -> real progression: 10 levels + 3 mechanics + star rating (2088 tokens).

Implication sharpened: the small tier ALREADY behaves (no suppression needed; it stays tiny on its own). The tier skill's job is ASYMMETRIC -- it mainly needs to ADD ambition framing at the LARGER tiers (progression/levels), while the extra-short tier can essentially match today's game-jam behaviour. That simplifies the design: tiers are an ambition LADDER that the generic game-jam sits at the bottom of, not a set of equal-weight variants.

## Mismatch-robustness confirmed (2026-07-07): the clock wins on structure, the framing wins on intent

Ran the adversarial probe: forced the SAME 50-min "LONGER jam, build progression" nudge (which literally says "not a 3-minute sprint") into a 3-MINUTE run, a deliberately mismatched tier. Outcome: ROBUST, and smart. "ORBIT" (92/100, 998 tokens -- between the plain-3min 445 and the plain-50min 1300):

- The agent did NOT blindly obey and try to hand-build 10 levels in 3 minutes (which would have shipped broken). It "kept to one screen and one verb."
- But it DID honour the framing's INTENT in a budget-appropriate form: 8 waves with a 3-tier hazard-TYPE progression (static -> drifting -> pulse spikes) + speed/density ramp. Real "a game that goes somewhere," delivered as escalating WAVES within one screen rather than hand-built LEVELS.
- Shipped finished + fair (verify green, no dead state, reaction budget), 92/100. Not rushed, not broken.

So a mismatched over-ambitious framing is SELF-CORRECTING: the agent reconciles "build big progression" + "you have 3 minutes" into "escalating waves" -- the clock wins the STRUCTURAL call (one screen, no levels) while the framing's INTENT (make it deepen) is honoured in a finishable shape.

Design consequence: a WRONG tier is not catastrophic (no broken ship), which LOWERS the stakes on "who picks the tier" -- the agent's own clock-awareness is a safety net. It also suggests the tier framing should express AMBITION/INTENT ("make it go somewhere, scaled to your time") and let the agent choose the FORM (ramp vs waves vs levels vs worlds), rather than prescribing "build N levels" -- prescribing a form is exactly what could break a mismatched run, whereas intent-framing degrades gracefully. This is the same method-not-menu discipline that governs originality.
