# Jam Verdict: "ONE BUTTON: Gravity Flip Runner"

THEME: one button | TIME BUDGET: 3 minutes

## Objective harness facts
- `boot.json`: booted headless, exit reason `sentinel` (clean). Cart runs.
- `verify.json`: static gate PASS (integrity + tokens). 390 / 8192 tokens.
- `playable.txt`: PLAYABLE-CHECK ok (no invisible-player lint failure).
- Screenshots: all 6 (3 fresh + 3 scripted-input) show the SAME title screen. The input run did not visibly advance past the title in the captured frames.

## Rubric (1-5)

1. **PLAYABLE - 4.** It boots cleanly, the player is a `circfill` ball (never invisible, lint ok), and the code has a full loop: title -> play -> death -> retry, with a scoring goal and floor/ceiling/spike death conditions. Docked one point because the scripted-input screenshots never left the title screen, so responsiveness is proven by reading the code (`btnp(4)` starts/flips/retries) rather than seen in the shots; the harness captured no live gameplay frame.
2. **THEME FIT - 5.** Textbook literal fit: the entire game is one button. One press starts, flips gravity, and retries; there is genuinely no other input, and the flip mechanic makes "one button" the core verb rather than a gimmick.
3. **MECHANIC ORIGINALITY - 2.** Gravity-flip one-button runner is one of the most common one-button jam patterns (VVVVVV-style flip + endless-runner spikes); it is clean and correct but not a fresh idea, and nothing twists the familiar formula.
4. **EXECUTION - 4.** Tight, coherent, scope-appropriate for 3 minutes: velocity/gravity integration, score-scaled speed ramp, spawn timer, collision window at the player's x, and all three game states handled with a retry. Minor: collision uses a fixed x-window and the difficulty curve is untested live, but nothing looks buggy.
5. **POLISH - 3.** Solid readable primitives-only art, a gravity-direction arrow on the ball for feedback, a flip SFX (slot 0), and clear title/HUD framing; no music, no particles, no juice beyond the blip.

## Overall
This is a real, themed, playable game: it boots clean, stays well under budget, and implements a complete title-play-die-retry loop around a single button that flips gravity to weave through scrolling spikes. The theme fit is exemplary (one press does literally everything) and the execution is disciplined for a 3-minute build with a difficulty ramp and feedback arrow. The standout is not the idea but the finish: it is small, coherent, and shipped. The biggest weakness is originality: gravity-flip one-button runner is a well-worn jam archetype with no distinguishing twist. Secondary caveat: the harness's scripted-input screenshots never advanced past the title, so live responsiveness is inferred from correct, simple code rather than demonstrated in a gameplay frame.

## Weighted score: 74 / 100
(Playable ~26/30, Theme 20/20, Originality ~12/30, Execution ~12/15, Polish 3/5.)

## Fun for a 60-second play? **Borderline-yes.** The loop is instantly graspable and the flip-through-spikes tension works, but it is a familiar mechanic, so novelty runs out fast.
