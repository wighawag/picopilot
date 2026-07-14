import {describe, expect, it, vi} from 'vitest';
import {ACK, BLOCK_SIZE, BlockDecoder, OPCODE} from './drive.js';
import {DriveSession, SessionError} from './session.js';
import type {Pico8Process} from './shell.js';

/**
 * The RESUMABLE session HANDSHAKE core is tested WITHOUT the paid PICO-8 binary
 * (ADR-0011, spec US #6): a FAKE driven process lets us assert the load-bearing
 * transport contract, each verb WRITES its fixed-size command block and WAITS for
 * the cart's ACK before returning (send -> wait-ack -> return), and the failure
 * paths (a lost/late ack, a process that dies mid-command) surface as STRUCTURED
 * errors, never a hang. A live multi-turn session is the manual/opt-in tier.
 */

/**
 * A controllable fake driven process: records the command blocks written to its
 * stdin, and lets the test emit ACK lines back on stdout (or die), so the
 * handshake is driven deterministically with no real binary.
 */
class FakeDriven implements Pico8Process {
	private stdoutCb: (c: string) => void = () => {};
	private closeCb: (code: number | null) => void = () => {};
	private errorCb: (e: NodeJS.ErrnoException) => void = () => {};
	killed = false;
	/** Every block written to stdin, decoded back into commands for assertions. */
	readonly writes: Uint8Array[] = [];

	onStdout(cb: (c: string) => void): void {
		this.stdoutCb = cb;
	}
	onClose(cb: (code: number | null) => void): void {
		this.closeCb = cb;
	}
	onError(cb: (e: NodeJS.ErrnoException) => void): void {
		this.errorCb = cb;
	}
	writeStdin(bytes: Uint8Array): void {
		this.writes.push(bytes);
	}
	kill(): void {
		this.killed = true;
	}

	// --- test drivers ---
	/** Emit a cart ACK line (the handshake's other half). */
	ack(line: string): void {
		this.stdoutCb(`${line}\n`);
	}
	/** Simulate PICO-8 exiting (crash/quit). */
	die(): void {
		this.closeCb(0);
	}
	/** The commands the session wrote so far (decoded from the fixed-size blocks). */
	get commands() {
		const dec = new BlockDecoder();
		const all: number[] = [];
		for (const w of this.writes) for (const b of w) all.push(b);
		return dec.push(all);
	}
}

const session = (proc: FakeDriven, ackTimeoutMs = 1000): DriveSession =>
	new DriveSession({process: proc, shotBasename: 'play', ackTimeoutMs});

describe('DriveSession: the send -> wait-ack -> return handshake', () => {
	it('input WRITES a fixed-size INPUT block and returns only after its ACK', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		const p = s.input(0b10010); // hold Right + O

		// The command was written as exactly one fixed-size block, and the call has
		// NOT resolved yet (it is waiting for the ACK).
		expect(proc.writes).toHaveLength(1);
		expect(proc.writes[0]!.length).toBe(BLOCK_SIZE);
		expect(proc.commands).toEqual([{op: 'input', held: 0b10010}]);

		proc.ack(ACK.input);
		const r = await p;
		expect(r.ack).toBe(ACK.input);
	});

	it('step advances the frame count only after the STEP-DONE ack (settled frame)', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		const p = s.step(5);
		expect(proc.commands).toEqual([{op: 'step', frames: 5}]);

		// The step-complete ACK (budget drained) is what resolves it, NOT read time.
		proc.ack(ACK.stepDone);
		const r = await p;
		expect(r.frame).toBe(5);
		expect(r.ack).toBe(ACK.stepDone);
	});

	it('an ACK that races AHEAD of the wait is not lost (queued)', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		// Emit the ACK synchronously right after the write, before the race parks.
		const p = s.step(3);
		proc.ack(ACK.stepDone);
		const r = await p;
		expect(r.frame).toBe(3);
	});

	it('shot returns the basename+index it queued, after the SHOT ack', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		const p = s.shot();
		expect(proc.commands).toEqual([{op: 'shot'}]);
		proc.ack(ACK.shot);
		const r = await p;
		expect(r.shotName).toBe('play0');
		// A second shot increments the index.
		const p2 = s.shot();
		proc.ack(ACK.shot);
		expect((await p2).shotName).toBe('play1');
	});

	it('steps are lossless across turns (the frame tally accumulates)', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		const p1 = s.step(4);
		proc.ack(ACK.stepDone);
		await p1;
		const p2 = s.step(6);
		proc.ack(ACK.stepDone);
		await p2;
		expect(s.frame).toBe(10);
	});
});

describe('DriveSession: the lost/late-ack path (never a hang)', () => {
	it('a missing ACK within the deadline is a structured ack-timeout error', async () => {
		vi.useFakeTimers();
		try {
			const proc = new FakeDriven();
			const s = session(proc, 500);
			const p = s.step(1).then(
				() => 'resolved',
				(e) => e,
			);
			// No ACK is ever emitted; advance past the deadline.
			await vi.advanceTimersByTimeAsync(600);
			const outcome = await p;
			expect(outcome).toBeInstanceOf(SessionError);
			expect((outcome as SessionError).code).toBe(
				'playtest-session-ack-timeout',
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a LATE ack (after the deadline) still does not resolve the timed-out call', async () => {
		vi.useFakeTimers();
		try {
			const proc = new FakeDriven();
			const s = session(proc, 300);
			const p = s.step(1).then(
				() => 'resolved',
				(e) => (e as SessionError).code,
			);
			await vi.advanceTimersByTimeAsync(400);
			proc.ack(ACK.stepDone); // arrives too late
			expect(await p).toBe('playtest-session-ack-timeout');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('DriveSession: PICO-8 dying mid-session (structured, not a hang)', () => {
	it('a process death while a command is in flight rejects with process-dead', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		const p = s.step(10).then(
			() => 'resolved',
			(e) => (e as SessionError).code,
		);
		proc.die(); // PICO-8 exits before the ACK
		expect(await p).toBe('playtest-session-process-dead');
		expect(s.isDead).toBe(true);
	});

	it('a command issued AFTER the process died is a structured process-dead', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		proc.die();
		await expect(s.step(1)).rejects.toMatchObject({
			code: 'playtest-session-process-dead',
		});
	});
});

describe('DriveSession: stop (teardown)', () => {
	it('writes a QUIT block, kills the process, and closes the session', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		s.stop();
		expect(proc.commands).toEqual([{op: 'quit'}]);
		expect(proc.killed).toBe(true);
		// A verb after stop is a structured closed error, not a hang.
		await expect(s.input(1)).rejects.toMatchObject({
			code: 'playtest-session-closed',
		});
	});

	it('is idempotent + safe on an already-dead process', () => {
		const proc = new FakeDriven();
		const s = session(proc);
		proc.die();
		expect(() => {
			s.stop();
			s.stop();
		}).not.toThrow();
		expect(proc.killed).toBe(true);
	});
});

describe('DriveSession: every command is a FIXED-SIZE block (the coalesce guard)', () => {
	it('input/step/shot/quit each write exactly BLOCK_SIZE bytes', async () => {
		const proc = new FakeDriven();
		const s = session(proc);
		const pi = s.input(1);
		proc.ack(ACK.input);
		await pi;
		const ps = s.step(2);
		proc.ack(ACK.stepDone);
		await ps;
		const psh = s.shot();
		proc.ack(ACK.shot);
		await psh;
		for (const w of proc.writes) expect(w.length).toBe(BLOCK_SIZE);
		// And the opcodes are the tagged protocol (not raw wall-clock writes).
		expect(proc.writes[0]![0]).toBe(OPCODE.input);
		expect(proc.writes[1]![0]).toBe(OPCODE.step);
		expect(proc.writes[2]![0]).toBe(OPCODE.shot);
	});
});
