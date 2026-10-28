import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {
	Pico8Adapter,
	Pico8RecordResult,
	Pico8Result,
	RecordOptions,
	RunOptions,
} from '../engine/pico8/index.js';
import {displayUnavailable, pico8NotFound} from '../engine/pico8/index.js';
import {createShellAdapterFactory} from './pico8-env.js';
import {type Pico8AdapterFactory, registerRun} from './run.js';

/** A trivial valid cart the command reads (existence + a path to hand the adapter). */
const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-run-'));
	cartPath = join(dir, 'main.p8');
	writeFileSync(cartPath, CART_TEXT);
});

afterEach(() => {
	try {
		execFileSync('rm', ['-rf', dir]);
	} catch {
		// ignore
	}
});

/**
 * A stub {@link Pico8Adapter} standing in for BOTH the shell adapter and a
 * hypothetical web-export adapter. It never spawns PICO-8, so no test depends on
 * the paid binary. It also RECORDS the {@link RunOptions} it was handed, so a
 * test can assert the command chose an isolated shotDir (never ~/Desktop).
 */
function stubAdapter(
	result: Pico8Result,
	seen?: {options?: RunOptions; recordOptions?: RecordOptions},
	recordResult?: Pico8RecordResult,
): Pico8Adapter {
	return {
		async drive() {
			throw new Error('drive not used');
		},
		async export() {
			throw new Error('export not used');
		},
		async run(options) {
			if (seen !== undefined) seen.options = options;
			return result;
		},
		async record(options) {
			if (seen !== undefined) seen.recordOptions = options;
			return (
				recordResult ?? {
					ok: true,
					value: {
						wavPath: undefined,
						printh: '',
						exitReason: 'sentinel',
					},
				}
			);
		},
	};
}

function ranWith(exitReason: 'sentinel' | 'timeout' | 'exit'): Pico8Result {
	return {
		ok: true,
		value: {screenshots: [], printh: 'hello from cart\n', exitReason},
	};
}

/**
 * Drives `picopilot run` through incur's `serve` DI with an INJECTED adapter
 * factory (the seam), capturing stdout + exit without the real environment or
 * the paid binary. `env` defaults to a bare PATH the stub ignores.
 */
async function runRun(
	factory: Pico8AdapterFactory,
	argv: string[] = ['run', cartPath, '--json'],
	env: Record<string, string | undefined> = {PATH: '/does/not/matter'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerRun(cli, factory);
	let stdout = '';
	let exitCode = 0;
	await cli.serve(argv, {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		env,
	});
	return {stdout, exitCode};
}

describe('picopilot run: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found + nonzero exit (mirrors shrinko, never a crash)', async () => {
		const {stdout, exitCode} = await runRun(() => stubAdapter(pico8NotFound()));
		expect(exitCode).not.toBe(0);
		// The message carries the exact remedy + needs so an agent reading only the
		// message still learns the fix.
		expect(stdout).toContain('set PICO8_PATH or install PICO-8');
		expect(stdout).toContain('pico8');
	});
});

describe('picopilot run: structured run report', () => {
	it('reports screenshots + printh + exitReason on a sentinel-ended run', async () => {
		const {stdout, exitCode} = await runRun(() =>
			stubAdapter(ranWith('sentinel')),
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.exitReason).toBe('sentinel');
		expect(out.printh).toContain('hello from cart');
		expect(Array.isArray(out.screenshots)).toBe(true);
	});

	it('a timeout with NO screenshots CTAs toward SEEING it (probe/playtest), not just static checks', async () => {
		const {stdout, exitCode} = await runRun(() =>
			stubAdapter(ranWith('timeout')),
		);
		// A timeout is a soft warning, not a failure exit: the run still returns a report.
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.exitReason).toBe('timeout');
		const lower = stdout.toLowerCase();
		// The weak-model trap is shipping an untested cart on a bare timeout. With no
		// screenshot captured, the CTA must push toward actually SEEING the cart
		// (a probe screenshot or playtest) as well as the static checks.
		expect(lower).toContain('does not prove it works');
		expect(lower).toContain('playtest');
		expect(lower).toContain('verify');
	});

	it('a timeout WITH a screenshot is treated as expected-for-an-interactive-game', async () => {
		const withShot: Pico8Result = {
			ok: true,
			value: {
				screenshots: ['/tmp/probe_0.png'],
				printh: 'hello from cart\n',
				exitReason: 'timeout',
			},
		};
		const {stdout, exitCode} = await runRun(() => stubAdapter(withShot));
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.exitReason).toBe('timeout');
		expect(out.screenshots).toContain('/tmp/probe_0.png');
		const lower = stdout.toLowerCase();
		// A captured frame means the cart rendered: a timeout here is the normal
		// interactive-game case, so the CTA does NOT claim it is unproven.
		expect(lower).toContain('expected for an interactive game');
		expect(lower).not.toContain('does not prove it works');
	});
});

describe('picopilot run: shotDir isolation (never ~/Desktop)', () => {
	it('defaults to an isolated temp dir, not the real ~/Desktop', async () => {
		const seen: {options?: RunOptions} = {};
		const {exitCode} = await runRun(() =>
			stubAdapter(ranWith('sentinel'), seen),
		);
		expect(exitCode).toBe(0);
		const shotDir = seen.options?.shotDir ?? '';
		// The chosen dir is a fresh temp dir, NOT the default screenshot location.
		expect(shotDir.startsWith(tmpdir())).toBe(true);
		expect(shotDir).not.toContain(join(homedir(), 'Desktop'));
		// And it was actually created for PICO-8 to write into.
		expect(existsSync(shotDir)).toBe(true);
	});

	it('threads --input through to the adapter (the one-shot playtest channel)', async () => {
		const seen: {options?: RunOptions} = {};
		await runRun(
			() => stubAdapter(ranWith('sentinel'), seen),
			['run', cartPath, '--input', 'rrrrz', '--json'],
		);
		expect(seen.options?.input).toBe('rrrrz');
	});

	it('honours an explicit --shot-dir', async () => {
		const seen: {options?: RunOptions} = {};
		const chosen = join(dir, 'shots');
		await runRun(
			() => stubAdapter(ranWith('sentinel'), seen),
			['run', cartPath, '--shot-dir', chosen, '--json'],
		);
		expect(seen.options?.shotDir).toBe(chosen);
		expect(existsSync(chosen)).toBe(true); // created if missing
	});
});

describe('picopilot run: --record-audio (additive WAV capture, ADR-0009)', () => {
	it('collects a WAV alongside the screenshots when --record-audio is set', async () => {
		const seen: {options?: RunOptions; recordOptions?: RecordOptions} = {};
		const wav = join(dir, 'run.wav');
		writeFileSync(wav, 'x');
		const {stdout, exitCode} = await runRun(
			() =>
				stubAdapter(ranWith('sentinel'), seen, {
					ok: true,
					value: {wavPath: wav, printh: '', exitReason: 'sentinel'},
				}),
			['run', cartPath, '--record-audio', '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		// The WAV is an ADDITIVE artifact next to the existing screenshot envelope.
		expect(out.wav).toBe(wav);
		expect(out.audioCaptured).toBe(true);
		expect(Array.isArray(out.screenshots)).toBe(true);
		// The record pass got a real A/V request into the SAME isolated shotDir.
		expect(seen.recordOptions?.wavDir).toBe(seen.options?.shotDir);
	});

	it('is additive: without the flag no record pass runs (audioCaptured false)', async () => {
		const seen: {options?: RunOptions; recordOptions?: RecordOptions} = {};
		const {stdout} = await runRun(() => stubAdapter(ranWith('sentinel'), seen));
		const out = JSON.parse(stdout);
		expect(out.audioCaptured).toBe(false);
		expect(out.wav).toBeUndefined();
		expect(seen.recordOptions).toBeUndefined(); // record() never called
	});
});

describe('picopilot run: cart-not-found (picopilot-side error, distinct from pico8 absence)', () => {
	it('errors with a nonzero exit when the cart path does not exist', async () => {
		const {stdout, exitCode} = await runRun(
			() => stubAdapter(ranWith('sentinel')),
			['run', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});

	it('does NOT invoke the adapter when the cart is missing (fails fast)', async () => {
		let called = false;
		await runRun(() => {
			called = true;
			return stubAdapter(ranWith('sentinel'));
		}, ['run', join(dir, 'missing.p8'), '--json']);
		// The cart-existence check runs BEFORE the adapter factory.
		expect(called).toBe(false);
	});

	it('leaves the real ~/Desktop BYTE-untouched across a run (no screenshot pollution)', async () => {
		// The pollution guard: the -desktop flag redirects screenshots to a temp dir,
		// so a default run must never add/change anything under the real ~/Desktop.
		const desktop = join(homedir(), 'Desktop');
		const snap = (): string[] =>
			existsSync(desktop) ? readdirSync(desktop).sort() : [];
		const before = snap();
		await runRun(() => stubAdapter(ranWith('sentinel')));
		expect(snap()).toEqual(before); // same entries: an absent dir stays absent, a present one unchanged
	});
});

describe('picopilot run --record-audio: an #include cart produces a loadable harness', () => {
	it('inlines the cart includes into the harness it hands the record pass', async () => {
		writeFileSync(
			cartPath,
			'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n#include main.lua\n',
		);
		writeFileSync(
			join(dir, 'main.lua'),
			'function _update() hello_from_main=1 end\n',
		);
		const seen: {recordOptions?: RecordOptions} = {};
		const {exitCode} = await runRun(
			() => stubAdapter(ranWith('sentinel'), seen),
			['run', cartPath, '--record-audio', '--json'],
		);
		expect(exitCode).toBe(0);
		const harness = readFileSync(seen.recordOptions!.cartPath, 'utf8');
		expect(harness).not.toMatch(/#include/);
		expect(harness).toContain('hello_from_main=1');
	});
});

describe('picopilot run --record-audio: failures are explained, never silent', () => {
	it('surfaces noAudioReason + pico8LogTail when no WAV was captured', async () => {
		const {stdout} = await runRun(
			() =>
				stubAdapter(ranWith('sentinel'), undefined, {
					ok: true,
					value: {
						wavPath: undefined,
						printh: '',
						exitReason: 'timeout',
						noWavReason: 'the backstop fired before the done-sentinel',
						pico8LogTail: 'syntax error',
					},
				}),
			['run', cartPath, '--record-audio', '--json'],
		);
		const out = JSON.parse(stdout);
		expect(out.audioCaptured).toBe(false);
		expect(out.noAudioReason).toMatch(/backstop/);
		expect(out.pico8LogTail).toBe('syntax error');
	});

	it('display-unavailable is a structured error whose CTA names the fix', async () => {
		const {stdout, exitCode} = await runRun(
			() =>
				stubAdapter(
					ranWith('sentinel'),
					undefined,
					displayUnavailable('no DISPLAY and no Xvfb'),
				),
			['run', cartPath, '--record-audio', '--json', '--full-output'],
		);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.error.code).toBe('display-unavailable');
		expect(out.error.message).toMatch(/Xvfb/);
		expect(JSON.stringify(out.meta?.cta ?? out.cta)).toMatch(/install Xvfb/);
	});
});

describe('picopilot run: the PICO-8 child inherits the parent environment', () => {
	it('DISPLAY, HOME and XDG_RUNTIME_DIR from the parent reach the spawn; PICO8_PATH comes from the resolved env', async () => {
		let spawnedEnv: NodeJS.ProcessEnv | undefined;
		const factory = createShellAdapterFactory({
			parentEnv: {
				DISPLAY: ':5',
				HOME: '/home/agent',
				XDG_RUNTIME_DIR: '/run/user/1000',
				SDL_AUDIODRIVER: 'pulseaudio',
				PICO8_PATH: '/parent/pico8',
			},
			spawn: (_file, _args, env) => {
				spawnedEnv = env;
				return {
					onStdout(cb) {
						setImmediate(() => cb('__PICOPILOT_DONE__\n'));
					},
					onClose() {},
					onError() {},
					kill() {},
				};
			},
		});
		const {exitCode} = await runRun(factory, ['run', cartPath, '--json'], {
			PICO8_PATH: '/resolved/pico8',
			PATH: '/usr/bin',
		});
		expect(exitCode).toBe(0);
		expect(spawnedEnv).toMatchObject({
			DISPLAY: ':5',
			HOME: '/home/agent',
			XDG_RUNTIME_DIR: '/run/user/1000',
			SDL_AUDIODRIVER: 'pulseaudio',
			PICO8_PATH: '/resolved/pico8',
			PATH: '/usr/bin',
		});
	});
});
