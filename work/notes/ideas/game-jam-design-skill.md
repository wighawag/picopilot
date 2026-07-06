---
title: Split into TWO skills — a universal `game-design-reference` skill and a situational `game-jam` skill that composes it
slug: game-jam-design-skill
status: proposed
---

# Two skills, not one: universal `game-design-reference` + situational `game-jam`

> STATUS: design GRILLED and SETTLED (Q1-Q8, with the user). This note is now a build spec, not an open question. The "Open questions" section below is retained only as a record of what the grill RESOLVED.

## The observation that prompts this

Two forces converged across the benchmark runs:

1. **Originality is taught, not innate.** Un-nudged originality sat at 2/5; it only rose as the prompt taught a METHOD (think outside the box + a one-sentence self-check). We learned to teach a METHOD that makes the agent GENERATE ideas, not a MENU it shops from (the "too-leaning" trap: when the prompt listed concrete mechanics, the agent lifted one verbatim, so we were measuring the prompt-writer's creativity). Method-only framing transferred: the agent produced its OWN fresh idea and still scored 4/5 originality (90-92/100).

2. **The agent has real game-design blind spots a human catches instantly.** In the 50-minute "one button: Gravity Turns" run (92/100 from the judge) a human found two genuine design defects the agent shipped and never noticed:
   - a FORCED-LOSS state (trapped between two spikes, every gravity direction fatal — lose a life with no mistake); and
   - SUPERHUMAN difficulty (tuned against the agent's own frame-perfect `--input` scripts, unplayable at human reaction time).
   Both share one root cause: **the agent playtests as a frame-perfect machine and never models a human player.** Captured as two findings: `notes/findings/game-design-fairness-solvability.md` and `notes/findings/game-design-human-reaction-budget.md`.

The blind spots (2) are UNIVERSAL good-design knowledge (true of any game). The originality method + jam discipline (1) is SITUATIONAL (only meaningful under a jam's clock + theme + judging). Putting both in one skill would conflate durable design law with jam-specific tactics. So: split.

## The split (the decision)

**Invocation + naming (decided via `writing-great-skills`, grilled):**
- **`game-design-reference`** is a USER-INVOKED reference skill (`disable-model-invocation: true`), ALL-REFERENCE, leading-word-anchored. It is NOT in the context window every turn and is NOT autonomously fired on a vague "design" trigger. It is a SHARED BODY reached by a NAMED CONTEXT POINTER from other skills, the same way `ask-matt` points at `/writing-great-skills` and skills point at `GLOSSARY.md` / `work/protocol/*` (there is no "skill imported as a library"; composition = a pointer the agent follows to read the file). The name signals "shared body, reached by pointer, not a user entry point."
- **`game-jam`** is MODEL-INVOKED (fires on the deadline/theme/jam/benchmark trigger). Its BODY carries the pointer "read and apply `game-design-reference` throughout." `game-jam` is effectively the ROUTER that names the reference skill, so the human need not remember it. `make-game` (later) points at the same reference.
- Engine stance (Q1): `game-design-reference` states principles ENGINE-AGNOSTIC, as the SINGLE SOURCE OF TRUTH, using leading words. PICO-8 enforcement (30fps frame math, the playtest self-check procedure) is NOT inlined/duplicated; it is reached by pointer into the loop skills (`picopilot-debug`) where the ACTION lives.
- No description-overlap problem: only `game-jam` has a model-facing trigger.

**`game-design-reference` (universal).** The timeless principles true of ANY game, jam or not, with no notion of a clock or a theme. Reached by pointer whenever any skill is building any game with picopilot.
- Fairness / solvability: always a legal, non-losing move; no forced-loss / soft-lock states (finding: `game-design-fairness-solvability`).
- Human reaction budget: calibrate timing to ~200-300ms (~6-9 frames at 30fps); telegraph; never require frame-perfect reaction; don't tune against your own frame-perfect input (finding: `game-design-human-reaction-budget`).
- Readability / feedback, a sane difficulty curve.
- The VISIBLE-entities rule (draw what you `spr()`, or use primitives) — universal (a player should see the player); the benchmark's invisible-player lint enforces it.
- The originality METHOD as a general creativity discipline. Decided (Q5, grilled): ZERO concrete mechanics, ever, not even off-domain examples. The abstract moves (subvert / invert the role / make the constraint the mechanic / unexpected-combine / recontextualize) appear ONLY INTERROGATIVELY, as questions to ask about your OWN idea ("did you consider inverting the role?"), never as answers to copy. The LOAD-BEARING part is the SELF-CHECK the agent runs against its own idea ("name the obvious version of this theme; is your idea just that? if a judge has seen this exact game before, go again") — generative, not a menu. A CO-LOCATED caveat states WHY no mechanics are listed, so a future editor does not sediment them back in (the answer-menu trap: a skill is the SAME text every run, so a listed lever would make every game converge on it in perpetuity — worse than the one-time prompt leak we already corrected). (Novelty is universal good design; a jam just JUDGES on it — see below.)

**Content shape (Q4, grilled): both reference-first.** `game-design-reference` is PURE reference (a flat peer-set of principles, like `review` / `writing-great-skills`). `game-jam` is REFERENCE-FIRST with sharp, checkable COMPLETION CRITERIA baked into the phrasing ("a playable slice = boots + responds + has win/lose + verify green"); its phases (slice / deepen / triage) are NAMED REFERENCE the agent maps onto whatever clock it is given, NOT a rigid ordered step-sequence. Rationale: the harness (`run-jam.sh`) already owns wall-clock STEERING, so encoding the timed sequence as steps too would DUPLICATE it and could disagree; and outside the benchmark (a human doing a casual jam) there is no harness, so the skill must work WITHOUT assuming steering exists. Our actual failure mode was the OPPOSITE of premature completion (the agent idled too LATE), so the step-sequence's anti-premature-completion benefit does not apply.

**`game-jam` (situational).** ONLY what is specific to a jam and FALSE outside one. Composes `game-design-reference` (points at it, does NOT re-teach it), the same way it composes `picopilot-debug` (the run/playtest loop) and `picopilot-art`/`picopilot-audio` (asset loops).
- The CLOCK discipline: get to a playable slice in the first third; triage ruthlessly near the deadline; a rough playable game beats a broken ambitious one; scope tiny for the time you have.
- Working to a given THEME — and INTERPRETING that theme is the jam agent's OWN first move (Q5b, decided: "B"). The agent reads the bare theme and, guided by `game-design-reference`'s originality self-check, frames its own game. The benchmark prompt stays MINIMAL; the interpretation happens INSIDE the measured agent, so we keep measuring the agent's creativity, not an upstream prompt-generator's. (Rejected: an upstream "theme -> generated jam brief" stage in the benchmark path — it would reintroduce a creativity leak we would then have to discipline.)
- ORIGINALITY EMPHASIS: a jam is judged on a fresh take, so lean on the design skill's originality method hard and run the self-check under time pressure. (The method lives in game-design; the jam skill emphasizes and time-boxes it.)
- The SITUATED design calls under the clock: "you found an unfair forced-loss trap with 8 minutes left — fixing it beats adding a feature (a forced-loss state hurts the playability score more than a missing feature costs)"; "you tuned this level against your own frame-perfect --input script — that's the jam trap, budget a reaction margin before you call it done."
- Pointers into the loop skills (playtest to SEE it play; verify to gate).

**Where the ambiguous pieces land (decided with the user):**
- Originality METHOD -> `game-design-reference` (general creativity, zero mechanics, interrogative + self-check); jam EMPHASIS -> `game-jam`.
- Visible-entities rule -> `game-design-reference` (universal).

**Explicit scope boundary (decided): prompt-generation-from-a-theme is OUT OF SCOPE and lives OUTSIDE picopilot.** Expanding a seed/theme into a full jam brief is a general higher-layer agent workflow (like `from-idea` / `to-prd` are general work-contract skills, not picopilot features), NOT a picopilot capability, NOT a mode of `game-jam`, and NOT a benchmark pipeline stage. Noted here only so nobody later builds it into the harness.

## The no-degradation rule (the thing to hold)

The failure mode of extracting a shared skill is HOLLOWING OUT the specialized one into a thin "go read game-design, then hurry" pointer that loses its situational judgment. Guard against it:

- **`game-design-reference` owns the PRINCIPLE; `game-jam` owns the PRINCIPLE-UNDER-THE-CLOCK.** The jam skill does not re-teach WHAT fairness is; it teaches the JAM-TIME DECISION the principle forces (the situated calls above). That triage judgment is jam-specific and lives nowhere else.
- **Do NOT move jam content out.** Only stop the jam skill from RE-DERIVING universal principles; replace each with a one-line pointer + the jam-specific consequence. Net `game-jam` content should stay ~constant or GROW (it GAINS the fairness/reaction triage calls), never shrink.
- **The acceptance test is a jam run, with a CRISP criterion (Q7, grilled):**
  - **PRIMARY (the hypothesis): does the agent apply the design lenses UNPROMPTED?** In the jam session, does the agent explicitly run the fairness self-check (test hazard-avoidability, not just reachability) and/or the reaction-budget check (question whether a human could clear a level it tuned with frame-perfect input), AND fix at least one real issue it finds? This is OBSERVABLE IN THE SESSION LOG, independent of the final score, and directly tests the root-cause fix (the agent playtesting as a frame-perfect machine).
  - **SECONDARY (the no-degradation guard): no regression.** The jam skill was not hollowed out: the agent still gets to a slice fast, still triages, and the score stays in the band of our best single-prompt runs (~90/100). A HIGHER score is NOT the success signal (the judge caps originality; score is noisy).
  - **n > 1 if ambiguous.** One run is suggestive, not conclusive (stochastic); if the first run is ambiguous, run 2-3 times to separate signal from variance.
  - **The harness steering stays GENERIC; the design lenses live ONLY in the skill (Q7b, decided).** `run-jam.sh`'s steering reminders stay "stop adding features, confirm playable" and must NOT mention fairness / human-playability. If the harness supplied the lens, a pass would prove nothing about whether the SKILL transferred (same measurement-honesty discipline as the originality nudge: never let the harness do the skill's job).

## Packaging + the prompt's fate (Q8, grilled)

- **Home.** Ship BOTH skills from the picopilot package (where the game work + benchmark live), like `picopilot-audio`/`picopilot-debug`/`picopilot-art`. `game-design-reference`'s CONTENT is engine-agnostic even though it is PACKAGED with picopilot; packaging-location and content-scope are separate concerns. Promote it to a standalone skill later IF a non-picopilot consumer appears — do not over-engineer the home before a second consumer exists.
- **`bench/game-jam/prompt.md` shrinks to a MINIMAL brief** ("build an original, playable game on theme X in N minutes; deliverable is main.p8 + JAM.md") that RELIES on the skills rather than teaching. It NAMES the skill ("this is a jam, use your game-jam skill") — the benchmark tests the skill's CONTENT, not the invocation trigger, so we don't want a run to silently fail because the trigger didn't fire.
- **Invisible-player GUIDANCE moves to `game-design-reference`** (matches Q1 "visible-entities -> game-design"); the prompt stops teaching it. **`check-playable.sh` STAYS in the harness** — it is an OBJECTIVE gate, not guidance, and catches the class regardless of what the agent read. Guidance -> skill; enforcement -> harness lint.

## Why this also fixes the "last 30% plateau"

In the 50-minute run the agent self-declared done at ~36 min and idled ~14 min, NOT because the game was optimal but because it couldn't SEE what to improve — yet the two design defects prove concrete work remained. Giving the agent the design LENSES (game-design's fairness + reaction checks) should let it FIND that work in the last third. So the plateau and the design skill are the same problem: the fix is not a shorter budget, it's better lenses.

## What the grill RESOLVED (record)

- **Q1 engine stance:** `game-design-reference` engine-agnostic, all-reference, single-source-of-truth; PICO-8 enforcement reached by pointer into the loop skills, not inlined.
- **Q2/Q3 invocation + naming:** `game-design-reference` is USER-INVOKED (reference body reached by named pointer, zero context load, no description-overlap); `game-jam` is MODEL-INVOKED and points at it. Name chosen: `game-design-reference` (not `game-design` / `picopilot-game-design`).
- **Q4 content shape:** both reference-first (see the dedicated section above).
- **Q5 originality:** METHOD not menu; ZERO concrete mechanics; interrogative moves + a load-bearing self-check; co-located caveat against re-adding examples.
- **Q5b theme interpretation:** "B" — the jam agent interprets the bare theme itself; no upstream prompt-generator in the benchmark path. Prompt-generation-from-a-theme is OUT OF SCOPE / outside picopilot.
- **Q6 prose vs tooling:** both self-checks PROSE NOW; the FAIRNESS-PROBE (drive every rest state, assert a non-fatal move exists, exit nonzero on a forced-loss pocket) is the LEAD TOOLING CANDIDATE, built ONLY IF the jam run shows prose gets skipped (fairness is enumerable/automatable; reaction-budget is fuzzier and likely stays prose). Rhymes with the replay feature; could share the drive-transform (ADR-0011).
- **Q7 acceptance test:** PRIMARY = the agent applies the fairness/reaction self-check UNPROMPTED and fixes a real issue (log-observable); SECONDARY = no regression, score in the ~90 band; n>1 if ambiguous; harness steering stays GENERIC so a pass proves the SKILL transferred.
- **Q8 packaging + prompt:** both ship from the picopilot package; `prompt.md` shrinks to a minimal brief that NAMES the skill; invisible-player GUIDANCE moves to `game-design-reference`, `check-playable.sh` lint STAYS in the harness.

## When to pick it up

Now (post the 50-minute run). Next concrete step per the user: do the skill-method pass + a fresh jam run to test whether the design lenses fill the last-30% plateau. The replay feature is a SEPARATE product idea captured alongside.
