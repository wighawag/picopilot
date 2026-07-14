---
title: Extract the template into ./website with a landing page, showcase, and Pico8Player
slug: website-showcase-and-pico8-player
blockedBy: []
covers: []
---

## Decisions (as-built)

- **Trimmed the template, did not copy it whole.** The `template-svelte-tailwind` `web/` package carries PWA/service-worker/push-notification/eruda machinery + `pwag` icon generation that a landing + showcase static site does not need. Extracted only the SvelteKit + Tailwind v4 + `adapter-static` skeleton and built the picopilot pages on top, keeping `./website` lean.
- **`Pico8Player` iframes the STANDALONE export rather than porting PICO-8's shell.** PICO-8's exported `index.html` is a ~700-line self-contained player (input, layout, audio, gamepad, touch). Reimplementing it in Svelte would be brittle, so the standalone shape (the supported path today) reuses PICO-8's own shell verbatim in an iframe; the site provides the surrounding chrome. Payload-only shows a clear notice and is documented as future work (the from-scratch shell port is not built). See ADR-0013 for the shape split.
- **`handleUnseenRoutes: 'ignore'`** so an EMPTY showcase (the `/showcase/[slug]` dynamic route generating zero pages) is a valid build, not a hard error.
- **GitHub Pages subpath via `BASE_PATH`** env, wired from `actions/configure-pages` `base_path` at CI build time; defaults to `''` for local/root serving.

## What to build

A top-level `./website` package (a SvelteKit static site, extracted from `~/dev/github/wighawag/template-svelte-tailwind`'s `web/` package: `@sveltejs/adapter-static`, Tailwind v4, the PWA tooling) that IS the picopilot landing page and the game showcase, deployable as GitHub Pages.

Three surfaces:

1. **Landing page** explaining what picopilot is (pull the framing from `CONTEXT.md` and `work/specs/`): an agent-first PICO-8 toolchain (CLI + MCP + skills).
2. **Showcase index** listing the exported games found under `website/static/games/<slug>/`, each with a title/thumbnail, that link to a player page.
3. **`Pico8Player` Svelte component** (lives in the website, NOT the picopilot engine): a port of PICO-8's small HTML-export bootstrap (the `Module` config + `<canvas id="canvas">` + input wiring) that loads an exported cart's runtime `.js`. This is what makes `picopilot export --payload-only` useful: the site provides ONE consistent player shell instead of N iframed standalone pages. See ADR-0013 for the standalone-vs-payload-only split and the fact that the exported `.html` is a disposable shell referencing a self-contained sibling `.js`.

Showcase population is MANUAL (ADR-0013): a human runs `picopilot export <cart> ./website/static/games/<slug>/ --payload-only` (or standalone) for the games to feature. No CI export step (PICO-8 is a paid binary).

Wire the new package into the monorepo the existing way: it sits under the root `pnpm-workspace.yaml` and the root `package.json`'s `dev`/`build` scripts already fan out with `pnpm --filter`. Add a GitHub Pages deploy workflow that builds the static site (set SvelteKit `paths.base` for the repo subpath) and deploys the pre-committed exports.

## Acceptance criteria

- [ ] `./website` builds a static site (`pnpm --filter ./website build`) with an `adapter-static` output.
- [ ] Landing page renders and explains picopilot.
- [ ] Showcase index lists games discovered under `website/static/games/` and links to per-game player pages.
- [ ] `Pico8Player` component loads and runs an exported cart `.js` (verified with one real export produced via `picopilot export --payload-only`).
- [ ] A GitHub Pages workflow builds + deploys the static site (base path correct for the repo subpath).
- [ ] Docs: a short README in `./website` on how to add a showcase game (the manual `picopilot export ... ./website/static/games/<slug>/` step).

## Blocked by

- None. The CLI side (`picopilot export`/`serve`, ADR-0013/0014) already landed and gives the website everything it needs.

## Prompt

> Build a top-level `./website` SvelteKit static site for picopilot: a landing page, a game showcase, and a reusable `Pico8Player` component. Extract from the template at `~/dev/github/wighawag/template-svelte-tailwind` (its `web/` package uses `@sveltejs/adapter-static` + Tailwind v4 + PWA tooling); rewire names/paths for THIS monorepo (root `pnpm-workspace.yaml` + the `pnpm --filter` fan-out in the root `package.json`).
>
> The player: PICO-8's HTML export is a disposable `index.html` shell around a self-contained `index.js` (Emscripten runtime + baked-in cart). `Pico8Player` ports that shell's small inline bootstrap (a `Module` object + `<canvas id="canvas">` + input handling) into Svelte and loads an exported cart's `.js`. This is why `picopilot export --payload-only` exists (see ADR-0013): it emits just the `.js`, and the site provides one consistent player rather than iframing N standalone pages. Both export shapes are already verified against real PICO-8 output.
>
> Showcase population is MANUAL and outside CI (PICO-8 is a paid binary, ADR-0013): a human runs `picopilot export <cart> ./website/static/games/<slug>/` for each featured game. The showcase index just lists whatever slugs are present under `website/static/games/`. Add a GitHub Pages deploy workflow (set SvelteKit `paths.base` for the repo subpath) that builds + deploys the pre-committed exports.
>
> Read `CONTEXT.md` (the `export`/`serve`/`showcase`/`website` glossary entries) and ADR-0013/0014 before starting. Record any non-obvious in-scope decision per the repo's decision-recording rule.
