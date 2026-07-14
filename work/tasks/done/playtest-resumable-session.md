---
title: playtest resumable session, a live, steppable, agent-addressed playtest the agent plays across turns
slug: playtest-resumable-session
spec: playtest-drive-and-capture
blockedBy: [playtest-one-shot-drive-capture]
covers: [6]
---

## What to build

The resumable, LIVE playtest session (prd US #6, the "A" model): keep a driven PICO-8 alive and paused between the agent's turns so the agent can PLAY its own game interactively, look at the last frame, decide, inject more input, step/resume, look again. This is the novel high-value piece; it builds on the SAME cart-side drive-transform + opcode protocol the one-shot task ships, so this task adds the host-side SESSION lifecycle, not a second engine.

The transport is DECIDED + spike-verified in the prd: a persistent driven `pico8 -x` process, fixed-size command blocks in over stdin, a stdout ACK handshake (the host waits for the cart's ack before the next command) so stepping is deterministic and no command is lost.

End-to-end vertical (session lifecycle -> command verbs -> capture -> tests):

- **Session lifecycle over the verified protocol (A):** `picopilot playtest start <cart> [--seed n]` launches the persistent driven process and returns a SESSION ID the agent addresses across turns; `playtest step <id> --frames N` advances exactly N frames (waiting for the ACK); `playtest input <id> "<buttons>"` injects held-buttons for upcoming frames; `playtest shot <id>` captures the current (paused) frame; `playtest stop <id>` tears it down. The session holds the live process + its stdin/stdout; each verb is a sub-invocation that talks to it (a small supervisor owning the pipe, addressed by id) and returns a structured result (the new screenshot path, the ACK/printh output, the frame count).
- **Deterministic step/pause via the ACK handshake:** each verb sends its command block, WAITS for the cart's ACK on stdout, then returns, so the agent always acts on a settled, known frame. Between verbs the game is PAUSED (frozen, stable framebuffer), so a `shot` always captures exactly the intended moment.
- **Lifecycle robustness:** orphan cleanup (a session whose agent never `stop`s it), a session that outlives a timeout, PICO-8 dying mid-session -> a structured error, and the `pico8-not-found` absence path on `start`. One session per id; document whether multiple concurrent sessions are allowed.
- **Document the free "C" (stateless replay) alternative** in the `picopilot-debug` skill: an agent can also "resume" by re-invoking one-shot `playtest` with an ACCUMULATING opcode script (+ `--seed`), re-running from frame 0 each time, cheap + reproducible, no daemon; A is for true live continuity / long or replay-unsafe games. (No code for C; it falls out of the one-shot task.)

## Acceptance criteria

- [ ] `playtest start` returns a session id; `step`/`input`/`shot`/`stop` address that id and each return a structured result (screenshot path / ack / frame count).
- [ ] Stepping is deterministic via the ACK handshake: N frames requested advances EXACTLY N (verified against a counter cart), and a `shot` between steps captures the frozen intended frame.
- [ ] The session survives across multiple separate `step`/`input` invocations (the process stays alive + paused between them) and `stop` tears it down cleanly.
- [ ] Lifecycle robustness: an orphaned session is reaped (documented mechanism); PICO-8 dying mid-session -> a structured error, not a hang; `start` with PICO-8 absent -> `pico8-not-found` + nonzero.
- [ ] The host-side session/handshake logic is unit-tested against a FAKE driven process (assert: send-command -> wait-for-ack -> return; a lost/late ack path), no real binary in CI; a live multi-turn session (start -> step -> shot -> input -> step -> shot -> stop) is a MANUAL/opt-in tier.
- [ ] The `picopilot-debug` skill documents both the live session (A) and the free stateless-replay (C) patterns.
- [ ] **Shared-write:** session screenshots + the throwaway driven cart go to a controlled/temp dir; `~/Desktop` / carts root asserted untouched.

## Blocked by

- `playtest-one-shot-drive-capture`, this reuses that task's `engine/pico8` drive-transform + opcode protocol UNCHANGED (same cart-side machine) and extends the same command + module; serialize on it to avoid conflicts and to build on its verified transport.

## Prompt

> Goal: build the RESUMABLE playtest session (prd US #6, the "A" live model): a persistent, steppable, agent-addressed playtest so the agent PLAYS its game across turns (look -> inject -> step -> look). Add the host-side SESSION lifecycle on top of the one-shot task's already-verified cart-side transform + opcode protocol; do NOT re-invent the transform.
>
> FIRST read: `work/specs/tasked/playtest-drive-and-capture.md` (the session model A/C decision + the VERIFIED transport: persistent process, fixed-size command blocks, the stdout ACK handshake that makes stepping deterministic and lossless) and the landed `playtest-one-shot-drive-capture` task + its code (the drive-transform + opcode protocol you reuse). Confirm the one-shot task shipped and its transform is structured for reuse; if it drifted, do not build on a stale premise (route to needs-attention).
>
> Domain: `CONTEXT.md`; the `pico8-not-found` boundary mirrors `run`/`audio render`. The KEY reliability fact (verified, honour it): a persistent `pico8 -x` stdin needs FIXED-SIZE command blocks (small writes coalesce), and the STDOUT ACK HANDSHAKE (host waits for the cart's ack before the next command) is what makes stepping deterministic and lossless, build the session on the handshake, not on wall-clock spacing (that was the prototype's flakiness).
>
> Where to look: the one-shot `playtest` command + its `engine/pico8` drive-transform (extend, reuse the protocol); `engine/pico8` launch/adapter (the persistent-process + pico8-not-found seam); `src/skills/picopilot-debug/SKILL.md` (document A + the free C replay pattern). The session supervisor (owns the live process + pipe, addressed by id) is the new piece.
>
> PICO-8 CLI FOOTGUN: never `pico8 --help`/bare `pico8` (they hang). Only `pico8 -x` with a timeout backstop.
>
> Seam to test at: the host-side session/handshake logic against a FAKE driven process (send -> wait-ack -> return; lost-ack path), CI-safe; a live multi-turn session is the manual/opt-in tier. Done = an agent can `start` a session, `step`/`input`/`shot` across separate invocations against its id (game staying alive + paused between them), and `stop` it; with the free C replay pattern documented.
>
> RECORD non-obvious decisions in a `## Decisions` block (the session-id + supervisor transport, orphan-reaping, one-vs-many sessions, the verb surface). The session lifecycle is a candidate ADR if it clears the bar.
