<div align="center">
  <img src="website/static/logo.svg" alt="picopilot logo" width="96" height="96" />
  <h1>picopilot</h1>
  <p><strong>An agent-first toolchain that makes PICO-8 game development easy with an LLM.</strong></p>
</div>

picopilot is a single TypeScript tool (built on the [`incur`](https://www.npmjs.com/package/incur) framework) that is simultaneously a **CLI**, an **MCP server**, and a set of **auto-installable agent skills**. It is the transpile-and-verify layer between an agent's strength (text) and PICO-8's reality (binary cart sections): it gives the agent eyes (render sprites to a viewable PNG), token-bloat detection, safe cart editing, audio-as-text, and one static acceptance gate, so an LLM can build PICO-8 games and self-correct.

## Why

[PICO-8](https://www.lexaloffle.com/pico8.php) is a fantasy console: a 128x128 screen, 16 fixed colours, an 8,192-token Lua budget, and sprites/sfx/music stored as hex blobs in a `.p8` cart. Those binary sections are the exact things an LLM is worst at reasoning about blind. picopilot turns each of them into something an agent can read, edit, and check as text, then bakes them back into a real cart.

## What it gives you

| Command | What it does |
| --- | --- |
| `init` | Scaffold an agent-ready PICO-8 cart. |
| `gfx` | Edit sprites as text (a per-pixel char grid); render them to a viewable PNG. |
| `tokens` / `lint` / `minify` | Count tokens, lint, and minify via [`shrinko8`](https://github.com/thisismypassport/shrinko8). |
| `verify` | The single static acceptance gate (tokens + lint + integrity; never runs the cart). |
| `run` / `playtest` | Run a cart headless, capture screenshots, drive input. |
| `audio` | Author sound and music as text (picopilot-MML). |
| `export` / `serve` | Export to a playable HTML bundle and serve it in a browser. |

Every command returns a structured, agent-friendly result (TOON output, Zod-validated schemas, and a `{code, message, retryable, cta}` error envelope), so the same tool drives a human at a terminal, an MCP client, and an autonomous agent loop.

## Requirements

- **Node.js >= 22** and **pnpm** (this repo pins the version via `packageManager`).
- **PICO-8** (a paid binary) is only hard-required by the commands that run a real console: `run`, `audio render`, `export`, and `serve`. Everything else works without it.
- **[`shrinko8`](https://github.com/thisismypassport/shrinko8)** (`pip install shrinko`) powers token counting, linting, minification, and cart/PNG conversion. Shrinko-free commands work without it; shrinko-backed commands fail with a structured `shrinko-not-found` result when it is absent.

## Repository layout

This is a pnpm workspace monorepo.

- **`packages/picopilot/`** - the `picopilot` CLI / MCP server / skills package (the tool itself).
- **`website/`** - a SvelteKit static site: the picopilot landing page plus a showcase that plays exported games in the browser. Deploys as GitHub Pages.
- **`showcase/`** - git-tracked **source** for the games featured on the site (the `.p8` carts, config, and jam writeups). The built, playable exports live under `website/static/games/<slug>/`.
- **`docs/adr/`** - Architecture Decision Records: what we decided and why.
- **`work/`** - the on-disk work contract (notes, tasks, prds) this repo runs on.
- **`CONTEXT.md`** - the domain glossary; the shared vocabulary used across the codebase.

## Getting started

```sh
pnpm install
pnpm build            # build every workspace package

# run the CLI from the package (from-source)
pnpm --filter picopilot picopilot --help
```

Common workspace scripts (run from the repo root):

```sh
pnpm test             # run package tests
pnpm website:dev      # run the website locally
pnpm website:build    # build the static site
pnpm format           # prettier --write .
```

## The showcase

The showcase is a manual, curated selection (there is no CI export step, since PICO-8 is a paid binary). To add a game:

```sh
# 1. Export the cart into its own served folder.
picopilot export showcase/<slug>/main.p8 website/static/games/<slug>/ \
  --label showcase/<slug>/label.png

# 2. Copy the label next to the export so the showcase card can show it
#    as a thumbnail (the export bakes the label into index.js, but the card
#    needs a standalone image).
cp showcase/<slug>/label.png website/static/games/<slug>/label.png
```

Then list the game in `website/src/lib/games.ts` (set `hasLabel: true` when a `label.png` sits next to the export). See `showcase/README.md` for the full rebuild flow.

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0.en.html).
