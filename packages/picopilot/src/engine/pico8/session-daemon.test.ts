import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ACK, OPCODE} from './drive.js';
import {runDaemon, PICO8_NOT_FOUND_MARKER} from './session-daemon-main.js';
import {SessionClient, serveSession, sessionExists} from './session-daemon.js';
import type {Pico8Process, SpawnRunner} from './shell.js';
import {SessionRegistry, type SessionPaths} from './supervisor.js';

/**
 * The session DAEMON dispatch is CI-tested over a REAL Unix socket but a FAKE
 * driven process (no paid binary): a client verb round-trips through the daemon
 * to the handshake and back. The pico8-not-found marker path (start with PICO-8
 * absent) and the idle-reap are asserted too. A live end-to-end session (real
 * PICO-8) is the manual/opt-in tier.
 */

/** A fake driven process the test drives via ACK emission. */
class FakeDriven implements Pico8Process {
	private stdoutCb: (c: string) => void = () => {};
	private closeCb: (code: number | null) => void = () => {};
	private errorCb: (e: NodeJS.ErrnoException) => void = () => {};
	killed = false;
	writes: Uint8Array[] = [];
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
		// Auto-ACK: the fake cart acks the command it was just handed, so the daemon
		// round-trip completes deterministically (the ack CONTENT is the contract).
		this.writes.push(bytes);
		const op = bytes[0];
		queueMicrotask(() => {
			if (op === OPCODE.input) this.stdoutCb(`${ACK.input}\n`);
			else if (op === OPCODE.step) this.stdoutCb(`${ACK.stepDone}\n`);
			else if (op === OPCODE.shot) this.stdoutCb(`${ACK.shot}\n`);
		});
	}
	kill(): void {
		this.killed = true;
	}
	/** Simulate PICO-8 exiting mid-session. */
	die(): void {
		this.closeCb(0);
	}
}

let base: string;
let registry: SessionRegistry;
let paths: SessionPaths;
const daemons: {close: () => void}[] = [];

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), 'pp-daemon-'));
	registry = new SessionRegistry(base);
	paths = registry.create('run1');
});

afterEach(() => {
	for (const d of daemons.splice(0)) d.close();
	rmSync(base, {recursive: true, force: true});
});

function startFakeDaemon(proc: FakeDriven, idleTimeoutMs?: number) {
	const d = serveSession({
		id: 'run1',
		paths,
		process: proc,
		shotBasename: 'play',
		idleTimeoutMs,
	});
	daemons.push(d);
	return d;
}

/** Waits until the daemon's socket is listening (its readiness signal). */
async function waitSocket(): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (sessionExists(paths)) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error('socket never appeared');
}

describe('session daemon: verb round-trip over the socket (fake process)', () => {
	it('step advances frames and returns the structured result', async () => {
		startFakeDaemon(new FakeDriven());
		await waitSocket();
		const client = new SessionClient(paths.socket);
		const res = await client.send({verb: 'step', frames: 5});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value.frame).toBe(5);
			expect(res.value.ack).toBe(ACK.stepDone);
		}
	});

	it('a large step is issued as repeated <=255 sub-steps (exact + lossless)', async () => {
		const proc = new FakeDriven();
		startFakeDaemon(proc);
		await waitSocket();
		const res = await new SessionClient(paths.socket).send({
			verb: 'step',
			frames: 600,
		});
		expect(res.ok && res.value.frame).toBe(600);
		// 600 = 255 + 255 + 90 -> three STEP blocks written.
		expect(proc.writes.length).toBe(3);
	});

	it('status reports alive + the frame count without stepping', async () => {
		startFakeDaemon(new FakeDriven());
		await waitSocket();
		const res = await new SessionClient(paths.socket).send({verb: 'status'});
		expect(res.ok && res.value.alive).toBe(true);
		expect(res.ok && res.value.frame).toBe(0);
	});

	it('stop returns a clean final response then reaps the socket', async () => {
		startFakeDaemon(new FakeDriven());
		await waitSocket();
		const res = await new SessionClient(paths.socket).send({verb: 'stop'});
		expect(res.ok && res.value.alive).toBe(false);
		// After stop the socket is gone (the session is torn down).
		for (let i = 0; i < 100 && sessionExists(paths); i++) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(sessionExists(paths)).toBe(false);
	});

	it('a dead process surfaces process-dead on the next verb (not a hang)', async () => {
		const proc = new FakeDriven();
		startFakeDaemon(proc);
		await waitSocket();
		// Kill the fake mid-life: emit a close so the session marks itself dead.
		proc.die();
		const res = await new SessionClient(paths.socket).send({
			verb: 'step',
			frames: 1,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.code).toBe('playtest-session-process-dead');
	});
});

describe('session daemon: orphan idle-reap', () => {
	it('tears the session down after the idle window with no verbs', async () => {
		const proc = new FakeDriven();
		startFakeDaemon(proc, 40); // tiny idle window
		await waitSocket();
		for (let i = 0; i < 100 && sessionExists(paths); i++) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(sessionExists(paths)).toBe(false);
		expect(proc.killed).toBe(true); // the live process was reaped
	});
});

describe('runDaemon: PICO-8 absent -> structured marker (start absent path)', () => {
	it('writes the pico8-not-found marker on spawn ENOENT (no hang)', async () => {
		let exited = false;
		const realExit = process.exit;
		// runDaemon calls process.exit on ENOENT; stub it so the test survives.
		(process as {exit: unknown}).exit = ((): never => {
			exited = true;
			return undefined as never;
		}) as typeof process.exit;

		const enoentSpawn: SpawnRunner = () => {
			const proc: Pico8Process = {
				onStdout() {},
				onClose() {},
				onError(cb) {
					const err = new Error('enoent') as NodeJS.ErrnoException;
					err.code = 'ENOENT';
					queueMicrotask(() => cb(err));
				},
				kill() {},
				writeStdin() {},
			};
			return proc;
		};
		try {
			runDaemon(
				{
					id: 'run1',
					paths,
					cartPath: join(paths.dir, 'driven.p8'),
					shotBasename: 'play',
					idleTimeoutMs: 1000,
					ackTimeoutMs: 1000,
				},
				{},
				enoentSpawn,
			);
			await new Promise((r) => setTimeout(r, 20));
			const markerPath = join(paths.dir, PICO8_NOT_FOUND_MARKER);
			expect(existsSync(markerPath)).toBe(true);
			expect(readFileSync(markerPath, 'utf8')).toContain('pico8-not-found');
			expect(exited).toBe(true);
		} finally {
			(process as {exit: unknown}).exit = realExit;
		}
	});
});
