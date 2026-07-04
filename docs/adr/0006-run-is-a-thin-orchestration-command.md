# `picopilot run` is a THIN orchestration command (sentinel-watch + collect), not a `pico8` wrapper

`picopilot run` launches the user's PICO-8 on a cart via `pico8 -x`, streams its stdout, and **terminates the run the moment the cart prints a done-sentinel** (e.g. `__PICOPILOT_DONE__` via `printh`), with a `timeout --signal=KILL` as a safety backstop. It then collects the results into one structured envelope: the screenshot PNG paths the cart produced (via `extcmd("screen")`, redirected with `-desktop <dir>`), the captured `printh` stdout, and the exit state. The agent reads the screenshots to *see the running game* (correctness + motion across consecutive frames) and the printh for text feedback. Verified by a spike (see `work/notes/findings/pico8-run-and-screenshot.md`).

## Considered Options

- **No command at all — skill-only (rejected, but partially true).** The raw mechanics (`pico8 -x`, `extcmd("screen")`, `printh`) ARE 100% PICO-8's own CLI and would add no value if merely wrapped — that part belongs in the `picopilot-debug` skill. What tips it to a command is the **orchestration**: streaming stdout, matching the done-sentinel, killing the process tree, and collecting screenshots + printh + exit into ONE structured result is real glue an agent should not hand-roll every run. The `picopilot-debug` skill still teaches the underlying recipe.
- **A blind `timeout <n>` wrapper (rejected).** Guessing a fixed duration wastes wall-time when the cart finishes early and truncates it when it needs longer. The **stdout-sentinel** (the cart signals done, the launcher kills on match) is deterministic — the cart runs exactly as long as its own logic needs. `timeout` stays only as the hang/error backstop.

## Consequences

- A cart CANNOT quit the PICO-8 app itself (`extcmd("shutdown")` works only in exported binaries), so external termination is mandatory — the sentinel-watch + backstop IS the quit mechanism.
- Screenshots require the CART to cooperate (self-screenshot via `extcmd("screen")` on a timer); there is no "screenshot an arbitrary running cart" hook. So `run` (or the skill) has the agent add debug capture lines to the cart, run, then revert them. A natural future expansion: `picopilot run` could inject/strip a standard screenshot+sentinel harness automatically.
- This supersedes the prd's original US #14 framing ("launch headless, capture printh + exit") — the command is the same idea, now shaped by the spike into sentinel-watch + screenshot-collect, and **expandable** from there.
- `run` hard-requires the user's licensed PICO-8; absent, it returns the structured `pico8-not-found` result (ADR-style, mirroring the shrinko boundary), never a crash.
