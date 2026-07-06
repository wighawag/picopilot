---
title: playtest `run --input` (frame:bit) and the session `input` verb (button names) use DIFFERENT grammars, and an agent guesses wrong
slug: playtest-run-input-vs-session-input-grammar-mismatch
spotted: 2026-07-06
---

# `playtest run --input` and `playtest input` take different input syntaxes

Spotted watching a jam agent's session (the 86/100 flip-runner run). The agent tried `playtest run main.p8 --input "z"` and got a structured `playtest-input-invalid: bad input token "z": expected "frame:bit" or "from-to:bit"`. It had (reasonably) assumed button-NAME syntax, because the resumable session's `input` verb uses names.

The mismatch:
- **`playtest run <cart> --input "<script>"`** (one-shot) takes a `frame:bit` / `from-to:bit` timeline, e.g. `"3:4, 18-22:4, 20:1"` (bit 0=L 1=R 2=U 3=D 4=O 5=X).
- **`playtest input <id> "<buttons>"`** (live session) takes button NAMES, e.g. `"right o"` (left/right/up/down/o/x, or l/r/u/d).

Both are individually reasonable (a one-shot needs a timeline; a live-session `input` sets the held state for the upcoming steps), but the TWO surfaces of the SAME command group disagree, so an agent that learned one guesses the other wrong. The error is structured + helpful (it names the expected grammar), so recovery is cheap, but it is a friction point + a small inconsistency.

## Options (a later polish, not urgent)

- Accept button names in `run --input` too (e.g. a bare `o`/`right` = a press at frame 0, or a small superset grammar), so both surfaces share a vocabulary; OR
- Make the two grammars visibly, deliberately distinct in the help (they already differ in intent: a timeline vs a held-state), and cross-reference each in the other's help so an agent that knows one is pointed at the other; OR
- At minimum, keep the structured error (it already does the recovery work).

Low severity (structured error + easy fix), noted for a consistency pass on the `playtest` command surface.
