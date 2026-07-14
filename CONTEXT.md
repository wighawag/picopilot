# CONTEXT — picopilot domain language

The domain glossary for `picopilot`. Agents and skills use THIS vocabulary when naming modules, tests, and discussing the system. Architectural rationale lives in `docs/adr/` (decisions); product framing lives in `work/prds/`.

## What picopilot is

picopilot is an agent-first toolchain (a single TypeScript CLI built on the `incur` framework, which is simultaneously a CLI, an MCP server, and a set of auto-installable agent skills) that makes PICO-8 game development easy with an LLM. It is the transpile-and-verify layer between the agent's strength (text) and PICO-8's reality (binary cart sections): it gives the agent eyes (render sprites to a viewable PNG), token-bloat detection, safe cart editing, audio-as-text, and a single static acceptance gate, so an LLM can build PICO-8 games and self-correct.

## Core domain terms

- **PICO-8** — a fantasy console: 128x128 screen, 16 fixed colours, an 8,192-token Lua budget; sprites/sfx/music stored as hex blobs in a `.p8` cart. A licensed, paid binary with no pip/npm install path (optional in v1; only `run`/`audio render`/`export` hard-require it).
- **cart** — a PICO-8 cartridge (`.p8`): Lua code plus binary sections `__gfx__` (spritesheet), `__map__`, `__sfx__`, `__music__`, `__label__`.
- **gfx/map overlap** — sprites 128-255 (`0x1000-0x1fff` in `__gfx__`) alias the bottom half of `__map__` (rows 32-63). `gfx set` smart-refuses a write that would clobber real map tiles unless authorised (`--allow-map-overlap` / `allowMapOverlap` config).
- **char grid** — the "SVG for pixels": a per-pixel hex representation of a sprite (`.` = transparent, `0-F` = the 16 colours) that maps 1:1 to `__gfx__`. The EDIT surface. Distinct from the rendered PNG (`gfx render`), the JUDGE surface a multimodal agent looks at.
- **picopilot-MML** — a small, documented MML (Music Macro Language) subset tuned to PICO-8's exact audio capabilities (8 waveforms, 8 effects, 4 channels). The v2 audio authoring notation (ABC is dropped: it cannot express waveform/volume/effect).
- **shrinko8** — an external Python tool (`pip install shrinko`) picopilot shells out to for token counting, linting, minification, and cart/PNG conversion. A load-bearing dependency for the code-quality/conversion commands; the shrinko-free commands work without it, and shrinko-backed commands fail with a structured `shrinko-not-found` result when it is absent.
- **incur** — the TypeScript CLI framework picopilot is built on: one `Cli.create()` definition yields the CLI, an MCP server, auto-installable skills, TOON output, Zod schemas, CTAs, and a structured `error({code, message, retryable, cta})` envelope.
- **`picopilot export`** — the THIN structured wrapper over PICO-8's HTML export (`pico8 <cart> -export <dest>/index.html -x`, headless, ADR-0013). Emits a directly-serveable `index.html` + `index.js` pair into an optional `dest` dir (point it at a showcase folder); `--payload-only` keeps just the `.js` runtime for a site with its own player. Hard-requires PICO-8; absence is `pico8-not-found`.
- **`picopilot serve`** — the "play this cart in a browser" loop (ADR-0014): takes a CART, ALWAYS exports first into a temp dir, then serves it over a zero-dep `node:http` static server and prints the local URL. Distinct from `export` (which produces a bundle at a chosen dest) and `run` (native headless capture). Hard-requires PICO-8.
- **showcase** — the manually-populated set of exported games under `./website/static/games/<slug>/`, produced by pointing `picopilot export` at each slug dir. No CI export step (PICO-8 is a paid binary); selection is manual.
- **website** — the top-level `./website` package (a SvelteKit static site, extracted from `template-svelte-tailwind`): the picopilot landing page + a showcase index that plays the exported games. It owns the `Pico8Player` Svelte component (a port of PICO-8's small bootstrap that loads an exported `.js`), NOT the picopilot engine. Deploys as GitHub Pages.
- **`picopilot verify`** — the tool's STATIC cart-acceptance gate (tokens + lint + integrity; does NOT run the cart). Distinct from the `dorfl.json` `verify` gate that gates picopilot's OWN development (same word, different level).
- **gate-incapable** — a distinct `picopilot verify` outcome (nonzero exit, never green) when shrinko is absent, so the gate can never pass hollowly by skipping its token/lint checks.
- **promptGuidance** — the per-repo NUDGE namespace in `dorfl.json` whose members (currently just `testFirst`) strengthen the wording in the worker's in-band prompt. NOT a gate: the `verify` step is still the only acceptance bar. Omitted ⇒ off; absence is the default.
- **work/ contract** — the on-disk system this repo uses, defined by the reference docs in **`work/protocol/`** (copied here by `setup`): `WORK-CONTRACT.md` (the contract), `CLAIM-PROTOCOL.md`, `REVIEW-PROTOCOL.md`, `task-template.md`, `spec-template.md`, `ADR-FORMAT.md`. Three REGIME umbrellas — `notes/` (capture buckets), `tasks/` (the build board), `specs/` (the spec lifecycle) — plus top-level `questions/` and `protocol/`. One markdown file per item, status = the folder it lives in (never a field). Capture buckets: `notes/ideas/` (proposed), `notes/observations/` (spotted, unverified, append-only), `notes/findings/` (verified external/domain ground truth, each with a `source:`). ADRs (`docs/adr/`, format in `work/protocol/ADR-FORMAT.md`) record what WE decided and why.

## Conventions

Standing per-change rules agents must follow in this repo.

<!-- No standing per-change rule set yet (no changeset/CHANGELOG/news convention). Add yours here, or delete this section. For enforcement, wire your own check into the `dorfl.json` `verify` gate. -->

## Skills this repo uses

- Required: `setup` (onboarding/migration), `to-spec`, `to-task`.
- Recommended: `review`, `grill-me`.
