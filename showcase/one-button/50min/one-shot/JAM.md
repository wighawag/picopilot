# ONE SHOT

A 50-minute solo PICO-8 jam entry on the theme **one button**.

## Theme interpretation

The obvious "one button" game is a flappy/jumper: the button IS your movement. I subverted that. Here the button does not move you at all. You are a fixed turret and the world already moves on its own fixed rhythm: an aim reticle sweeps the sky back and forth like a metronome, on a beat you cannot change. The single button's whole job is to decide the one thing you control, WHEN (and how hard) to release energy into that sweep. The theme constraint (one button) became the mechanic: mastery is reading a rhythm you do not drive and committing at the right instant, not steering.

## The mechanic

- An aim line sweeps left-right across the sky at a fixed, readable pace (a metronome you must anticipate, not out-run). The sweep never stops, even while you charge, so the button is a pure timing decision.
- The one button is dual-purpose by timing:
  - **Tap** = fire an instant precise laser along the current aim line.
  - **Hold** = charge a wider, more forgiving blast (bigger hit radius), at the cost of the meteors that keep falling while you charge and of the sweep drifting off target as you hold.
- Meteors fall from the top toward your city. Line up the sweep with a meteor and fire. Miss, and a meteor hits the city.
- Lose a city block each time a meteor lands; four hits and the city falls (lose). Clear the required kills to advance through waves 1-4, then destroy the wave-5 boss to win.

## Depth: three meteor types make the ONE button a real decision

The tap-vs-hold choice only matters if holding is sometimes the right call. So later waves introduce hazard TYPES (not just more meteors), each teaching the charge:

- **Orange (normal):** any hit destroys it.
- **Pink (splitter, from wave 3):** a TAP breaks it into two fast fragments you now have to chase; a charged BLAST destroys it whole. Charging is the clean answer.
- **Blue (armored, from wave 4):** a tap only chips it (a flash, no kill); only a charged blast breaks it.

Each new type is announced the wave before contact ("pink splits! hold to blast") so first contact is gentle. Progression is escalating waves (waves 1-4): faster spawns, more kills required, faster sweep, and a new hazard type per wave. A score rewards the riskier charged and tough-type kills over cheap taps.

## The peak: a boss finale (wave 5)

Clearing wave 4 does NOT just add more meteors. It summons a **mothership** that crosses the top of the screen, rains meteors on your city, and shrugs off taps: only a **charged blast** dents its hull (6 hits to destroy, shown on a health bar). This is the arc's summit and the exam for everything the game taught: read the metronome sweep, commit to a charge (leaving yourself exposed while it rains) at the moment the aim will cross the boss, and do it under fire. Destroy it and the city is saved (win). It reuses the same one button, the same sweep, the same charge, just at maximum pressure.

## Controls

- **Z or X** (PICO-8 O/X): the only button.
  - Tap = fire a precise shot.
  - Hold then release = charge and fire a wide blast.
- Z/X also starts the game from the title and returns to menu on win/lose.

## Design self-checks

- **Reaction budget:** the sweep is ~2 seconds end-to-end and fully telegraphed (a dotted aim line you can see the whole time), so you fire on anticipation, never on a frame-perfect window. Even a bare tap has a usable hit tolerance (~6px), so timing, not pixel precision, is what is tested.
- **Fairness / no dead state:** the turret can never be forced to lose. From any sweep phase you may always tap (a shot is always legal and always fires), and letting a meteor through costs one of four lives rather than an instant kill, so there is always a non-losing action and a margin to recover.
- **Visibility/readability:** player = red turret (center-bottom), meteors = orange balls with a trail, aim = dotted line + reticle, city = green blocks, HUD shows wave, kills/target, and lives. All distinct colours on a dark sky.

## Calls made under the clock

### Slice (first third)
- **Idea lock (early):** committed to the metronome-sweep turret over the obvious flappy-flap after running the originality self-check; the button controls timing into a rhythm you do not drive.
- **Fixed a sign bug:** first build aimed the sweep DOWN into the ground. PICO-8's `sin` is pre-inverted, so I removed my extra negation (`dy = sin(ang)`, not `-sin(ang)`) and the aim then swept up into the sky.
- **Rebalanced hit tolerance:** a bare tap originally charged too little to hit anything (~5px). Widened base beam radius (`r = 3 + c*0.18`) so a tap is reliably usable and a full hold is genuinely forgiving, keeping the game a timing test rather than a precision test.
- **Verified the whole arc:** title -> play -> tap kills (counter confirmed 0->2) -> city hit drops lives -> lose screen ("CITY FELL").

### Deepen (middle)
- **Made the hold mechanic actually MATTER:** the slice had hold-to-blast but no reason to use it over tap-spam. Added meteor TYPES (splitter, armored) that a tap handles badly and a charged blast handles well, turning the one button into a genuine risk/reward decision (charge leaves you exposed while the sweep drifts and other meteors fall).
- **Kept new hazards fair and readable:** distinct colours per type (orange/pink/blue), a wave-ahead text telegraph so first contact is gentle, and confirmed in the playtest harness that splitters split, the charge bar fills, and the big white blast ring fires and kills (reached wave 3/5, charge bar and blast verified on screen).
- **Gentled the armored threshold** from charge>=20 to >=18 after watching how far the sweep drifts during a hold, so a charged blast stays reachable.
- **Added a score** rewarding charged and tough-type kills, shown in the HUD and on the end screens, to reward the riskier play.
- **Built a boss finale for a real peak:** the arc was a flat wave-loop ending arbitrarily at wave 5. Replaced wave 5 with a mothership that only charged blasts can hurt, giving the difficulty curve a genuine summit that exams the tap-vs-hold skill under pressure, rather than just piling on meteors.
- **Tuned the boss for fairness after playtesting it:** my first boss (8 HP, meteor drop every 34 frames, tight hitbox) bled the player's lives faster than they could land charged hits while exposed, a near-grind trap. I cut HP to 6, slowed drops to every 52 frames, and widened the boss hitbox so a committed charge reliably connects. Verified on real frames that damage registers, the HP bar depletes, meteors drop, and lives survive the fight.
- **Made the charge state readable (a real playability fix, not just juice):** the player had no way to tell WHEN they'd charged enough (>=18) to break armor or the boss. Added a clear "blast ready" tell: the aim line, reticle (with an extra ring), and turret all turn green at the threshold, and the charge bar goes green with a threshold marker and a "BLAST!" label. Without this, hold-to-break was a guess; with it, the player commits on a visible cue.
- **Added a combo multiplier** so the score rewards SKILL, not just survival: consecutive kills without a leaked meteor build a streak, and every 4 kills raises the score multiplier (x2, x3, ...), shown live in the HUD. A meteor hitting the city resets it. This turns the score from decoration into an expression of how well you are reading the sweep, and gives the finished game real chase-your-best replay value. Verified on real frames: a 4+ streak lit up "x2" and multiplied the incoming score.
- **Added audio:** three sfx (zap on fire, dampened+reverb explosion on kill, thud on city hit) plus a looping two-voice music bed (a driving bass pulse + a quiet minor arpeggio) that starts on play and stops on win/lose. Composed the music CONSERVATIVELY because this environment is headless (`audio render` honestly reports `captured:false`, a real-time recording needs a display+audio device), so I kept it a simple in-scale loop that cannot sound broken unheard; on a real machine it plays.
- **Scrubbed my debug scaffolding:** I test-forced the boss onto wave 1 (and briefly hp=1, and a forced win-screen) to smoke-test the boss render, the damage path, and the win screen without grinding four waves each time, then reverted every hack and re-verified the clean title-screen boot.

### Triage (last stretch)
- **Reviewed the whole cart** for defects after the feature growth: confirmed clean structure, safe `del`-inside-`all()` iteration, no double-fire on the boss summon, no leftover debug scaffolding, and a JAM.md accuracy fix ("survive all 5 waves" -> "destroy the wave-5 boss").
- **Confirmed the boss wave stays human-reactable:** by wave 5 the sweep is ~1s per pass (brisk but trackable), and with the forgiving boss hitbox it passes the reaction self-check rather than becoming frame-perfect.
- **One safe, draw-only juice pass:** each kill now spawns an expanding white flash ring on top of the spark burst, for punch, with zero change to game logic (it can't affect state).

### Scope discipline
- One screen, one button, escalating waves with new hazard types for depth (jam-appropriate ladder rung 2). No over-reach into hand-built levels I could not finish. `verify` stayed green at every checkpoint (final: 1965 / 8192 tokens, 24%). Confirmed at the deadline with `verify` (pass) and a driven `playtest run` (boots, responds to input, exits on sentinel).

## Run it

Open `main.p8` in PICO-8, or headless:
`node .../picopilot/dist/bin.js playtest run main.p8 --input "z, 100:z, 130:z"`
