# game-jam harness broke on a `pi` CLI flag rename (`--session-id`, `--approve` removed)

Spotted: 2026-07-06, while running the 50-minute game-jam (`bench/game-jam/run-jam.sh`).

## What happened

A full 50-minute run produced an EMPTY entry (no `main.p8`, no `JAM.md`, zero screenshots). Every single `pi` turn failed instantly with:

```
Error: Unknown options: --session-id, --approve
```

The harness tight-looped ~1500 failed invocations across 50 minutes of wall-clock, steering a session that never existed. The deadline capture then reported "no main.p8 produced, the entry is empty."

## Root cause

The installed `pi` CLI (at `~/dev/github/wighawag/pi-remote/server/node_modules/.bin/pi`) had its flags changed since the last successful jam run earlier the same day (the 08:26 and 08:48 runs still produced full entries). Two flags the harness relied on are gone:

- `--session-id <id>`: used to CREATE-OR-CONTINUE a named session. Replaced by `--session <path|id>`, which only LOOKS UP an existing session (a partial UUID or a file path); it does not create. Passing an unknown id now errors with `No session found matching '<id>'`.
- `--approve`: auto-approved tool calls in non-interactive mode. Gone entirely. In `-p`/`--print` mode tools now auto-run (no interactive approval is possible there), so no flag is needed.

## The failure was silent-ish and expensive

The harness caught the error per-turn (`2>&1 | tail -40`) but did not ABORT: `run_turn` has no health check, so a 100%-error run still burned the full 50-minute budget before the empty-entry capture. A fast-fail (e.g. abort if the first turn produces no session file within N seconds, or if the first turn's output matches `Error: Unknown options`) would have saved ~50 minutes.

## Fix applied (uncommitted, in the working tree)

`bench/game-jam/run-jam.sh`:
- First turn: `pi -p <msg>` (no session flag -> auto-creates a session under the cwd-derived dir in `~/.pi/agent/sessions/`).
- Continuation turns: locate that session file by globbing `~/.pi/agent/sessions/*<workdir-basename>*/*.jsonl` (the timestamped workdir slug is embedded in pi's mangled dir name) and pass it via `--session <path>`.
- Dropped `--approve` from both the agent and judge invocations.
- Judge now runs with an explicit `--session-dir "$ART/judge-session"` so its session stays out of the agent's cwd-derived dir (they share `$WORKDIR` as cwd); preserves the old "agent session vs judge-* session" separation.

Smoke-tested with a 1-minute `--no-judge` run: agent built a playable entry, `verify` green, gameplay capture produced 3 shots, zero `Error: Unknown` lines, session file locatable.

## Follow-up worth considering

- Add a fast-fail health check to `run_turn` / the jam loop so a broken `pi` invocation aborts the run instead of burning the whole budget.
- The harness pins to whatever `pi` is on PATH; a CLI-contract change silently breaks it. A one-line preflight (`pi --help | grep -q ...`) or a smoke turn before the timed loop would catch this at t=0.
