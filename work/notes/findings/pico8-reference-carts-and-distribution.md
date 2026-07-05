---
title: PICO-8 bundled reference carts + distribution/licensing facts an LLM should know
slug: pico8-reference-carts-and-distribution
source: 'General PICO-8 knowledge, cross-checked against the official PICO-8 manual (v0.2.7).'
---

# PICO-8 reference carts + distribution facts (for picopilot agent context)

Ground truth on (a) the example carts that ship with PICO-8 itself, and (b) the small set of distribution/format facts that affect how a cart must be authored/saved. Curated hard: only the LLM-relevant facts are kept.

## Bundled example carts (the canonical exemplars)

PICO-8 ships demo carts, installed from the console with `INSTALL_DEMOS` (into `/DEMOS`). These are the reference implementations bundled with PICO-8 itself:

| Cart | What it demonstrates |
|------|----------------------|
| HELLO | Greetings; demonstrates MOST PICO-8 API functions |
| JELPI | Platform game demo (with 2-player support) |
| CAST | 2.5D raycaster demo |
| DRIPPY | Drippy-squiggle drawing |
| WANDER | Simple walking simulator |
| COLLIDE | Example wall + actor collisions |

`INSTALL_GAMES` also installs a small collection of carts to `/GAMES`. When picopilot needs a worked example of a mechanic (collision, platformer physics, a full API tour), these bundled carts are the first place to look, and their code is plain-text-readable inside the `.p8`.

## Distribution / format facts that constrain authoring

- **Two save formats beyond `.p8`:** `.p8.png` (looks like a cartridge image) and `.p8.rom` (raw 32k binary). For BOTH, the COMPRESSED code must be < 15360 bytes so total data <= 32k. This is a SECOND ceiling beyond the 8192-token limit: a cart can be under 8192 tokens yet still fail to save as `.p8.png` if the compressed bytes exceed 15360. `.p8` (text) does NOT enforce this. Use `INFO` in PICO-8 to see current size.
- **Cart label:** the first two lines of code starting with `--` are drawn onto the `.p8.png` label. Convention:
  ```lua
  -- game title
  -- by author
  ```
- **`#include`:** `.lua` text files can be included into a cart's code (`#INCLUDE YOURFILE.LUA`), injected each run. This is exactly picopilot's discipline: `main.p8`'s `__lua__` is a single `#include main.lua`; the agent edits plain `main.lua`.
- **External-editor reload:** `CTRL-R` auto-reloads the `.p8` from disk IF there are no unsaved changes in PICO-8's editors AND the file content differs. Otherwise: "DIDN'T RELOAD; UNSAVED CHANGES".
- **Base engine:** PICO-8 v0.2.7 is built on **Lua 5.2** (via z8lua), NOT 5.3/5.4. So no `//` operator (PICO-8 uses `\`), no `goto`-heavy idioms assumed, integer/float unified into 16.16 fixed-point (see `pico8-gotchas.md`).
- **Special save targets:** `@clip` (clipboard), `@url` (pico-8-edu.com URL, only if code+gfx fit in 2040 chars).

## Palette/font note

- The PICO-8 palette and font are published under CC-0 (public domain), so picopilot's `gfx render` encoder using the fixed palette is safe.
- Cartridges export to HTML5 and standalone Win/Mac/Linux binaries from any host.

## Cross-references

- `pico8-api-reference.md`, `pico8-idioms-and-patterns.md`, `pico8-gotchas.md`: the API/patterns/traps these carts exemplify.

</content>
