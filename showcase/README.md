# showcase

Git-tracked **source** for the games featured on the picopilot website. Each
subfolder is one game's cart source (the `.p8`, its `#include`d `.lua`, config,
and its jam writeup), kept here so the source is versioned even though the
built, playable export lives under `website/static/games/<slug>/`.

- **Source of truth** (here): `showcase/<slug>/` - `main.p8`, `main.lua`,
  `picopilot.json`, `JAM.md`, and any label-authoring script.
- **Built artifact** (served by the site): `website/static/games/<slug>/` -
  the `index.html` + `index.js` from `picopilot export`.

This is distinct from `packages/picopilot/bench/out/`, which holds throwaway
game-jam benchmark run outputs (gitignored except a few curated entries).

## Rebuild a game's export

From the repo root, with PICO-8 available:

```sh
# fliprun has no captured __label__, so it is given one from a drawn PNG.
node showcase/fliprun/make-label.mjs   # writes showcase/fliprun/label.png
picopilot export showcase/fliprun/main.p8 website/static/games/fliprun/ \
  --label showcase/fliprun/label.png
```

Then list the game in `website/src/lib/games.ts`.

## fliprun

`FLIPRUN` - a one-button gravity-flip runner built in a ~50-minute PICO-8
game-jam session with picopilot. See `fliprun/JAM.md` for the design writeup.
