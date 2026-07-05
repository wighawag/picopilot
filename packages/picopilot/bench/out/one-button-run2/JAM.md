# ONE BUTTON: Gravity Flip Runner

## Theme interpretation

The theme "one button" is taken literally at the mechanics layer: the ENTIRE game is played with a single button. There is no left/right, no jump-hold, no menu navigation with arrows. One press does everything.

## Mechanic

You are a ball (blue circle) that is constantly pulled by gravity toward either the floor or the ceiling. Pressing the button FLIPS the direction of gravity: the ball starts falling the other way. A small arrow on the ball shows the current gravity direction (v = down, ^ = up).

Spikes (pink bars) scroll in from the right, jutting down from the ceiling or up from the floor. You must flip gravity at the right moments to weave through the gaps. Touching a spike, or slamming into the floor/ceiling, ends the run. Obstacles speed up as your score climbs, so it gets harder the longer you last.

Goal: survive and score as many passed spikes as possible.

## Controls

- **Z / X / O (the one button)**: on the title screen, starts the game; during play, flips gravity; on game over, restarts.

That is the only input the game reads.

## Design calls made under the clock

- Player and all key entities are drawn with primitives (`circfill` / `rectfill`), so nothing can ever be invisible.
- A single short "blip" SFX (slot 0) plays on each gravity flip for feedback.
- Difficulty ramps via obstacle speed tied to score, giving a natural challenge curve without extra systems.
