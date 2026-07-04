# Two-tier capability: per-command structured failure when shrinko is absent (B1, not a front-door gate)

Commands split into shrinko-FREE (`init`, `gfx show/set/render`, `run`, audio transpile) which always work, and shrinko-BACKED (`tokens`, `lint`, `minify`, `gfx import/export`) which detect shrinko at their own seam and, when it is absent, return a structured `{ok:false, reason:"shrinko-not-found", remedy, needs}` envelope + nonzero exit — never a crash, never a stub that reports success.

## Considered Options

- **B2, a front-door gate that refuses everything without shrinko (rejected).** It would couple shrinko-free commands to a dependency they do not use (more code, not less) and bake in a precondition that a later loosening would break. The clean "one requirement" mental model B2 wanted is recovered with a single README/skill line, not by gating working commands.
- **Optional + degrade-to-hollow-success (rejected).** Reporting success while silently skipping the check is the dishonest outcome the structured failure exists to prevent.

## Consequences

The dependency graph is honest: a command needs shrinko iff it actually uses it. The one place this bites is `picopilot verify` (see ADR-0003), which is shrinko-backed and therefore returns `gate-incapable` rather than a hollow green when shrinko is absent.
