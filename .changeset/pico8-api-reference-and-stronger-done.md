---
"picopilot": patch
---

Ship a PICO-8 API reference and stop the agent guessing, and make "done" catch mislabeled outcomes and too-easy games. These target the exact ways a weak model wasted runs and shipped bugs.

- **New `reference/pico8-api.md` resource under `picopilot-code`:** the exact function names + signatures for the common API, plus a table of the wrong names an LLM reaches for (`rand`/`ranf`, `rectcol`, `math.floor`, `table.insert`, `poke4` for saving, `spr` with extra args) and their real PICO-8 equivalents. `picopilot-code` and the always-loaded `AGENTS.md` now point at it with a "do NOT guess an API name, look it up" rule, so a nil-call crash does not cost a whole playtest round. The resource ships to installed skills via the existing resource-copy seam.
- **Stronger definition of done in `AGENTS.md`:** beyond "state behaves, not just renders", it now adds two generic checks: drive EVERY distinct kind of interaction and confirm its effect has the intended SIGN (the classic bug is a hazard that adds score instead of costing a life), and run the design self-checks against what you actually saw (can the player genuinely lose, or is it too easy / does it escalate / is it fair). Kept generic, no fixed mechanic checklist.
