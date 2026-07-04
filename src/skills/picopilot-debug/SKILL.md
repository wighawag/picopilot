---
name: picopilot-debug
description: Close the run-test loop for a PICO-8 cart with picopilot. Run the cart headless and read printh output, use the static verify gate honestly (well-formed is not proven-to-run), and understand the structured pico8-not-found / shrinko-not-found boundaries. Use when a cart misbehaves or you need to confirm it boots.
---

# picopilot debug

Static checks tell you a cart is well-formed; only running it tells you it works.
picopilot gives you both a static gate and a headless run so you can drive a
closed loop. (See `picopilot-overview` for the `#include` discipline and
`picopilot-code` for the token loop.)

## Static first: `picopilot verify`

`picopilot verify` runs tokens + integrity and returns ONE structured pass/fail
envelope. It is STATIC and NEVER runs the cart, so:

- A green verify means "well-formed", NOT "it runs". The passing result points
  you at `picopilot run` to confirm the cart boots. Do not stop at green.
- A fail lists WHICH check flunked (over budget, or a malformed cart), so you fix
  the named thing.
- With shrinko absent, verify is `gate-incapable` (a distinct nonzero outcome,
  NEVER green): it cannot check token bloat, so it refuses to report pass.

## Then run it: `picopilot run`

`picopilot run` launches PICO-8 headless, captures `printh` debug output and the
exit state, and CTAs to `lint`/`tokens` on failure. Use `printh("...")` in your
Lua as your trace: it prints to host stdout, which `run` captures for you.

`run` requires PICO-8 (a licensed, paid binary with no pip/npm path). If PICO-8
is absent, `run` returns a structured `pico8-not-found` result with a remedy
(`set PICO8_PATH or install PICO-8`) and a nonzero exit, not a crash or a hang.
Use the static `verify` loop while PICO-8 is unavailable; it never needs it.

## The two structured boundaries

Both dependency boundaries are soft and well-signposted, so read the result, do
not guess:

- `shrinko-not-found` (remedy `uv pip install shrinko`): gates the token/lint
  commands and therefore `verify`.
- `pico8-not-found` (remedy `set PICO8_PATH or install PICO-8`): gates `run`,
  `audio render`, and binary/PNG exports.

Each is a structured `{ ok: false, reason, remedy }` envelope with a nonzero
exit, telling you exactly which capability is gated and how to enable it.
