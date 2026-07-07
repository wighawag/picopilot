import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {DONE_SENTINEL, RECORD_WAV_BASENAME} from './adapter.js';
import {
	type Pico8Process,
	pico8HomeDir,
	ShellPico8Adapter,
	type SpawnRunner,
	withPico8Home,
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
	/** The bytes written to stdin (the `drive` command-block transport). */
	stdinBytes: number[] = [];

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
		for (const b of bytes) this.stdinBytes.push(b);
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

	it('passes --input through as `-p <input>` in the spawn args (playtest channel)', async () => {
		const proc = new FakeProcess();
		let spawnArgs: string[] = [];
		const spawn: SpawnRunner = (_file, args) => {
			spawnArgs = args;
			return proc;
		};
		const adapter = new ShellPico8Adapter({env: {}, spawn});
		const resultP = adapter.run({
			cartPath: '/x/m.p8',
			shotDir,
			backstopMs: 9999,
			input: 'rrrrz',
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		expect(spawnArgs).toContain('-p');
		expect(spawnArgs[spawnArgs.indexOf('-p') + 1]).toBe('rrrrz');
	});

	it('prepends `-home <isolated tmp dir>` so PICO-8 config/data never litters the CWD', async () => {
		const proc = new FakeProcess();
		let spawnArgs: string[] = [];
		const spawn: SpawnRunner = (_file, args) => {
			spawnArgs = args;
			return proc;
		};
		const adapter = new ShellPico8Adapter({env: {}, spawn});
		const resultP = adapter.run({
			cartPath: '/x/m.p8',
			shotDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		expect(spawnArgs).toContain('-home');
		const home = spawnArgs[spawnArgs.indexOf('-home') + 1];
		// Points at an isolated temp dir, NOT the process CWD.
		expect(home.startsWith(tmpdir())).toBe(true);
		expect(home).not.toBe(process.cwd());
		// The pure helper is stable and prepends, not appends.
		expect(withPico8Home(['-x', 'c.p8'])).toEqual([
			'-home',
			pico8HomeDir(),
			'-x',
			'c.p8',
		]);
	});

	it('omits `-p` when no input is given', async () => {
		const proc = new FakeProcess();
		let spawnArgs: string[] = [];
		const spawn: SpawnRunner = (_file, args) => {
			spawnArgs = args;
			return proc;
		};
		const adapter = new ShellPico8Adapter({env: {}, spawn});
		const resultP = adapter.run({
			cartPath: '/x/m.p8',
			shotDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		expect(spawnArgs).not.toContain('-p');
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

/** A valid (non-empty) RIFF/WAVE payload: header + a few PCM sample bytes. */
function writeNonEmptyWav(path: string): void {
	// 44-byte header + 8 bytes of data so statSync(path).size > 44 (a real capture).
	writeFileSync(path, Buffer.concat([Buffer.alloc(44), Buffer.alloc(8, 1)]));
}

describe('ShellPico8Adapter.record: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found when the binary ENOENTs', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.record({
			cartPath: '/x/main.p8',
			wavDir: '/x/wav',
			backstopMs: 1000,
		});
		proc.fail('ENOENT');
		const result = await resultP;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('pico8-not-found');
			expect(result.remedy).toBe('set PICO8_PATH or install PICO-8');
			expect(result.needs).toContain('pico8');
		}
	});
});

describe('ShellPico8Adapter.record: real A/V session + WAV isolation', () => {
	let wavDir: string;
	beforeEach(() => {
		wavDir = mkdtempSync(join(tmpdir(), 'pico8-wav-'));
	});
	afterEach(() => rmSync(wavDir, {recursive: true, force: true}));

	it('launches with `-run` (real A/V), NOT headless `-x`, and `-root_path <wavDir>`', async () => {
		const proc = new FakeProcess();
		let spawnArgs: string[] = [];
		const spawn: SpawnRunner = (_file, args) => {
			spawnArgs = args;
			return proc;
		};
		const adapter = new ShellPico8Adapter({env: {}, spawn});
		const resultP = adapter.record({
			cartPath: '/x/harness.p8',
			wavDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		// The record session must be a real A/V run (recording needs audio to
		// capture; `-x` yields an empty WAV, ADR-0009).
		expect(spawnArgs).toContain('-run');
		expect(spawnArgs).not.toContain('-x');
		// The WAV location is steered to the isolated dir via root_path (the
		// audio_end(1)-to-current-folder quirk), never ~/Desktop.
		expect(spawnArgs).toContain('-root_path');
		expect(spawnArgs[spawnArgs.indexOf('-root_path') + 1]).toBe(wavDir);
	});

	it('collects the <basename>.wav the cooperating cart wrote (sentinel-ended)', async () => {
		const proc = new FakeProcess();
		writeNonEmptyWav(join(wavDir, `${RECORD_WAV_BASENAME}.wav`));
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.record({
			cartPath: '/x/harness.p8',
			wavDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.wavPath).toBe(
				join(wavDir, `${RECORD_WAV_BASENAME}.wav`),
			);
			expect(result.value.exitReason).toBe('sentinel');
		}
		expect(proc.killed).toBe(true);
	});

	it('treats a 44-byte (0-frame) WAV as NO usable audio (the headless empty-WAV trap)', async () => {
		const proc = new FakeProcess();
		// A well-formed but EMPTY RIFF header (what headless -x produces).
		writeFileSync(join(wavDir, `${RECORD_WAV_BASENAME}.wav`), Buffer.alloc(44));
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.record({
			cartPath: '/x/harness.p8',
			wavDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		if (result.ok) expect(result.value.wavPath).toBeUndefined();
	});

	it('reports no WAV when none was produced', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.record({
			cartPath: '/x/harness.p8',
			wavDir,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		if (result.ok) expect(result.value.wavPath).toBeUndefined();
	});

	it('fires the record backstop when the cart never signals (never a hang)', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.record({
			cartPath: '/x/harness.p8',
			wavDir,
			backstopMs: 20,
		});
		const result = await resultP;
		if (result.ok) expect(result.value.exitReason).toBe('timeout');
		expect(proc.killed).toBe(true);
	});
});

describe('ShellPico8Adapter.drive: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found when the binary ENOENTs', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.drive({
			cartPath: '/x/driven.p8',
			shotDir: '/x/shots',
			blocks: new Uint8Array([1, 0, 0, 0]),
			backstopMs: 1000,
		});
		proc.fail('ENOENT');
		const result = await resultP;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('pico8-not-found');
			expect(result.needs).toContain('pico8');
		}
	});
});

describe('ShellPico8Adapter.drive: headless capture + block transport', () => {
	let shotDir: string;
	beforeEach(() => {
		shotDir = mkdtempSync(join(tmpdir(), 'pico8-drive-'));
	});
	afterEach(() => rmSync(shotDir, {recursive: true, force: true}));

	it('launches headless `-x` + `-desktop <shotDir>` (never a real ~/Desktop write)', async () => {
		const proc = new FakeProcess();
		let spawnArgs: string[] = [];
		let stdinRequested = false;
		const spawn: SpawnRunner = (_file, args, _env, options) => {
			spawnArgs = args;
			stdinRequested = options?.stdin === true;
			return proc;
		};
		const adapter = new ShellPico8Adapter({env: {}, spawn});
		const resultP = adapter.drive({
			cartPath: '/x/driven.p8',
			shotDir,
			blocks: new Uint8Array([2, 16, 0, 0]),
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		expect(spawnArgs).toContain('-x');
		expect(spawnArgs).toContain('-desktop');
		expect(spawnArgs[spawnArgs.indexOf('-desktop') + 1]).toBe(shotDir);
		// The driven run needs a LIVE stdin to pipe the command blocks into.
		expect(stdinRequested).toBe(true);
	});

	it('writes the whole command-block stream to the cart stdin (one-shot up front)', async () => {
		const proc = new FakeProcess();
		const blocks = new Uint8Array([2, 16, 0, 0, 1, 1, 0, 0, 5, 0, 0, 0]);
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.drive({
			cartPath: '/x/driven.p8',
			shotDir,
			blocks,
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		// Every byte of the block stream reached stdin, in order (fixed-size blocks).
		expect(proc.stdinBytes).toEqual([...blocks]);
	});

	it('collects the SHOT screenshots + ends on the sentinel', async () => {
		const proc = new FakeProcess();
		writeFileSync(join(shotDir, 'play1.png'), 'x');
		writeFileSync(join(shotDir, 'play0.png'), 'x');
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.drive({
			cartPath: '/x/driven.p8',
			shotDir,
			blocks: new Uint8Array([5, 0, 0, 0]),
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.screenshots.map((p) => p.split('/').pop())).toEqual([
				'play0.png',
				'play1.png',
			]);
			expect(result.value.exitReason).toBe('sentinel');
		}
		expect(proc.killed).toBe(true);
	});

	it('fires the drive backstop when the driven cart never signals (never a hang)', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.drive({
			cartPath: '/x/driven.p8',
			shotDir,
			blocks: new Uint8Array([1, 1, 0, 0]),
			backstopMs: 20,
		});
		const result = await resultP;
		if (result.ok) expect(result.value.exitReason).toBe('timeout');
		expect(proc.killed).toBe(true);
	});
});

describe('ShellPico8Adapter.export: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found when the binary ENOENTs', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.export({
			cartPath: '/x/main.p8',
			outDir: '/x/out',
			backstopMs: 1000,
		});
		proc.fail('ENOENT');
		const result = await resultP;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('pico8-not-found');
			expect(result.remedy).toBe('set PICO8_PATH or install PICO-8');
			expect(result.needs).toContain('pico8');
		}
	});
});

describe('ShellPico8Adapter.export: the headless -export -x invocation', () => {
	let outDir: string;
	beforeEach(() => {
		outDir = mkdtempSync(join(tmpdir(), 'pico8-export-'));
	});
	afterEach(() => rmSync(outDir, {recursive: true, force: true}));

	it('invokes `-export <outDir>/index.html -x <cart>` (headless, no display)', async () => {
		const proc = new FakeProcess();
		let spawnArgs: string[] = [];
		const spawn: SpawnRunner = (_file, args) => {
			spawnArgs = args;
			return proc;
		};
		const adapter = new ShellPico8Adapter({env: {}, spawn});
		const resultP = adapter.export({
			cartPath: '/x/game.p8',
			outDir,
			htmlName: 'index.html',
			backstopMs: 9999,
		});
		proc.close(0); // -x exits on its own once the export is written
		await resultP;
		expect(spawnArgs).toContain('-export');
		expect(spawnArgs[spawnArgs.indexOf('-export') + 1]).toBe(
			join(outDir, 'index.html'),
		);
		expect(spawnArgs).toContain('-x'); // headless
		expect(spawnArgs).toContain('/x/game.p8');
	});

	it('collects the html + js pair PICO-8 produced', async () => {
		const proc = new FakeProcess();
		writeFileSync(join(outDir, 'index.html'), '<html></html>');
		writeFileSync(join(outDir, 'index.js'), '// runtime');
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.export({
			cartPath: '/x/game.p8',
			outDir,
			backstopMs: 9999,
		});
		proc.close(0);
		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.htmlPath?.endsWith('index.html')).toBe(true);
			expect(result.value.jsPath?.endsWith('index.js')).toBe(true);
			expect(result.value.files.length).toBe(2);
			expect(result.value.labelWarning).toBe(false);
		}
	});

	it('flags labelWarning when PICO-8 prints "please capture a label first"', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.export({
			cartPath: '/x/game.p8',
			outDir,
			backstopMs: 9999,
		});
		proc.emit('EXPORT: index.html\nplease capture a label first\n');
		proc.close(0);
		const result = await resultP;
		if (result.ok) expect(result.value.labelWarning).toBe(true);
	});

	it('reports an undefined jsPath when the export wrote nothing', async () => {
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({env: {}, spawn: () => proc});
		const resultP = adapter.export({
			cartPath: '/x/game.p8',
			outDir, // stays empty
			backstopMs: 9999,
		});
		proc.close(0);
		const result = await resultP;
		if (result.ok) {
			expect(result.value.jsPath).toBeUndefined();
			expect(result.value.files.length).toBe(0);
		}
	});
});
