# Jam Verdict: FLIPRUN

Theme: **one button** | Time budget: 50 min

## Objective gates (from harness)
- `boot.json`: clean boot, exit reason `sentinel` (no fault).
- `verify.json`: pass, integrity + tokens OK, **1351 / 8192 tokens (16%)**.
- `playable.txt`: `PLAYABLE-CHECK: ok` (no invisible-player defect).
- Screenshots: title card renders (f0); live gameplay (play0-2) shows the **blue player blob with visible eyes** riding the floor band, filling progress bar, HUD (`X/O FLIP`, `SCORE`), parallax starfield, and a **red spike** rising from the floor ahead in play2. Player is unambiguously visible.

## Rubric

**1. PLAYABLE - 5/5.** Boots cleanly, the controllable entity is plainly visible in every gameplay shot, and there is a real goal (fill the bar / reach the goal distance) with clear win (reach goal) and lose (touch spike) states plus retry; gate is fully cleared.

**2. THEME FIT - 5/5.** "One button" is interpreted literally (a single flip input) and thoughtfully: the press changes the *world's rule* (gravity) rather than firing the avatar, and the theme is even reinforced on-screen via the `X/O FLIP` HUD label and gravity-encoded player colour.

**3. MECHANIC ORIGINALITY - 4/5.** Gravity-flip runner is a fresh, decision-driven take on the one-button jump (each press is "which surface is safe" rather than a reflex tap), and the opposite-surface orb greed layer adds genuine risk/reward; still, the gravity-flip genre exists (VVVVVV lineage), so it is a clever remix rather than a wholly new idea.

**4. EXECUTION - 5/5.** For 50 minutes this is remarkably coherent and complete: auto-runner, instant flip, per-surface collision, mid-air-safe hit test, orbs + combo (with a documented once-only combo-break bug caught and fixed), win/lose/retry, difficulty ramp with alternating bursts, and a fairness audit of reaction windows, all in a tiny, tidy 1351-token budget.

**5. POLISH - 4/5.** Solid juice for a jam: screen-shake and colour-flash on death, landing dust-puff + squash, pulsing "flip NOW" telegraph on imminent same-surface spikes, gravity-color/eye-direction readout, floating score popups, and looping two-channel music with flip/hit/win SFX; art is functional-clean rather than beautiful.

## Overall

This is a real, finished, playable, on-theme game. The standout idea is that the single button rewrites the world's rules (gravity direction) so every press is a genuine "which surface is safe" decision, with an optional opposite-surface orb-greed layer giving skilled play a scoring ceiling on top of pure survival. Execution is unusually disciplined for the time budget: clean win/lose/retry, a measured fairness audit, and a real logic bug found and fixed, all at 16% of the token budget. The biggest weakness is that gravity-flipping is an established sub-genre, so originality is "clever remix" rather than "never seen it," and the art is serviceable rather than striking. Nothing here is broken or faked.

## Weighted score

- Playable 30/30
- Theme 20/20
- Originality 24/30
- Execution 15/15
- Polish 4/5

**TOTAL: 93 / 100**

## Fun in a 60-second play?

**Yes** - readable, responsive, and the flip-to-survive plus orb-greed loop gives immediate tension within seconds.
