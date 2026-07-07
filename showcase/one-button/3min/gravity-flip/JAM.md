# One Button - Gravity Flip Runner

## Theme interpretation
"One button" taken literally as the whole control scheme: the single button is the ONLY verb, and it does the one thing that matters. I picked gravity flipping because a single press meaningfully changes the world state (which surface you're stuck to), giving depth from one input rather than a bare "press to jump".

## Mechanic
A ball is pulled toward the floor or ceiling by gravity. Pressing the button flips gravity, so the ball falls the other way and sticks to the opposite surface. Spikes stream in from the right, mounted on either the floor or the ceiling. You survive by being on the surface WITHOUT the incoming spike. Speed ramps up with your score. Win condition is score (endless survival); lose on any spike hit.

## Controls
- Button (Z / X, PICO-8 O or X) = flip gravity.
- On game over, the same button restarts.

## Calls made under the clock
- **Scope:** one screen, one mechanic, one button. Short 3-minute clock, so no levels; deepen via a score-based speed ramp (`sp=1.6+score*0.01`) instead.
- **Fairness:** spikes spawn only at the right edge (x=132) and travel left at a bounded speed, so every hazard is telegraphed with reaction time before reaching the player at x=24. Collision window is generous (7px horizontal, 12px vertical) to stay within a human reaction budget. Player clamps to floor/ceiling so there's no dead mid-air state.
- **Readability:** high-contrast palette (yellow player on dark-blue field, red spikes, green surfaces), on-screen "BTN: FLIP GRAVITY" prompt, live score HUD.
- **Verify/playtest:** verified green (388 tokens), playtested 120 frames headless, confirmed boot + input response + spike spawning + rendering via screenshots.
