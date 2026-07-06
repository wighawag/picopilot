# game-jam agent applied the design lenses deeply, but may not have OPENED game-design-reference as a file

Spotted: 2026-07-06, inspecting the first 50-minute "one button" jam run WITH the new `game-jam` + `game-design-reference` skills (bench/out/one-button-20260706-193039, score 93/100).

## The strong positive (the experiment's primary criterion PASSED)

The agent applied the fairness + reaction-budget lenses UNPROMPTED and deeply, exactly the root-cause fix the split was built for. In the session it referenced "dead state" ~50 times, plus reaction-window/budget, self-check, hazard-avoidability; it did NUMERICAL reaction-window audits (first spike ~2.2s, tightest opposite-side gap 33 units / ~0.59s at d=790, ~2.4x the ~0.25s human floor) instead of tuning against its own frame-perfect input; and it ran a "whole-track fairness audit" (instrumented the actual generated track with printh, sorted every spike, proved no dead state by construction). It used printh/playtest instrumentation 84 times to PROVE fairness rather than eyeball it, and a lens-driven final read caught + fixed a real combo bug. The two defects from the previous run (a dead state; superhuman frame-perfect tuning) were both explicitly designed OUT this time.

The harness steering stayed GENERIC (no fairness/reaction words in the between-turn reminders), so the lens came from the skill path, not the steering (Q7b held).

## The nuance worth watching

The agent explicitly READ `game-jam/SKILL.md` as a tool call, but did NOT separately read `game-design-reference/SKILL.md` as a file (only game-jam, picopilot-code, picopilot-overview appear as `read` tool calls on skill files). Yet it operationalized game-design-reference's concepts richly.

Two possible mechanisms, and they matter for the architecture:
1. The skill system AUTO-LOADED `game-design-reference`'s full content into context (it is discoverable via `pi --skill <dir>`), so the agent never needed to open the file, the reach-by-pointer worked implicitly. OR
2. The agent worked from `game-jam`'s pointer + the FOUR concept words the initial prompt happens to name ("fairness, human reaction budget, visibility, readability") + its own priors, WITHOUT ingesting game-design-reference's specific self-checks (the enumerable hazard-avoidability procedure, the interrogative originality moves, the 6-9-frames-at-30fps math). If so, the depth we saw came partly from the agent's own competence and the prompt's four words, not provably from the reference body's exact content.

Why it matters: the whole point of `game-design-reference` as a SINGLE SOURCE OF TRUTH reached by pointer is that the reference's SPECIFIC content (not just its headline concepts) reaches the agent. If (2), then a leaner prompt that did NOT name the four concepts might see the agent NOT reach the lens at all, i.e. the skill's reach-by-pointer would be doing less work than it appears, and the prompt's concept-naming would be load-bearing. The current run cannot distinguish (1) from (2) because the prompt names the concepts AND the skill is loaded.

## Follow-up (cheap experiments to disambiguate)

- Check whether `pi --skill` AUTO-INJECTS a user-invoked (`disable-model-invocation`) skill's body into context, or only makes it reachable-on-demand. (Determines whether reach-by-pointer is implicit-load or explicit-open.)
- Run a variant where the prompt does NOT name the four concepts (only "use your game-jam skill"), and see whether the agent still reaches the fairness/reaction lens. If yes, the skill path carries it; if no, the prompt's concept-naming was load-bearing and belongs either in the prompt permanently or more forcefully in game-jam's pointer wording.
- Consider strengthening `game-jam`'s pointer so it EXPLICITLY tells the agent to OPEN/READ game-design-reference (not just "apply it"), if we want the reference file's specific self-checks guaranteed in context.

This is a signal about skill mechanics, not a defect: the run is a clear success. But "did the reference BODY reach the agent, or just its concept words?" is the open question that decides how much the split's single-source-of-truth actually bought us.
