# `picopilot verify` is a STATIC gate and returns `gate-incapable` (never green) when it cannot check tokens

`picopilot verify` runs tokens + lint + cart-integrity and returns one structured envelope. It is STATIC by design: it does NOT execute the cart. Its envelope self-scopes ("passing does not mean the cart runs") and a green verify CTAs to `picopilot run`. Because its token/lint checks are shrinko-backed, when shrinko is absent verify returns a DISTINCT `gate-incapable` result (nonzero exit) — categorically separate from `pass` and from `fail` — so it can never report green by skipping its most important check.

## Considered Options

- **Make verify run the cart (rejected).** "verify does not imply run" — running is a separate, PICO-8-dependent step (`picopilot run`). The connotation risk (an agent treating static-green as "it works") is neutralised by HONESTY (the self-scoping envelope + the green→run CTA), not by widening verify's scope.
- **Skip the token check and pass when shrinko is absent (rejected).** That is the gate-as-theatre failure: a green gate that silently never checked the #1 failure mode (token bloat).

## Consequences

There is a deliberate name collision: `picopilot verify` (this CLI feature, gates the USER's cart) is NOT the runner's own `dorfl.json` `verify` gate (which gates picopilot's development). Always write `picopilot verify` to disambiguate; the term is pinned in `CONTEXT.md`.
