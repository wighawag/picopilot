# BEACON HOP

A one-button charge-jump platformer built for the "one button" jam.

## Theme interpretation

The obvious "one button" game is a flappy/jumper where a tap = flap. I avoided that by making the single button an ANALOG input instead of a binary tap: hold it to charge a jump arc, release to launch. The one button carries the whole game (aim strength, timing, commitment) rather than being a reflex tap. Difficulty comes from planning the right charge and direction, not from beating a reaction-time floor.

## Mechanic

You are a glowing orb resting on floating platforms. While grounded:
- HOLD the button to build charge; a live trajectory preview (dotted arc) and a charge bar show exactly where you will land. The bar turns red at max power.
- RELEASE to launch along that arc.
- You must land on the next platform and reach the flag, while avoiding spike beds and pits.

The trajectory preview is the fairness tool: the player always SEES where a given charge sends them, so a miss is a planning error, never a blind guess. The arc even simulates the full flight and draws a LANDING MARKER at the predicted touchdown: a green ring if you will land safely on a platform, a red X if that charge would drop you onto spikes or off the screen. So you commit on a shown outcome, not a guess. This keeps it human-playable (no frame-perfect windows; you plan on prediction).

## Controls

- O / Z (or X): hold to charge, release to jump. (Also starts the game from the title screen.)
- Left / Right: while grounded, flip which direction you aim.
- On win/death screens: O to continue / retry.

A title screen explains the one-button mechanic and shows a demo orb arcing before you start; the completion screen shows a 3-star rating, your total time, death count, and gems collected.

## Progression

10 hand-built levels, each introducing a NEW mechanic rather than more of the same, so the game genuinely goes somewhere:
1. Gentle intro: flat platforms, one gap, no hazards, learn the charge.
2. First spike pit under the gap.
3. An ascending step over a wide spike bed (verticality).
4. Short ledges over a long double spike pit (precision).
5. MOVING platform introduced GENTLY: a ledge slides at the same height as your start with a small sweep, so first contact is a simple horizontal catch to learn riding before it is tested under pressure.
6. Two movers to chain.
7. BOUNCE PAD introduced GENTLY: a wide green pad raised clear above the spikes, land on it and it auto-launches you high (no charge needed), reaching heights a normal jump cannot, learned with a comfortable landing margin before it is combined with hazards.
8. Bounce-pad chain over a tall spike wall to a high perch.
9. Everything combined (mover + bounce + an optional gem detour).
10. Peak gauntlet: mover into bounce into a high flag over a spike wall, with a bonus gem.

Extra mechanics: MOVING platforms (blue) that you can ride while grounded; BOUNCE PADS (green) that auto-launch you; optional GEMS (pink) that are a bonus/score, deliberately never required so they can't create a dead state. Ledges in the harder levels are kept wide enough that clearing them relies on reading the trajectory preview and committing, not on frame-perfect timing.

## Calls made under the clock

- Chose analog-charge over flappy-tap early to dodge the obvious theme reading.
- Used primitives (circfill orb, rectfill platforms, line spikes) instead of sprites so nothing is ever an invisible empty slot.
- Trajectory preview added in the first slice, not as later polish, because it is the load-bearing fairness/readability feature.
- Kept level data as compact split-strings to stay far under the token budget.
- Audio: charge-release, splat, win, and bounce SFX plus a looping bass+arp track.
- Physics tuned so charge maps to a wide, controllable distance/height band (~25px to ~150px). Verified levels are clearable via live playtest sessions (drove the orb hop-by-hop and read the screenshots), and widened tight ledges after playtests showed a hop was too tight.
- DEEPEN pass: rather than only polishing the 6-level slice, I spent the middle of the jam adding three real mechanics (moving platforms, bounce pads, gems) and four more levels, so more time bought a bigger, deeper game with a real difficulty arc, not just a more finished tiny one.
- Juice/feedback added as it earned its keep: landing dust, a bounce burst, death shake, a gem-collected ring on the orb, and a HUD button hint.
- Kept gems strictly optional (bonus only) to avoid introducing any forced-collection dead state.
- Fairness pass: drove EVERY level (1-10) in live playtest sessions and confirmed each is clearable with a reachable charge/timing, no dead state. The moving platforms use a slow ~3s oscillation and now carry a direction arrow, so their motion is telegraphed and a human can time the catch by anticipation rather than a frame-perfect window (the "telegraph, then require" principle).
- Curve fixes (late fresh-eyes pass): the two mechanic-INTRODUCTION levels were testing the new mechanic under pressure on first contact. Level 5's mover was higher than the start over spikes, softened to a same-height, small-sweep catch. Level 7's bounce pad sat only 6px above the spike bed (a thin, risky landing margin for the mechanic's debut), raised it 14px clear and widened it. Now each new mechanic gets a gentle first contact before it is combined with hazards, per the difficulty-curve principle. Both re-verified clearable.
- Structural fairness guarantee: the only ways to die are touching a spike or falling off-screen, and both require having LAUNCHED. While resting on a platform there is no timer and no encroaching hazard, so "do nothing" is always a non-losing move. Combined with verified goal-reachability, that means from every rest state the player can always still win: no dead state can exist by construction, not just by testing. (Checked too that no moving platform's path carries a resting player into spikes; every mover sits well above its spike bed.)
- Added a title screen (mechanic explanation + demo orb arc + feature list) and a completion screen with a death count, so a fresh player understands the one button before playing.
- Replay value: a full-run scoring layer -- a live gem counter + run timer in the HUD, and a completion screen with a 3-STAR RATING (fewer deaths = more stars), total time, death count, and gems collected. This turns "reach the flag" into "master the run," giving a reason to replay. Verified the whole title -> play -> win -> completion -> restart loop end to end via playtest screenshots.
