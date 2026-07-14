/**
 * The RESUMABLE playtest SESSION handshake core (ADR-0011, spec US #6): the pure,
 * CI-testable half of the "A" live model. It keeps a single driven PICO-8 process
 * ALIVE and PAUSED between the agent's turns and drives it one command at a time
 * over the verified transport: write a FIXED-SIZE command block, WAIT for the
 * cart's ACK line on stdout, then return. The handshake (not wall-clock spacing)
 * is what makes stepping deterministic and lossless, so the agent always acts on
 * a SETTLED, known frame.
 *
 * This module owns ONLY the send -> wait-ack -> return logic against the
 * {@link Pico8Process} seam (the same seam the one-shot `drive` uses), so every
 * path (a completed step, a lost/late ack, the process dying mid-command) is
 * unit-tested against a FAKE process WITHOUT the paid binary. The daemon that
 * spawns the real process and exposes the session to separate CLI invocations by
 * id lives in `supervisor.ts`; a live multi-turn session is the manual/opt-in
 * tier. The cart-side transform is reused UNCHANGED from `drive.ts`.
 */

import {ACK, BLOCK_SIZE, encodeCommand} from './drive.js';
import type {Pico8Process} from './shell.js';

/**
 * A structured reason a session command could not complete (a boundary, not a
 * crash). Surfaced by the supervisor/command as incur's `error({code,...})`.
 */
export type SessionErrorCode =
	/** No ACK arrived within the deadline (the lost/late-ack path). */
	| 'playtest-session-ack-timeout'
	/** PICO-8 exited (crashed/quit) while a command was in flight or between them. */
	| 'playtest-session-process-dead'
	/** A command was issued after the session was already stopped/closed. */
	| 'playtest-session-closed';

/** A structured session-command failure (never a raw throw across the seam). */
export class SessionError extends Error {
	readonly code: SessionErrorCode;
	constructor(code: SessionErrorCode, message: string) {
		super(message);
		this.name = 'SessionError';
		this.code = code;
	}
}

/**
 * How long a single command waits for its ACK before it is declared lost (the
 * lost/late-ack path). Generous: a STEP of many frames takes real time at 30fps,
 * plus PICO-8 scheduling jitter, but a hung/dead cart must not wall the session
 * forever. The supervisor's process-death signal (see {@link DriveSession}) ends
 * a command EARLY when the process dies, so this only fires for a truly stuck
 * cart.
 */
export const DEFAULT_ACK_TIMEOUT_MS = 15_000;

/** The result of one completed session command (the structured per-verb envelope). */
export interface StepResult {
	/** The total frames advanced across the session's lifetime so far. */
	readonly frame: number;
	/** The ACK line the cart printed for this command (the settled-frame proof). */
	readonly ack: string;
}

/** The result of a `shot` command: the frame + the basename the cart named it. */
export interface ShotResult extends StepResult {
	/** The screenshot basename the cart queued (`<basename><n>`), for collection. */
	readonly shotName: string;
}

/**
 * A stateful line reader over a PICO-8 stdout stream: the cart's `printh` ACKs
 * and the done-sentinel land line-by-line, but the OS delivers stdout in
 * arbitrary chunks. This buffers partial lines and lets a waiter await the NEXT
 * line matching a predicate, so the handshake is exact (an ACK is a whole line,
 * never a substring of unrelated output). Mirrors `SentinelWatcher`'s line
 * discipline; kept separate because the session awaits a SPECIFIC ack, not a
 * single terminal sentinel.
 */
class AckLineReader {
	private buffer = '';
	private readonly pending: {
		match: (line: string) => boolean;
		resolve: (line: string) => void;
	}[] = [];
	/** Lines seen but not yet consumed by a waiter (an ACK that raced ahead). */
	private readonly queued: string[] = [];

	/** Feeds a raw stdout chunk; resolves any waiter its lines satisfy. */
	push(chunk: string): void {
		this.buffer += chunk;
		let nl: number;
		while ((nl = this.buffer.indexOf('\n')) !== -1) {
			let line = this.buffer.slice(0, nl);
			if (line.endsWith('\r')) line = line.slice(0, -1);
			this.buffer = this.buffer.slice(nl + 1);
			this.deliver(line);
		}
	}

	private deliver(line: string): void {
		// A waiter already parked for this line consumes it; else queue it so a
		// waiter that parks AFTER the cart printed can still find it.
		const idx = this.pending.findIndex((p) => p.match(line));
		if (idx !== -1) {
			const [waiter] = this.pending.splice(idx, 1);
			waiter!.resolve(line);
		} else {
			this.queued.push(line);
		}
	}

	/**
	 * Awaits the next line satisfying `match`. If such a line was already seen
	 * (queued) it resolves synchronously-soon; otherwise it parks until one
	 * arrives. The caller races this against a timeout / process-death signal.
	 */
	waitFor(match: (line: string) => boolean): Promise<string> {
		const idx = this.queued.findIndex(match);
		if (idx !== -1) {
			const [line] = this.queued.splice(idx, 1);
			return Promise.resolve(line!);
		}
		return new Promise<string>((resolve) => {
			this.pending.push({match, resolve});
		});
	}
}

/** Options for a {@link DriveSession}. */
export interface DriveSessionOptions {
	/** The already-spawned live driven process (owned by the caller/supervisor). */
	readonly process: Pico8Process;
	/** Per-command ACK deadline (defaults to {@link DEFAULT_ACK_TIMEOUT_MS}). */
	readonly ackTimeoutMs?: number;
	/**
	 * The screenshot basename the driven cart's SHOT names each capture (matches
	 * the transform's `shotBasename`); the session reports `<basename><n>`.
	 */
	readonly shotBasename: string;
}

/**
 * The live-session handshake engine (ADR-0011, US #6). Wraps ONE driven
 * {@link Pico8Process} and exposes the agent's verbs: {@link input} (set the
 * held-buttons byte), {@link step} (advance exactly N frames), {@link shot}
 * (capture the frozen current frame), {@link stop} (tear the session down). Each
 * verb WRITES a single fixed-size command block and AWAITS the cart's ACK before
 * resolving, so the process stays alive + paused between verbs and the caller
 * always acts on a settled frame. Between the ACK and the next verb the game is
 * frozen (its callbacks skipped, a stable framebuffer), so a {@link shot} always
 * captures exactly the intended moment.
 *
 * The engine is transport-agnostic: it talks to the {@link Pico8Process} seam,
 * so the send/wait/return + lost-ack + process-death paths are unit-tested
 * against a FAKE process with no real binary. The supervisor supplies a REAL
 * spawned process for a live session (the manual/opt-in tier).
 */
export class DriveSession {
	private readonly proc: Pico8Process;
	private readonly reader = new AckLineReader();
	private readonly ackTimeoutMs: number;
	private readonly shotBasename: string;
	private frames = 0;
	private shotIndex = 0;
	/** Set once the process dies; every in-flight + future command rejects. */
	private dead = false;
	private closed = false;
	private readonly deathWaiters: (() => void)[] = [];

	constructor(options: DriveSessionOptions) {
		this.proc = options.process;
		this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
		this.shotBasename = options.shotBasename;
		this.proc.onStdout((chunk) => this.reader.push(chunk));
		this.proc.onClose(() => this.markDead());
		this.proc.onError(() => this.markDead());
	}

	/** Total frames the session has advanced so far. */
	get frame(): number {
		return this.frames;
	}

	/** Whether the underlying process has died (crashed/quit). */
	get isDead(): boolean {
		return this.dead;
	}

	private markDead(): void {
		if (this.dead) return;
		this.dead = true;
		for (const w of this.deathWaiters.splice(0)) w();
	}

	/**
	 * Sets the per-frame HELD-buttons byte for the upcoming steps (US #6: inject
	 * input between turns). Writes an INPUT block and awaits its ACK. The held
	 * level persists until the next INPUT (the cart holds it), and `btnp` edges
	 * are reconstructed cart-side from the held sequence.
	 */
	async input(held: number): Promise<StepResult> {
		await this.send({op: 'input', held: held & 0xff}, ACK.input);
		return {frame: this.frames, ack: ACK.input};
	}

	/**
	 * Advances EXACTLY `frames` frames then pauses (US #6, US #4). Writes a STEP
	 * block and awaits the STEP-DONE ack, which the cart prints only when the
	 * frame budget reaches 0, so the returned result means the N frames ACTUALLY
	 * ran and the game is now paused on a settled frame. `frames` must fit one
	 * byte (the block's arg); larger spans are issued as repeated steps by the
	 * caller.
	 */
	async step(frames: number): Promise<StepResult> {
		if (frames <= 0) return {frame: this.frames, ack: ACK.stepDone};
		await this.send({op: 'step', frames: frames & 0xff}, ACK.stepDone);
		this.frames += frames;
		return {frame: this.frames, ack: ACK.stepDone};
	}

	/**
	 * Captures the current (paused, frozen) frame (US #6, US #5). Writes a SHOT
	 * block and awaits its ACK; the cart renders the frozen state once then
	 * screenshots it, so the capture is exactly the intended moment. Returns the
	 * `<basename><n>` the cart named it, which the supervisor collects from the
	 * `-desktop` dir.
	 */
	async shot(): Promise<ShotResult> {
		await this.send({op: 'shot'}, ACK.shot);
		const shotName = `${this.shotBasename}${this.shotIndex}`;
		this.shotIndex += 1;
		return {frame: this.frames, ack: ACK.shot, shotName};
	}

	/**
	 * Tears the session down: writes a QUIT block (the cart prints the sentinel so
	 * the launcher kills PICO-8), then kills the process as the backstop. Does NOT
	 * await an ACK (QUIT ends the cart), and is idempotent + safe on a dead
	 * process. After `stop`, every verb rejects with `playtest-session-closed`.
	 */
	stop(): void {
		this.closed = true;
		if (!this.dead) {
			try {
				this.proc.writeStdin?.(encodeCommand({op: 'quit'}));
			} catch {
				// A closed stdin (already exiting) is fine; the kill below finishes it.
			}
		}
		this.proc.kill();
		this.markDead();
	}

	/**
	 * The core handshake: write one command block, then race the ACK line against
	 * the timeout and the process-death signal. A missing ACK within the deadline
	 * is the structured lost/late-ack error; a process that dies mid-command is the
	 * structured process-dead error. Never a hang, never a silent success.
	 */
	private async send(
		cmd: Parameters<typeof encodeCommand>[0],
		ackLine: string,
	): Promise<void> {
		if (this.closed) {
			throw new SessionError(
				'playtest-session-closed',
				'the playtest session is stopped; start a new one',
			);
		}
		if (this.dead) {
			throw new SessionError(
				'playtest-session-process-dead',
				'PICO-8 exited; the playtest session is dead (start a new one)',
			);
		}

		const block = encodeCommand(cmd);
		if (block.length !== BLOCK_SIZE) {
			// Defensive: the transport is fixed-size by construction; a mismatch is a
			// codec bug, surfaced loudly rather than sent as a short (coalescing) write.
			throw new SessionError(
				'playtest-session-closed',
				`encoded command block is ${block.length} bytes, expected ${BLOCK_SIZE}`,
			);
		}

		// Park the ACK waiter BEFORE writing, so an ACK the cart prints promptly is
		// never missed between the write and the await.
		const ackP = this.reader.waitFor((line) => line === ackLine);
		this.proc.writeStdin?.(block);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeoutP = new Promise<'timeout'>((resolve) => {
			timer = setTimeout(() => resolve('timeout'), this.ackTimeoutMs);
		});
		const deathP = new Promise<'dead'>((resolve) => {
			if (this.dead) resolve('dead');
			else this.deathWaiters.push(() => resolve('dead'));
		});

		try {
			const outcome = await Promise.race([
				ackP.then(() => 'ack' as const),
				timeoutP,
				deathP,
			]);
			if (outcome === 'timeout') {
				throw new SessionError(
					'playtest-session-ack-timeout',
					`no ACK "${ackLine}" within ${this.ackTimeoutMs}ms (the cart may have hung or faulted)`,
				);
			}
			if (outcome === 'dead') {
				throw new SessionError(
					'playtest-session-process-dead',
					`PICO-8 exited before ACK "${ackLine}" (the session is dead)`,
				);
			}
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}
}
