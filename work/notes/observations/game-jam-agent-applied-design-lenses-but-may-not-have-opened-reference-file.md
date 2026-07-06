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

## MECHANISM CONFIRMED (probes, 2026-07-06)

Ran two direct `pi --skill` probes with a fresh agent, no session:

- A `disable-model-invocation` skill's body is **NOT auto-injected** into context, not even its description. Probe: "from context only, what is game-design-reference's fairness self-check?" -> **"NOT IN CONTEXT"**. So the agent must be given the name AND actively open the file to get ANY of its content.
- A model-invoked skill (`game-jam`) has **only its DESCRIPTION** in context by default ("DESC ONLY"); its BODY is reached by the agent reading SKILL.md after it decides to fire.

Combined with a FULL FLIPRUN session audit (every tool call, not just a narrow grep): the agent used only bash/edit/read/write (no skill-load tool exists), read `game-jam/SKILL.md` / `picopilot-code/SKILL.md` / `picopilot-overview/SKILL.md`, and NEVER read `game-design-reference/SKILL.md`. `game-design-reference` appears exactly ONCE in the whole 584-message session, in an early toolResult (the skill-system listing that surfaces the skill's NAME), never in an agent read of its body. This CONFIRMS possibility (2): `game-design-reference`'s specific content did NOT reach the agent. The run's fairness/reaction depth came from (a) the PROMPT naming the four concepts, (b) `game-jam`'s OWN inline "situated design calls" section (which itself mentions dead-state + frame-perfect), and (c) the agent's priors, NOT from the reference body.

**This is a real architecture gap: the single-source-of-truth reference body is not reliably reaching the agent.** The reach-by-pointer chain (`game-jam` body says "read and apply game-design-reference throughout") was followed in SPIRIT (concepts applied) but not in FACT (file never opened). The reference's SPECIFIC procedures (enumerable hazard-avoidability, interrogative originality moves, 6-9-frames-at-30fps math) were never in context.

Implication for the design: EITHER
- (i) strengthen `game-jam`'s pointer so it EXPLICITLY instructs the agent to OPEN/READ `game-design-reference` (an imperative "read the file at <path>", not just "apply it"), OR
- (ii) accept that the load-bearing situated content must live IN `game-jam` (inline), and treat `game-design-reference` as a deeper optional reference, which weakens the single-source-of-truth rationale for the split, OR
- (iii) make `game-design-reference` model-invoked after all (so at least its description is in context and the agent can fire it), trading the per-turn context cost we deliberately avoided.

The original grill (Q2/Q3) assumed "reach by pointer" would deliver the body the way `ask-matt` -> `/writing-great-skills` does; these probes show a bare in-body mention is NOT sufficient to make the agent open a user-invoked skill. Needs a design decision (re-grill this rung).

## FULL MECHANISM, verified against pi source + isolated probes (2026-07-06)

Read pi source (`~/dev/github/wighawag/pi`, `packages/coding-agent/src/core/package-manager.ts` ~L2276-2320, `resource-loader.ts`). pi discovers skills from: `~/.pi/agent/skills` (global agent dir), `<cwd>/.pi/skills` (project-local, `CONFIG_DIR_NAME=.pi`), and `~/.agents/skills` + ancestor `.agents/skills` (all THREE of the latter gated on `projectTrusted`, which `--approve`/`-a` sets; defaults true). Our earlier `--skill <dir>` loads skills as EPHEMERAL top-level, and a bare cwd `.agents/skills` is NOT discovered unless trusted.

Probed all this ISOLATED (temp dirs, never touching real `~/.agents/skills` or `~/.pi/agent/skills`), installing into `<tmp>/.pi/skills` + `--approve`:

- A `disable-model-invocation` skill (`game-design-reference`) is, even when properly registered + trusted: NOT in context (body absent), and NOT EVEN LISTED as an available skill to the model. It is only ever *mentioned by name* via `game-jam`'s description. Registration does NOT change this vs `--skill`, the flag is `disable-model-invocation`, not the discovery path.
- A model-invoked skill (`game-jam`): only its DESCRIPTION is in context; body reached by the agent reading SKILL.md.
- **There is NO "load skill by name" tool in pi.** When explicitly told to use `game-design-reference`, the agent reached it by `find`/`grep`-ing the filesystem for the name, then `read`-ing `.pi/skills/game-design-reference/SKILL.md` directly. It CAN get the exact content this way, but only via filesystem archaeology, not a first-class skill-load.

**Bottom line: the reach-by-pointer chain requires the agent to (a) care enough to go looking and (b) filesystem-hunt for a file it knows only by name.** In FLIPRUN it did neither (game-jam's inline content + the prompt's concept words sufficed), so `game-design-reference`'s specific body never reached it. This is a fragile seam regardless of registration path. The re-grill must pick among: strengthen game-jam's pointer to an IMPERATIVE "read the file at <resolvable path>"; move the load-bearing situated content INLINE into game-jam (demoting game-design-reference to optional deep reference); or make game-design-reference MODEL-INVOKED (accept per-turn description cost so it is at least listed + auto-fireable).

## CORRECTION: it was our POINTER WORDING, not a pi limitation (verified 2026-07-06)

Before reframing the whole architecture, checked how Matt's shipped skills compose (`~/.agents/skills`) and A/B-tested pointer wording on BOTH pi and Claude Code, isolated (temp dirs; cleaned up after, incl. a stray `~/.claude/plans/` file Claude dropped).

1. **Matt's skills DO autonomously compose `disable-model-invocation` skills.** `orchestrate` (user-invoked) composes `drive-tasks` (user-invoked) with the wording: `` `drive-tasks` (`skills/drive-tasks/`) — you load and FOLLOW it``. Every cross-ref in orchestrate/drive-tasks is the SAME shape: backtick name + an EXPLICIT skill-folder PATH + an IMPERATIVE verb (load / FOLLOW / apply / compose). So Matt relies on "the agent READS the referenced skill's file and follows its prose", exactly pi's blessed mechanism (`skills.ts` injects: "Use the read tool to load a skill's file... resolve a relative path against the skill directory"). He is NOT relying on a feature pi lacks; he relies on POINTER DISCIPLINE.

2. **Our game-jam pointer was too weak.** We wrote a bare `` `game-design-reference` `` + "read and apply throughout" — no path, weak verb. Rewrote it to Matt's shape (`../game-design-reference/SKILL.md`, "LOAD AND FOLLOW at the START") and re-probed pi: the agent RELIABLY resolved the sibling path against the skill dir, read the reference, and quoted its hazard-avoidability bullet verbatim. So **pi CAN do autonomous skill-to-skill composition; the FLIPRUN skip was our wording, not a pi defect.**

3. **Claude Code vs pi (the "is pi defective" question), answered:** BOTH exclude a `disable-model-invocation` skill from the model-invocable list identically (both implement the agentskills.io convention pi's source cites), so that is a SHARED STANDARD, not a pi defect. The difference is DILIGENCE: Claude Code followed even the WEAK original pointer and read the reference in full; pi (in FLIPRUN) skipped the same weak pointer. So Claude Code's agent chases a vague pointer more readily; pi's agent needs the explicit-path + imperative to reliably do the read. Fixing the wording makes it robust on BOTH.

**Revised implication:** the split's core assumption (autonomous reach-by-pointer) is SOUND on pi after all, IF the pointer follows Matt's discipline (backtick name + explicit resolvable path + imperative load-and-follow). That REVIVES the option we had written off, and the resource-file option is now a SEPARATE, orthogonal choice (about single-source-of-truth + reuse), not a forced fix for a broken mechanism. The re-grill picks among: (A) keep game-design-reference as a skill but FIX the pointer to Matt's shape; (B) demote it to a `references/` resource file inside game-jam (relative-path read, copy-on-publish to other skills via the existing copySkillResources seam); (C) inline into game-jam. All three now WORK; the choice is about reuse + duplication, not capability.

## Follow-up (cheap experiments to disambiguate)

- Check whether `pi --skill` AUTO-INJECTS a user-invoked (`disable-model-invocation`) skill's body into context, or only makes it reachable-on-demand. (Determines whether reach-by-pointer is implicit-load or explicit-open.)
- Run a variant where the prompt does NOT name the four concepts (only "use your game-jam skill"), and see whether the agent still reaches the fairness/reaction lens. If yes, the skill path carries it; if no, the prompt's concept-naming was load-bearing and belongs either in the prompt permanently or more forcefully in game-jam's pointer wording.
- Consider strengthening `game-jam`'s pointer so it EXPLICITLY tells the agent to OPEN/READ game-design-reference (not just "apply it"), if we want the reference file's specific self-checks guaranteed in context.

This is a signal about skill mechanics, not a defect: the run is a clear success. But "did the reference BODY reach the agent, or just its concept words?" is the open question that decides how much the split's single-source-of-truth actually bought us.
