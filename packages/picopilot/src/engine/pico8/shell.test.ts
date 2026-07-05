import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {DONE_SENTINEL} from './adapter.js';
import {
	type Pico8Process,
	ShellPico8Adapter,
	type SpawnRunner,
} from './shell.js';

/**
 * The shell adapter's orchestration (launch, sentinel-kill, backstop, collect)
 * is exercised with a FAKE {@link SpawnRunner}, so every path is covered WITHOUT
 * the paid PICO-8 binary. Live runs against a real PICO-8 are a manual/opt-in
 * tier (mirroring the shrinko runner-absent discipline).
 */

/**
 * A controllable fake PICO-8 process: the test drives it by emitting stdout,
 * closing, or erroring, and records whether it was killed.
 */
class FakeProcess implements Pico8Process {
	private stdoutCb: (c: string) => void = () => {};
	private closeCb: (code: number | null) => void = () => {};
	private errorCb: (e: NodeJS.ErrnoException) => void = () => {};
	killed = false;

	onStdout(cb: (c: string) => void): void {
		this.stdoutCb = cb;
	}
	onClose(cb: (code: number | null) => void): void {
		this.closeCb = cb;
	}
	onError(cb: (e: NodeJS.ErrnoException) => void): void {
		this.errorCb = cb;
	}
	kill(): void {
		this.killed = true;
	}

	// Test drivers:
	emit(chunk: string): void {
		this.stdoutCb(chunk);
	}
	close(code: number | null = 0): void {
		this.closeCb(code);
	}
	fail(code: string): void {
		const err = new Error(code) as NodeJS.ErrnoException;
		err.code = code;
		this.errorCb(err);
	}
}

describe('ShellPico8Adapter: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found when the binary ENOENTs (never a crash/hang)', async () => {
		const proc = new FakeProcess();
		const spawn: SpawnRunner = () => proc;
		const adapter = new ShellPico8Adapter({env: {}, spawn});

		const resultP = adapter.run({
			cartPath: '/x/main.p8',
			shotDir: '/x/shots',
			backstopMs: 1000,
		});
		proc.fail('ENOENT'); // spawn failure = binary not installed
		const result = await resultP;

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('pico8-not-found');
			expect(result.remedy).toBe('set PICO8_PATH or install PICO-8');
			expect(result.needs).toContain('pico8');
		}
	});
});

describe('ShellPico8Adapter: sentinel-driven termination', () => {
	let shotDir: string;
	beforeEach(() => {
		shotDir = mkdtempSync(join(tmpdir(), 'pico8-shots-'));
	});
	afterEach(() => rmSync(shotDir, {recursive: true, force: true}));

	it('kills PICO-8 the moment the sentinel is printed (exitReason: sentinel)', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.run({
			cartPath: '/x/main.p8',
			shotDir,
			backstopMs: 10_000, // long: prove the sentinel, not the backstop, ends it
		});

		proc.emit('RUNNING:\n');
		proc.emit(`${DONE_SENTINEL}\n`); // the cart signals done

		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.exitReason).toBe('sentinel');
		expect(proc.killed).toBe(true); // killed promptly, not after the backstop
	});

	it('captures printh stdout in the report', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.run({
			cartPath: '/x/m.p8',
			shotDir,
			backstopMs: 9999,
		});
		proc.emit('score=42\n');
		proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		if (result.ok) expect(result.value.printh).toContain('score=42');
	});

	it('collects the PNG screenshots the run produced, sorted', async () => {
		const proc = new FakeProcess();
		writeFileSync(join(shotDir, 'frame_1.png'), 'x');
		writeFileSync(join(shotDir, 'frame_0.png'), 'x');
		writeFileSync(join(shotDir, 'notes.txt'), 'ignore me');
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.run({
			cartPath: '/x/m.p8',
			shotDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		if (result.ok) {
			expect(result.value.screenshots.map((p) => p.split('/').pop())).toEqual([
				'frame_0.png',
				'frame_1.png',
			]);
		}
	});
});

describe('ShellPico8Adapter: backstop + natural exit', () => {
	it('fires the backstop (exitReason: timeout) when the cart never signals', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const shotDir = mkdtempSync(join(tmpdir(), 'pico8-shots-'));
		try {
			const resultP = adapter.run({
				cartPath: '/x/m.p8',
				shotDir,
				backstopMs: 20, // short: the backstop is the only terminator here
			});
			proc.emit('RUNNING:\n'); // ... and then nothing (a hung cart)
			const result = await resultP;
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.exitReason).toBe('timeout');
			expect(proc.killed).toBe(true);
		} finally {
			rmSync(shotDir, {recursive: true, force: true});
		}
	});

	it('reports exitReason: exit when PICO-8 closes on its own', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const shotDir = mkdtempSync(join(tmpdir(), 'pico8-shots-'));
		try {
			const resultP = adapter.run({
				cartPath: '/x/m.p8',
				shotDir,
				backstopMs: 9999,
			});
			proc.close(0); // PICO-8 exited before any sentinel
			const result = await resultP;
			if (result.ok) expect(result.value.exitReason).toBe('exit');
		} finally {
			rmSync(shotDir, {recursive: true, force: true});
		}
	});
});
