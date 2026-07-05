# one-button (game-jam benchmark output, reconstructed)

The playable game the agent built in the 3-minute smoke test of the game-jam
benchmark (theme: "one button"), reconstructed from the pi session log after the
original temp workdir was cleaned up.

A one-button flap-and-dodge survival game: hold Z/X/Up to thrust up against
gravity, release to fall, fly through gaps in scrolling walls. Score per wall
cleared; hit a wall/floor = game over. 420/8192 tokens.

## Play it

    pico8 main.p8        # or open main.p8 in PICO-8

(main.lua is the source; main.p8 #includes it.)
