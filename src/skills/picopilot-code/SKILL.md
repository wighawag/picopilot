---
name: picopilot-code
description: Write low-token PICO-8 Lua and stay under the 8,192-token budget. How to read picopilot tokens output, the PICO-8 shorthands that reclaim budget, and how minify (safe-only) and verify fit the loop. Use when writing or shrinking cart Lua.
---

# picopilot code

The #1 way an agent fails at PICO-8 is token bloat: verbose Lua silently blows
past the 8,192-token budget and the cart will not load. picopilot's job here is
to make the budget visible and cheap to fix. (See `picopilot-overview` for the
`#include` discipline: you edit `main.lua`, never the `.p8` binary sections.)

## Read the token breakdown every iteration

Run `picopilot tokens` after each change. It reports:

- `tokens` and `pct`: the count and its percentage of the 8,192 budget.
- `overBudget`: true when you are over 8,192 (the cart will not load).
- `chars` and `compressed`: size, not the load-bearing limit; tokens are.

When you are over budget, the result CTAs you to `picopilot minify`. Treat the
token count as the number to drive down, not something to check once.

If shrinko is not installed, `tokens` returns a structured `shrinko-not-found`
result (nonzero exit) with the exact remedy `uv pip install shrinko`. That is not
a crash; install shrinko and re-run.

## Token discipline (write cheap Lua the first time)

Models blow the budget by writing verbose Lua. Prefer PICO-8 shorthands:

- `?` for `print`.
- inline if: `if(c) x=1` instead of `if c then x=1 end`.
- compound assignment: `+=`, `-=`, `*=`, `/=`.
- `\` for integer divide.
- reuse locals; avoid needless globals; fold repeated expressions into one local.

## Reclaim budget with minify (safe-only)

`picopilot minify` runs SAFE minification by default and reports the before/after
token delta. Safe-only never changes behaviour, so it is the first move when over
budget. Aggressive minification is never silent; if it is ever offered it is an
explicit opt-in.

## Gate it

`picopilot verify` is the single static acceptance gate: tokens + integrity, no
run. A green verify is well-formed, not proven-to-run, so it points you at
`picopilot run`. With shrinko absent, verify is `gate-incapable` (never green),
because it cannot check token bloat, the failure this loop exists to catch.
