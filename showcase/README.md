# showcase

Git-tracked **source** for the games featured on the picopilot website. Each
game's cart source (the `.p8`, its `#include`d `.lua`, config, jam writeup, and
any label-authoring script) is kept here so the source is versioned, even though
the built, playable export lives under `website/static/games/`.

Both trees are organized the same way, **by theme, then by run-time**:

- **Source of truth** (here): `showcase/<theme>/<runtime>/<slug>/` - `main.p8`,
  `main.lua`, `picopilot.json`, `JAM.md`, and any label-authoring script.
- **Built artifact** (served by the site): `website/static/games/<theme>/<runtime>/<slug>/`
  - the `index.html` + `index.js` from `picopilot export`, a `label.png`, and a
  `meta.json`. The website auto-discovers games by globbing those `meta.json`s
  and groups them by theme then run-time (no hand-maintained list).

This is distinct from `packages/picopilot/bench/out/`, which holds throwaway
game-jam benchmark run outputs (gitignored except a few curated entries).

## Rebuild a game's export

From the repo root, with PICO-8 available (example: the 50-minute one-button
entry `fliprun`):

```sh
G=one-button/50min/fliprun
# fliprun has no captured __label__, so it is given one from a drawn PNG.
node showcase/$G/make-label.mjs   # writes showcase/$G/label.png
picopilot export showcase/$G/main.p8 website/static/games/$G/ \
  --label showcase/$G/label.png
# Copy the label + write a meta.json next to the export so the card can show a
# thumbnail and the site can discover + group the game.
cp showcase/$G/label.png website/static/games/$G/label.png
```

Then write `website/static/games/$G/meta.json` (see
`website/static/games/README.md` for the fields). The showcase index and the
per-game player page appear automatically, no `games.ts` edit.

## Featured games

- **one-button / 50min / fliprun** - `FLIPRUN`, a one-button gravity-flip
  runner built in a ~50-minute PICO-8 game-jam session with picopilot. See its
  `JAM.md` for the design writeup.
