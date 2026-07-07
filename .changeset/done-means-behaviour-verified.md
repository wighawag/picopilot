---
"picopilot": patch
---

Make "done" mean the game's behaviour is verified, not just that a frame renders, so state-transition bugs (a pickup that never despawns, lives that do not reset on restart) get caught before handoff.

The scaffolded `AGENTS.md` build loop now tells the agent to SEE the cart PLAY (drive it via `picopilot playtest run` or the temporary `run` probe and compare a SEQUENCE of frames for motion and state change), and its definition of done requires driving the core loop and confirming state actually behaves. The check is deliberately GENERIC: it refuses a fixed mechanic checklist and instead tells the agent to enumerate the state transitions ITS OWN game defines and verify each (with a `printh` state-dump fallback), so it neither assumes mechanics the game lacks nor checks only a canned list and misses the rest.
