import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {DONE_SENTINEL, RECORD_WAV_BASENAME} from './adapter.js';
import {FakeXvfb} from './fake-xvfb.test-support.js';
import {
	type Pico8Process,
	pico8ChildEnv,
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
	/** The signals `kill` received (undefined = the default SIGKILL). */
	signals: (string | undefined)[] = [];
	kill(signal?: NodeJS.Signals): void {
		this.killed = true;
		this.signals.push(signal);
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
		const home = spawnArgs[spawnArgs.indexOf('-home') + 1]!;
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
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => proc,
			display: 'native',
		});
		const resultP = adapter.record({
			cartPath: '/x/main.p8',
			wavDir: '/x/wav',
			backstopMs: 1000,
		});
		proc.fail('ENOENT');
		const result = await resultP;
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toBe('pico8-not-found');
		if (!result.ok && result.reason === 'pico8-not-found') {
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
		const adapter = new ShellPico8Adapter({env: {}, spawn, display: 'native'});
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
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => proc,
			display: 'native',
		});
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
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => proc,
			display: 'native',
		});
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
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => proc,
			display: 'native',
		});
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
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => proc,
			display: 'native',
		});
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

/**
 * The virtual-display record path (ADR-0017), with a fake PICO-8 AND a fake
 * Xvfb: the display must come up before PICO-8 spawns, PICO-8 must see it, and
 * it must ALWAYS be torn down, however the run ends.
 */
describe('ShellPico8Adapter.record: virtual display (fake Xvfb)', () => {
	let wavDir: string;
	beforeEach(() => {
		wavDir = mkdtempSync(join(tmpdir(), 'pico8-wav-'));
	});
	afterEach(() => rmSync(wavDir, {recursive: true, force: true}));

	/** Everything installed: pico8 and Xvfb resolve, Xvfb reports display :37. */
	function rig(
		opts: {
			env?: NodeJS.ProcessEnv;
			display?: 'auto' | 'xvfb' | 'native';
			installed?: string[];
			killGraceMs?: number;
		} = {},
	) {
		const proc = new FakeProcess();
		const xvfb = new FakeXvfb();
		const installed = opts.installed ?? ['pico8', 'Xvfb'];
		let xvfbSpawns = 0;
		let spawnedEnv: NodeJS.ProcessEnv | undefined;
		let spawnedFile: string | undefined;
		let resolveSpawned: () => void = () => {};
		const spawned = new Promise<void>((r) => {
			resolveSpawned = r;
		});
		const adapter = new ShellPico8Adapter({
			env: opts.env ?? {},
			display: opts.display ?? 'auto',
			killGraceMs: opts.killGraceMs,
			spawn: (file, _args, env) => {
				spawnedFile = file;
				spawnedEnv = env;
				setImmediate(resolveSpawned);
				return proc;
			},
			virtualDisplay: {
				find: (n) => (installed.includes(n) ? `/fake/${n}` : undefined),
				spawnXvfb: () => {
					xvfbSpawns++;
					setImmediate(() => xvfb.reportDisplay(37));
					return xvfb;
				},
			},
		});
		return {
			proc,
			xvfb,
			adapter,
			spawned,
			get xvfbSpawns() {
				return xvfbSpawns;
			},
			get env() {
				return spawnedEnv;
			},
			get file() {
				return spawnedFile;
			},
		};
	}

	it('runs PICO-8 on the virtual display (DISPLAY, dummy SDL audio, a runtime dir) and stops Xvfb on the sentinel', async () => {
		const r = rig();
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		expect(r.env?.DISPLAY).toBe(':37');
		expect(r.env?.SDL_AUDIODRIVER).toBe('dummy');
		expect(r.env?.XDG_RUNTIME_DIR).toBeTruthy();
		expect(r.xvfb.exited).toBe(false); // alive while PICO-8 runs
		r.proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.exitReason).toBe('sentinel');
			expect(result.value.display).toBe('Xvfb');
		}
		expect(r.proc.killed).toBe(true);
		expect(r.xvfb.exited).toBe(true);
	});

	it('keeps a caller-chosen SDL_AUDIODRIVER', async () => {
		const r = rig({env: {SDL_AUDIODRIVER: 'pulseaudio'}});
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		expect(r.env?.SDL_AUDIODRIVER).toBe('pulseaudio');
		r.proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
	});

	it('stops Xvfb when the backstop fires', async () => {
		const r = rig();
		const result = await r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 20,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.exitReason).toBe('timeout');
		expect(r.proc.killed).toBe(true);
		expect(r.xvfb.exited).toBe(true);
	});

	it('stops Xvfb when PICO-8 crashes (exits on its own)', async () => {
		const r = rig();
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		r.proc.close(139);
		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.exitReason).toBe('exit');
		expect(r.xvfb.exited).toBe(true);
	});

	it('stops Xvfb when PICO-8 fails to spawn', async () => {
		const r = rig();
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		r.proc.fail('ENOENT');
		const result = await resultP;
		expect(!result.ok && result.reason).toBe('pico8-not-found');
		expect(r.xvfb.exited).toBe(true);
	});

	it('wraps PICO-8 in xvfb-run when only the script exists, and ends it with SIGTERM first', async () => {
		const r = rig({installed: ['pico8', 'xvfb-run'], killGraceMs: 5_000});
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		expect(r.file).toBe('/fake/xvfb-run');
		expect(r.env?.SDL_AUDIODRIVER).toBe('dummy');
		r.proc.emit(`${DONE_SENTINEL}\n`);
		// SIGTERM (so Xvfb removes its lock + socket), and the run waits for the
		// group to close instead of SIGKILLing it.
		expect(r.proc.signals).toEqual(['SIGTERM']);
		r.proc.close(0);
		const result = await resultP;
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.display).toBe('xvfb-run');
		expect(r.proc.signals).toEqual(['SIGTERM']);
		expect(r.xvfbSpawns).toBe(0);
	});

	it('xvfb-run that ignores SIGTERM is SIGKILLed after the grace period', async () => {
		const r = rig({installed: ['pico8', 'xvfb-run'], killGraceMs: 10});
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		r.proc.emit(`${DONE_SENTINEL}\n`);
		const result = await resultP;
		expect(result.ok).toBe(true);
		expect(r.proc.signals).toEqual(['SIGTERM', undefined]);
	});

	it('returns display-unavailable (never a silent timeout) when there is no display and no Xvfb', async () => {
		const r = rig({installed: ['pico8']});
		const result = await r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === 'display-unavailable') {
			expect(result.remedy).toMatch(/Xvfb/);
		} else {
			throw new Error(
				`expected display-unavailable, got ${JSON.stringify(result)}`,
			);
		}
		expect(r.env).toBeUndefined(); // PICO-8 never launched
	});

	it('reports pico8-not-found (not display-unavailable) when PICO-8 itself is missing', async () => {
		const r = rig({installed: []});
		const result = await r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		expect(!result.ok && result.reason).toBe('pico8-not-found');
		expect(r.xvfbSpawns).toBe(0);
	});

	it('auto with a native display (X11 or Wayland) starts no Xvfb', async () => {
		for (const env of [{DISPLAY: ':0'}, {WAYLAND_DISPLAY: 'wayland-0'}]) {
			const r = rig({env});
			const resultP = r.adapter.record({
				cartPath: '/x/h.p8',
				wavDir,
				backstopMs: 9999,
			});
			await r.spawned;
			r.proc.emit(`${DONE_SENTINEL}\n`);
			const result = await resultP;
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.display).toBe('native');
			expect(r.xvfbSpawns).toBe(0);
			expect(r.env?.SDL_AUDIODRIVER).toBeUndefined();
		}
	});

	it('xvfb mode uses a virtual display even when a native one exists', async () => {
		const r = rig({env: {DISPLAY: ':0'}, display: 'xvfb'});
		const resultP = r.adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 9999,
		});
		await r.spawned;
		expect(r.env?.DISPLAY).toBe(':37');
		r.proc.emit(`${DONE_SENTINEL}\n`);
		await resultP;
		expect(r.xvfbSpawns).toBe(1);
		expect(r.xvfb.exited).toBe(true);
	});

	it('the -x paths (run, drive, export) never start Xvfb, even in xvfb mode', async () => {
		const r = rig({display: 'xvfb'});
		const runP = r.adapter.run({
			cartPath: '/x/c.p8',
			shotDir: wavDir,
			backstopMs: 9999,
		});
		r.proc.emit(`${DONE_SENTINEL}\n`);
		await runP;
		const driveP = r.adapter.drive({
			cartPath: '/x/c.p8',
			shotDir: wavDir,
			blocks: new Uint8Array(),
			backstopMs: 9999,
		});
		r.proc.emit(`${DONE_SENTINEL}\n`);
		await driveP;
		const exportP = r.adapter.export({
			cartPath: '/x/c.p8',
			outDir: wavDir,
			backstopMs: 9999,
		});
		r.proc.close(0);
		await exportP;
		expect(r.xvfbSpawns).toBe(0);
	});
});

describe('ShellPico8Adapter.record: says WHY there is no WAV', () => {
	let wavDir: string;
	beforeEach(() => {
		wavDir = mkdtempSync(join(tmpdir(), 'pico8-wav-'));
	});
	afterEach(() => rmSync(wavDir, {recursive: true, force: true}));

	it('backstop: names the missed sentinel and includes the tail of PICO-8 log.txt', async () => {
		// A previous run's log must not leak into this report...
		writeFileSync(join(pico8HomeDir(), 'log.txt'), 'STALE previous run\n');
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => {
				// ...only what THIS run's PICO-8 writes.
				writeFileSync(
					join(pico8HomeDir(), 'log.txt'),
					'codo_init\nsyntax error in main.lua\n',
				);
				return proc;
			},
			display: 'native',
		});
		const result = await adapter.record({
			cartPath: '/x/h.p8',
			wavDir,
			backstopMs: 20,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.wavPath).toBeUndefined();
		expect(result.value.noWavReason).toMatch(/backstop/);
		expect(result.value.noWavReason).toMatch(/sentinel/);
		expect(result.value.pico8LogTail).toContain('syntax error in main.lua');
		expect(result.value.pico8LogTail).not.toContain('STALE');
	});

	it('early exit and an empty capture each get their own reason', async () => {
		const exitProc = new FakeProcess();
		const a1 = new ShellPico8Adapter({
			env: {},
			spawn: () => exitProc,
			display: 'native',
		});
		const p1 = a1.record({cartPath: '/x/h.p8', wavDir, backstopMs: 9999});
		exitProc.close(1);
		const r1 = await p1;
		expect(r1.ok).toBe(true);
		if (r1.ok) expect(r1.value.noWavReason).toMatch(/exited before/);

		const doneProc = new FakeProcess();
		const a2 = new ShellPico8Adapter({
			env: {},
			spawn: () => doneProc,
			display: 'native',
		});
		const p2 = a2.record({cartPath: '/x/h.p8', wavDir, backstopMs: 9999});
		doneProc.emit(`${DONE_SENTINEL}\n`);
		const r2 = await p2;
		expect(r2.ok).toBe(true);
		if (r2.ok)
			expect(r2.value.noWavReason).toMatch(/reached its done-sentinel/);
	});

	it('a captured WAV carries no reason', async () => {
		writeNonEmptyWav(join(wavDir, `${RECORD_WAV_BASENAME}.wav`));
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({
			env: {},
			spawn: () => proc,
			display: 'native',
		});
		const p = adapter.record({cartPath: '/x/h.p8', wavDir, backstopMs: 9999});
		proc.emit(`${DONE_SENTINEL}\n`);
		const r = await p;
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.noWavReason).toBeUndefined();
			expect(r.value.pico8LogTail).toBeUndefined();
		}
	});
});

describe('pico8ChildEnv + the spawned env', () => {
	it('passes the parent env through, overlaid with the resolved values', () => {
		const env = pico8ChildEnv(
			{PICO8_PATH: '/opt/pico8', PATH: undefined},
			{
				DISPLAY: ':1',
				HOME: '/home/u',
				XDG_RUNTIME_DIR: '/run/user/1',
				PATH: '/usr/bin',
			},
		);
		expect(env).toMatchObject({
			DISPLAY: ':1',
			HOME: '/home/u',
			XDG_RUNTIME_DIR: '/run/user/1',
			PICO8_PATH: '/opt/pico8',
			PATH: '/usr/bin', // an undefined resolved value never erases the parent's
		});
	});

	it('the spawn sees the env it was given, plus a private XDG_RUNTIME_DIR only when absent', async () => {
		let seen: NodeJS.ProcessEnv | undefined;
		const proc = new FakeProcess();
		const adapter = new ShellPico8Adapter({
			env: {DISPLAY: ':1', HOME: '/home/u'},
			spawn: (_f, _a, env) => {
				seen = env;
				return proc;
			},
		});
		const p = adapter.run({
			cartPath: '/x/c.p8',
			shotDir: '/x',
			backstopMs: 9999,
		});
		proc.emit(`${DONE_SENTINEL}\n`);
		await p;
		expect(seen?.DISPLAY).toBe(':1');
		expect(seen?.HOME).toBe('/home/u');
		expect(seen?.XDG_RUNTIME_DIR).toMatch(/picopilot-xdg-runtime-/);

		const proc2 = new FakeProcess();
		const adapter2 = new ShellPico8Adapter({
			env: {XDG_RUNTIME_DIR: '/run/user/1'},
			spawn: (_f, _a, env) => {
				seen = env;
				return proc2;
			},
		});
		const p2 = adapter2.run({
			cartPath: '/x/c.p8',
			shotDir: '/x',
			backstopMs: 9999,
		});
		proc2.emit(`${DONE_SENTINEL}\n`);
		await p2;
		expect(seen?.XDG_RUNTIME_DIR).toBe('/run/user/1');
	});
});
