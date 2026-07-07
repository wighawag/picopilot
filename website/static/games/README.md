# Showcase games

Each game is a folder `static/games/<theme>/<runtime>/<slug>/` holding its
PICO-8 export AND a `meta.json`. The showcase page AUTO-DISCOVERS games by
globbing every `meta.json` (`import.meta.glob('/static/games/**/meta.json')`),
so there is no hand-maintained list, dropping in a folder is enough. Games are
grouped on the page by `theme`, then by `runtime` (short to long).

This folder is populated **manually** (there is no CI export step: PICO-8 is a
paid binary, ADR-0013).

## Add a game

1. Export a cart into its folder (theme + runtime + slug) with the picopilot CLI:

   ```sh
   # standalone (recommended): produces index.html + index.js, played in an iframe
   picopilot export my-game.p8 ./website/static/games/one-button/3min/my-game/
   ```

   The cart needs a `__label__` for a nice loading splash / card thumbnail
   (capture one with F7 in the PICO-8 sprite editor before exporting, or draw one
   and pass `--label`).

2. Write a `meta.json` next to the export:

   ```json
   {
   	"slug": "my-game",
   	"title": "My Game",
   	"blurb": "One line about it.",
   	"author": "you",
   	"theme": "one button",
   	"runtime": "3 min",
   	"shape": "standalone",
   	"hasLabel": true
   }
   ```

3. Commit the folder. The showcase index and a per-game player page appear
   automatically, no edit to `src/lib/games.ts` (it is now a glob loader, not a
   list).

`slug` must be unique across the showcase (it is the per-game player route id);
`theme` and `runtime` are display strings and also the folder names.

## Standalone vs payload-only

- **standalone** (`shape: 'standalone'`, the default): the folder holds
  `index.html` + `index.js`. The site plays it in an iframe, reusing PICO-8's own
  proven player shell. This is the supported path today.
- **payload-only** (`shape: 'payload'`, from `picopilot export --payload-only`):
  the folder holds just `index.js`, for a site that provides its own player
  shell. The from-scratch player is future work; use standalone for now.
