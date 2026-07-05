# `picopilot minify` is compiler-style: it PRESERVES the source and emits a separate artifact

`picopilot minify [cart]` reads a cart, runs shrinko8's SAFE minification (`--minify-safe-only` by default), and writes the result to a SEPARATE output cart (default `<name>.min.p8`), reporting the before/after token delta. It NEVER overwrites the user's authored files (`main.p8` / the `#include`d `main.lua`), and it refuses to clobber an existing output unless `--force`. This reverses the prd's original US #5 framing ("the only v1 command that MUTATES the user's Lua").

## Considered Options

- **In-place mutation of the editable source (rejected, the prd's literal framing).** picopilot's whole model (US #1, the `#include` discipline) is that the agent DEVELOPS in a readable `main.lua` and re-reads it every iteration. Minified Lua is unreadable, so overwriting the source would destroy the exact surface the develop-loop depends on. An agent could not keep working after one minify. This is the strongest reason to reject in-place.
- **In-place with a `.bak` sidecar (rejected).** Recovers the source but litters the project with backup files and still makes `main.p8`/`main.lua` briefly-then-permanently the minified version; the mental model ("which file is my real source?") gets muddy. A clean separate artifact is simpler.
- **Compiler-style, separate `<name>.min.p8` output (CHOSEN).** Source stays pristine and readable; the minified cart is a BUILD ARTIFACT you ship/run/measure, exactly like `tsc` emitting `dist/`. `minify` then mutates NOTHING the user authored, a cleaner invariant than "the one mutating command". No-clobber (refuse an existing output unless `--force`) mirrors `init`'s no-overwrite discipline so a minify never silently destroys a prior artifact.

## Consequences

- The load-bearing safety property is stronger than the prd asked for: picopilot has NO command that overwrites user-authored source. (`gfx set` writes the cart's binary `__gfx__`, not the Lua source; `minify` writes a new artifact.)
- Aggressive (non-safe) minification, if ever added, is an explicit opt-in flag on top of this same compiler shape; the output is still a separate artifact.
- The delta report (before/after tokens) is the primary VALUE for the agent loop (`tokens` over budget -> `minify`), independent of where the bytes land.
