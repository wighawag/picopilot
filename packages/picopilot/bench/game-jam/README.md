# picopilot game-jam benchmark

A reproducible, timed, themed autonomous game-jam benchmark for the `agent + picopilot` combo. It answers: **given a generic theme and N minutes, working fully alone, can the agent ship a PLAYABLE PICO-8 game?**

This is a PROTOTYPE (v1). It is a standalone script that orchestrates an agent, deliberately NOT a `picopilot` command (running agents is above picopilot's transpile-and-verify remit). It drives the `pi` agent DIRECTLY (pure session continuation, no subagent tool / no extension dependency), and STEERS (rather than interrupts): between turns it injects "time remaining" reminders into the same session.

## Run it

```sh
# from packages/picopilot (after `pnpm build`):
./bench/game-jam/run-jam.sh                       # random theme, 50 minutes
./bench/game-jam/run-jam.sh --theme gravity --minutes 50
./bench/game-jam/run-jam.sh --minutes 3 --no-judge   # fast smoke test
```

Options: `--theme <t>` (else random from `themes.txt`), `--minutes <n>` (default 50), `--model <m>` (agent/judge model), `--workdir <dir>` (default an isolated temp dir), `--no-judge`.

## How it works

1. **Brief.** Picks a theme (generic, multi-layer; see `themes.txt`), fills `prompt.md`, and launches the agent in an isolated scratch workdir with the full jam brief + the picopilot workflow.
2. **Timed turn-loop + STEERING.** The agent works in bounded `pi` turns (session-continued, so context persists). Between turns, at 25/50/75/90/97% of the budget elapsed, the harness injects a "TIME REMAINING: ~N min" reminder (early = "get to a playable slice"; late = "STOP polishing, make sure it boots + is playable"). This is steering, not interrupting: no running turn is killed.
3. **Deadline capture (Tier 0/1, objective).** At the deadline the harness stops the agent and records playability artifacts with picopilot itself: `verify` (static gate), a headless `run` (does it boot? screenshots), a scripted `run --input` (does it respond to input? compare screenshots), `tokens`.
4. **Judge (Tier 2, subjective).** An independent `pi` agent scores the entry against `judge.md`'s rubric: PLAYABLE (gate), THEME FIT, MECHANIC ORIGINALITY (weighted highest), EXECUTION, POLISH, plus an overall verdict + a weighted /100.

## Files

- `run-jam.sh`: the harness (timer + steering + capture + judge).
- `prompt.md`: the jam brief given to the agent (`__THEME__`/`__MINUTES__`/`__PICOPILOT__` substituted).
- `judge.md`: the judge rubric.
- `themes.txt`: the generic theme bank.
- `<workdir>/main.p8`, `JAM.md`, `bench-artifacts/`: an entry's output.

## Known rough edges (v1 prototype)

- **Steering granularity is between-turns.** A reminder lands when the current turn ENDS, so a very long turn can overshoot a threshold. Fine-grained mid-turn steering would need `pi --mode rpc` streaming (a v2 refinement).
- **"Playable" is only partly automatable.** Tier 0/1 (boots, player-visible, reaches play) is objective; "is it a fun game" is the judge-agent's call (or a human's).
- **Live-gameplay capture uses an input-transform** (`drive-capture.sh`): it redefines the entry's `btn`/`btnp` (on a throwaway copy) to read a harness-piped serial channel and drives the cart into active play, so `shots-play/` shows real gameplay (not the title). Its generic input drives one-button/runner/flappy shapes; a game with an unusual control scheme may need a per-entry input spec.
- **Invisible-player guard.** `check-playable.sh` flags `spr(n)` on an empty sprite (an invisible player); the harness steers the agent to fix it, and the prompt tells the agent to draw what it `spr()`s (or use primitives).
- **Audio can't be judged headlessly** (ADR-0009: recording needs a real A/V session), so audio is not scored beyond "it's present".
- A real 50-minute run costs real model tokens/time; use `--minutes 3 --no-judge` to smoke-test the harness mechanics cheaply.
