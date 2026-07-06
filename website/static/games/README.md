# Showcase games

Each subfolder here is one showcased PICO-8 game's export, served at
`/games/<slug>/`. This folder is populated **manually** (there is no CI export
step: PICO-8 is a paid binary, ADR-0013).

## Add a game

1. Export a cart into its own folder with the picopilot CLI:

   ```sh
   # standalone (recommended): produces index.html + index.js, played in an iframe
   picopilot export my-game.p8 ./website/static/games/my-game/
   ```

   The cart needs a `__label__` for a nice loading splash (capture one with F7 in
   the PICO-8 sprite editor before exporting).

2. List it in `../../src/lib/games.ts`:

   ```ts
   {
   	slug: 'my-game',
   	title: 'My Game',
   	blurb: 'One line about it.',
   	author: 'you',
   	shape: 'standalone',
   },
   ```

3. Commit the exported files under `static/games/my-game/` and the `games.ts`
   entry. The showcase index and a per-game player page appear automatically.

## Standalone vs payload-only

- **standalone** (`shape: 'standalone'`, the default): the folder holds
  `index.html` + `index.js`. The site plays it in an iframe, reusing PICO-8's own
  proven player shell. This is the supported path today.
- **payload-only** (`shape: 'payload'`, from `picopilot export --payload-only`):
  the folder holds just `index.js`, for a site that provides its own player
  shell. The from-scratch player is future work; use standalone for now.
