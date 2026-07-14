---
title: picopilot playtest replay, record a run's exact input timeline as a durable artifact and re-drive it deterministically
slug: playtest-replay
needsAnswers: true
taskedAfter: [playtest-drive-and-capture]
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/tasks/`.
>
> This prd EXTENDS `playtest-drive-and-capture` (ADR-0011/0012): that prd explicitly put "a general input-recording/replay format or a TAS-style tool" OUT of scope; this prd lifts exactly that into scope, as a thin layer on the SAME verified drive-transform + block/ACK transport, not a second engine.

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  Genuine product/design forks that need the human before this is tasked.
-->

## Open questions

1. **Determinism guarantee, how hard?** PICO-8 `rnd()` without a seeded state is not reproducible, so a byte-identical re-drive is only guaranteed for carts that are seed-controllable. Which do we commit to: (a) MINIMAL, "same cart + same input timeline + same `--seed`", and DOCUMENT that a cart reseeding from a non-deterministic source (wall-clock/entropy) may diverge (matches the live-session's own reason-to-exist); (b) STRICT, replay also injects/records the seed automatically and warns when a cart reads entropy we cannot control; or (c) capture the FRAMEBUFFER hashes at record time and, on replay, ASSERT they match (a self-verifying replay that flags divergence)? Lean: (a) now, with the artifact carrying the seed so (c) is a later add. Needs the human's call on how strong a promise we make.
2. **Record: always-on or opt-in?** Should `playtest run` / the live session ALWAYS write a replay artifact into the shot-dir, or only on `--record <dir>`? Always-on makes every jam entry carry its replay for free (the motivating use), but writes an artifact even when unwanted. Lean: opt-in flag, with the jam harness passing it. Needs a call.
3. **Watchable output, in scope now or later?** Minimal replay re-captures SHOTS. Rich replay also emits a GIF / frame-strip / short video of the run as a directly-watchable artifact. Is the watchable render in THIS prd, or a fast-follow once the record/replay format exists? Lean: format + shot re-capture now; the GIF/strip as a separate task (or a later prd) so the core lands first. Needs a call.
4. **Artifact format + versioning.** The replay artifact generalizes today's `drive.json` (which the bench writes) into a re-drivable, versioned record (cart id + hash, input timeline, seed, frame count, tool version, optional shot manifest). Do we EVOLVE `drive.json` in place (and migrate the bench), or introduce a NEW named artifact (e.g. `replay.json`) and leave `drive.json` as the raw capture log? Lean: a new versioned `replay.json` that supersedes `drive.json`'s re-drive role; the bench emits both during transition. Needs a call.

<!-- /open-questions -->

## Problem Statement

`picopilot playtest` can drive an arbitrary cart and capture gameplay, but a run is EPHEMERAL: once it finishes, there is no first-class, durable artifact that says "here is exactly what was played, this cart, this input timeline, producing these frames," and no way to reproduce it. Concretely, this bit us:

- When the user played a jam entry and found real design defects (a forced-loss trap, superhuman difficulty), the ONLY way to reconstruct what the agent actually played was to grep the agent's `playtest --input` strings out of the pi session log and mentally replay them. There is no artifact to open, and nothing to re-run.
- An agent treats `playtest` as a throwaway PROBE: it drives, looks, and discards. It cannot save a run it wants to revisit, hand a run to a judge or a human to watch, or diff two runs.
- A benchmark entry ships with raw shots + a `drive.json` capture log, but that log is not a re-drivable record: you cannot press play on it.

The user asked for exactly this: "save the run in a folder so later we can inspect exactly what the agent played," a replay.

## Solution

`picopilot playtest replay`: record a playtest run as a self-contained, versioned REPLAY artifact, and re-drive that artifact deterministically to reproduce the run.

- **Record.** A `playtest run` (and, later, a live session) can persist the full run as a replay artifact: the exact input timeline (frame -> button events, the same grammar `--input` already accepts), the cart identity (path + content hash), the determinism inputs (`--seed`, frame count), the tool version, and a manifest of the captured shots. Enough to re-drive it identically (subject to Open question 1's guarantee).
- **Replay.** `picopilot playtest replay <artifact>` re-drives the SAME cart with the SAME input timeline through the existing drive-transform, reproducing the run and re-capturing shots (and, per Open question 3, optionally a watchable strip/gif). A human, a judge agent, or a later debugging session can then see exactly what happened, not a paraphrase.
- **Thin layer, one engine.** Record/replay reuses the SAME cart-side drive-transform + fixed-block/ACK transport the one-shot and live session already use (ADR-0011/0012). Replay is `playtest run` fed from a recorded timeline instead of a live `--input` string; record is serialising the timeline `playtest run` already holds. No second driver.

This turns a play into an INSPECTABLE, reproducible artifact, and it is the substrate for the game-design tooling we deferred (the fairness-probe: drive every rest state and assert a non-fatal move exists is, mechanically, record-and-check runs; see `work/notes/ideas/game-jam-design-skill.md`).

## User Stories

1. As an agent, I want to RECORD a `playtest run` as a durable replay artifact in a folder, so a run I care about survives past the turn that produced it.
2. As a human, I want to open a benchmark/jam entry's folder and find a replay of exactly what the agent played, so I can inspect (and reproduce) the run without grepping a session log.
3. As an agent (or a judge), I want `picopilot playtest replay <artifact>` to re-drive the recorded cart with the recorded input timeline and re-capture the gameplay, so I can reproduce a run deterministically (subject to the documented determinism guarantee).
4. As a developer, I want the replay artifact to be a VERSIONED, self-describing record (cart id + content hash, input timeline, seed, frame count, tool version, shot manifest), so an artifact recorded by one version is read honestly (or refused with a clear reason) by another.
5. As an agent, I want `replay` to detect when the target cart's content hash does NOT match the recorded one and tell me (rather than silently replaying against a changed cart), so a stale replay is a clear signal, not a confusing mismatch.
6. As an agent, I want `replay` to return the SAME structured envelope family as `playtest run` / `run` (shot paths, captured printh, steps run, exit reason), so I consume it uniformly.
7. As an agent, I want `replay` to require PICO-8 and return the structured `pico8-not-found` (remedy + nonzero exit) when it is absent, mirroring `run`/`playtest`, never a crash or hang.
8. As a benchmark author, I want the game-jam harness to record a replay for every entry (so each curated sample carries a re-playable record), reusing ONE tested path rather than a bespoke serialiser.
9. As a developer, I want the record/replay serialisation to be a tested `engine/pico8` seam (a run's timeline + metadata <-> the artifact, round-trip), so its correctness is unit-tested without the paid binary, and the live re-drive is the manual/opt-in tier (mirroring how `playtest`'s transform is tested vs its live capture).
10. As a future consumer, I want the replay artifact + re-drive to be the substrate a FAIRNESS-PROBE can build on (record many short drives from rest states; assert a non-fatal move exists), so the deferred game-design tooling has a foundation and is not a second engine. (The probe itself is out of scope here.)

### Autonomy notes (the two gate axes)

- **`humanOnly`:** omitted (no part is never-for-agents by nature; tasking is normal once the questions are answered).
- **`needsAnswers`: true.** Four genuine product/design forks (determinism guarantee, record on-by-default vs opt-in, watchable-output scope, artifact format/versioning) are listed in `## Open questions` above with a lean each. They are cheap for the human to settle and expensive to guess (they shape the artifact contract and the promise we make). Task after they are answered.

## Implementation Decisions

Settled at launch (the forks are in Open questions):

- **Built ON the existing seam, not beside it.** Reuse the ADR-0011 drive-transform + fixed-block/ACK transport and ADR-0012 session machinery. Replay = a recorded timeline fed into the same drive path; record = serialising that timeline + metadata. No new driver, no new transport.
- **The input grammar is already unified** (`--input` accepts button names/keys/bits and frame/hold timelines, per the recent grammar-unification fix). The recorded timeline uses that same grammar, so a recorded artifact is human-readable and hand-editable.
- **Envelope + dependency boundary parity:** `replay` returns the `run`/`playtest` structured envelope family and the same `pico8-not-found` boundary.
- **A content HASH of the cart is recorded** so a replay can detect a changed cart (US 5).

> Trimmed at tasking-time into tasks / an ADR (the durable rationale: replay is a thin record/re-drive layer over the ADR-0011 transform; the versioned artifact contract).

## Testing Decisions

- The record/replay SERIALISER is a pure `engine/pico8` seam, unit-tested by round-trip (timeline + metadata -> artifact -> back) and by the cart-hash mismatch path, no PICO-8 needed.
- The live re-drive (artifact -> reproduced gameplay) is the manual/opt-in tier, like `playtest`'s live capture: a smoke test that a recorded run re-drives to the same shot count / exit reason.
- Prior art: `playtest`'s own transform tests (`engine/pico8/drive.test.ts`) and the existing `drive.json` the bench already writes.

## Out of Scope

- **The fairness-probe itself** (drive every rest state, assert a non-fatal move exists). This prd provides the record/replay SUBSTRATE it would use; the probe is its own future item (`work/notes/ideas/game-jam-design-skill.md`).
- **An "is it fun" judge.** Unchanged from the drive prd: replay is eyes/reproduction, not a critic.
- **A full TAS ecosystem** (input editors, rerecording UI, movie formats). The artifact is a simple versioned record in picopilot's own grammar, not a general tool-assisted-speedrun platform.
- **Web-export / browser replay.** Native `pico8 -x` + serial path only, consistent with the drive prd.

## Further Notes

Motivating thread: the 50-minute jam runs where the human found shipped design defects and we had to reconstruct the play from the session log. Captured as `work/notes/ideas/playtest-replay-record-and-replay.md` (this prd supersedes that idea note's framing). Build path (per the idea note): grill the four open questions, task, then build via the dorfl `drive-tasks` conductor (propose mode; the human does gate-3 review + merge).
