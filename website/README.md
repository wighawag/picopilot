# picopilot website

The picopilot landing page and PICO-8 game showcase: a static SvelteKit site
(SvelteKit + `@sveltejs/adapter-static` + Tailwind v4) deployed to GitHub Pages.

## Develop

```sh
pnpm --filter ./website dev      # or, from the repo root: pnpm website:dev
```

## Build

```sh
pnpm --filter ./website build    # or: pnpm website:build
```

The static output lands in `website/build/`.

For GitHub Pages under a repo subpath, set `BASE_PATH` at build time (the deploy
workflow does this):

```sh
BASE_PATH=/picopilot pnpm --filter ./website build
```

## Add a showcase game

The showcase is curated manually (no CI export step; PICO-8 is a paid binary).
See [`static/games/README.md`](static/games/README.md): export a cart into
`static/games/<slug>/` with `picopilot export`, then add an entry to
[`src/lib/games.ts`](src/lib/games.ts).

## Structure

- `src/routes/+page.svelte` - the landing page (what picopilot is).
- `src/routes/showcase/+page.svelte` - the showcase index (lists `games.ts`).
- `src/routes/showcase/[slug]/` - the per-game player page (prerendered per slug).
- `src/lib/games.ts` - the showcase manifest (the single source of truth).
- `src/lib/Pico8Player.svelte` - plays a game's export (iframes the standalone
  bundle; see ADR-0013 for the standalone vs payload-only split).
