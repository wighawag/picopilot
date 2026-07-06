# The `playtest` live session is a detached per-session daemon addressed by id over a Unix socket

The RESUMABLE playtest session (ADR-0011's "A" model, prd US #6) is implemented as a DETACHED background daemon, one per session, that owns the live `pico8 -x` process + its stdin/stdout and listens on a per-session Unix domain socket under a controlled temp dir. `playtest start` spawns the daemon and returns a SESSION ID (the socket's dir name); each later verb (`step`/`input`/`shot`/`stop`/`status`) is a SEPARATE CLI invocation that connects to that socket, runs one send-block -> wait-ACK -> return handshake against the daemon, and returns. This is the host-side lifecycle ADR-0011 deferred to the task; the cart-side transform + block+ACK transport are reused UNCHANGED.

## Context

ADR-0011 established that a live session keeps the driven PICO-8 alive + paused between the agent's turns, addressed by a session id, over the fixed-block + ACK transport. But the agent's turns are SEPARATE `picopilot` process invocations, and a one-shot CLI process cannot hold another process's pipe. So SOMETHING must outlive a single invocation to own the live process and its stdin/stdout. The concrete shape of that "something" (and its addressing, cleanup, and determinism) was left to this task.

The load-bearing determinism fact: a STEP must ACK on COMPLETION (the frame budget reaching 0), not when its command block is merely read, so the host learns the N frames ACTUALLY ran and acts on a settled frame. The one-shot ignored ACKs (it waits only for the QUIT sentinel), so this completion-ACK was added to the shim for the session; it is additive and harmless to the one-shot.

## Decisions

- **One detached daemon PER session, not a shared broker.** `start` spawns a background process (via `process.execPath` + `execArgv` on a daemon entry module, so it runs under the same loader in dev `tsx` or built `dist`) that wraps the live process in the pure `DriveSession` handshake and serves it. Per-session (not one broker for all sessions) keeps each session's failure/reap independent and the addressing trivial (the id IS the socket). MULTIPLE concurrent sessions are allowed (distinct ids -> distinct daemons/dirs); the tool does not serialize them.
- **Address by a session id = a dir under a controlled temp base; transport = a Unix domain socket.** The id maps (through a validated, traversal-safe registry) to `<tmp>/picopilot-playtest-sessions/<id>/` holding the socket, the throwaway driven cart, and the `-desktop` shot dir, never `~/Desktop` or the carts root. A Unix socket (not a pidfile + signals, not a TCP port) gives a clean request/response channel with no port allocation and filesystem-scoped access.
- **STEP acks on completion (budget==0), the other verbs at read time.** The shim prints `__PP_ACK_STEP_DONE__` when the budget drains, so a `step N` returns only after exactly N frames advanced. INPUT/SHOT/PAUSE complete their frame at read time and ack then. The host waits for the matching ACK before returning, racing it against a per-command deadline and a process-death signal, so a lost ack or a dead cart is a STRUCTURED error, never a hang.
- **Orphan reaping via an idle timer in the daemon.** A session the agent never `stop`s self-reaps after an idle window (default 10 min, reset by every verb): the daemon kills the live PICO-8 and removes the whole session dir. `stop` is idempotent and safe on an already-dead session. This bounds the leak from a walked-away session without a separate reaper process.

## Considered Options

- **A single long-lived broker daemon for all sessions (rejected).** More moving parts (a shared lifecycle, cross-session blast radius) for no gain; per-session daemons are simpler and isolate failures.
- **A pidfile + re-attach to the process's stdio each invocation (rejected).** You cannot re-attach to another process's already-owned stdin/stdout from a fresh process; the pipe must be held by a persistent owner. That owner IS the daemon.
- **A foreground interactive REPL (rejected).** The agent drives across SEPARATE tool invocations, not one interactive TTY session, so the state must persist out-of-process between calls.
- **Stateless replay only (rejected as the sole answer, kept as the free "C").** Re-invoking the one-shot with an accumulating script + `--seed` gives resumability with no daemon, and is documented as the cheap default. But it re-runs from frame 0 each turn and breaks for carts that reseed from a non-deterministic source mid-run, so the live session (A) is the dedicated build for true continuity.

## Consequences

- A NEW hidden daemon entry module + a `playtest` command GROUP. The one-shot moved from a bare `playtest <cart>` to `playtest run <cart>` so the session verbs are first-class siblings (`playtest start/step/input/shot/stop/status`); a bare positional-arg root would swallow the subcommand token (an incur constraint: a mounted root-cli's subcommands are dropped). The one-shot behaviour + flags are unchanged, only its path moved (the game-jam bench + tests updated).
- The CI-testable surface is the pure handshake core (`DriveSession` against a fake process: send -> wait-ack -> return, lost-ack, process-death), the id/path registry, and the frame codec, all no-binary. A live multi-turn session (real PICO-8) is the manual/opt-in tier.
- The session daemon is best-effort like the rest of `playtest` (ADR-0011): a cart that reassigns `_update` at runtime or drives its own coroutine loop may not pause/step correctly. It is a jam/debug tool, not a sandbox.
