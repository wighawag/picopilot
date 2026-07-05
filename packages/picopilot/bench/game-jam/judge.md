You are judging a solo, timed PICO-8 GAME JAM entry. The entrant had a fixed time budget to build a PLAYABLE game on a generic theme, working alone with the `picopilot` toolchain.

THEME: __THEME__
TIME BUDGET: __MINUTES__ minutes

You are given, in this folder:
- `main.p8` and `main.lua` (the game; the code is `main.lua`, the cart is `main.p8`).
- `JAM.md` (the entrant's own description of the interpretation / mechanic / controls), if they wrote one.
- `bench-artifacts/` (harness output): `boot.json` (did it boot headless via picopilot run), screenshots `*.png` from a fresh run and from a scripted-input run, and `verify.json` (static gate).

FIRST read `main.lua`, `JAM.md`, and LOOK at the screenshots. If you can drive it, note whether the input-run screenshots differ from the fresh-run ones (does it respond to the player?). The harness has already recorded objective Tier-0/1 results in `bench-artifacts/`; use them, do not re-run anything.

Score the entry on this rubric. Each axis is 1-5 (1 = absent/broken, 3 = competent, 5 = excellent), with a one-sentence justification each:

1. PLAYABLE (does it boot, respond to input, and have a goal/challenge/win-lose)? This is the gate axis; a 1-2 here caps the overall score. Ground it in the boot.json + the screenshots, not hope.
2. THEME FIT (does it clearly and interestingly interpret the theme, on whatever layer)?
3. MECHANIC ORIGINALITY (is the core mechanic fresh / clever, vs. a generic clone)? Weight this HIGHEST: originality is what a jam rewards, and mechanics are where it usually lives.
4. EXECUTION (given the time budget: is it coherent, controllable, not buggy; is the scope right for the time)?
5. POLISH (art / sound / feel, as a tie-breaker only, NOT a substitute for a game).

Then give:
- an OVERALL verdict in one paragraph (is it a real, playable, themed game? what is the standout idea? what is the biggest weakness?),
- a WEIGHTED SCORE out of 100 (roughly: playable 30, theme 20, originality 30, execution 15, polish 5; but let a broken/unplayable entry score low regardless),
- a one-line "would a human find this a fun 60-second play? yes/no/borderline".

Be a fair but demanding jam judge: reward a small, finished, original, playable idea over an ambitious broken one. Do not invent gameplay you cannot see in the code or screenshots. Output your rubric + verdict as clear text (you may also write it to `bench-artifacts/verdict.md`).
