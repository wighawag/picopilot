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
import {encodeWav16} from '../engine/audio/analyze.js';
import {mmlToSfxRow} from '../engine/audio/sfx.js';
import {mergeSfxRow} from '../engine/audio/section.js';
import {Cart} from '../engine/cart/index.js';
import type {
	Pico8Adapter,
	Pico8RecordResult,
	RecordOptions,
	RunOptions,
} from '../engine/pico8/index.js';
import {displayUnavailable, pico8NotFound} from '../engine/pico8/index.js';
import {
	type Pico8AdapterFactory,
	RECORD_STARTUP_MARGIN_MS,
	registerAudio,
	resolveRecordBackstop,
} from './audio.js';

const HEADER = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n';

let dir: string;
let cartPath: string;

/** A cart with SFX slot 0 authored, so `render --sfx 0` has something to render. */
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-audio-'));
	cartPath = join(dir, 'main.p8');
	const cart = Cart.parse(`${HEADER}__lua__\nfunction _update() end\n`);
	mergeSfxRow(cart, 0, mmlToSfxRow('s8 @1 v6 c e g').row);
	writeFileSync(cartPath, cart.serialize());
});

afterEach(() => {
	try {
		execFileSync('rm', ['-rf', dir]);
	} catch {
		// ignore
	}
});

/**
 * A stub {@link Pico8Adapter} that never spawns PICO-8, so no test depends on the
 * paid binary. It RECORDS the {@link RecordOptions} it was handed (for the
 * isolation + orchestration assertions) and returns a chosen result.
 */
function stubAdapter(
	recordResult: Pico8RecordResult,
	seen?: {record?: RecordOptions},
): Pico8Adapter {
	return {
		async drive() {
			throw new Error('drive not used');
		},
		async export() {
			throw new Error('export not used');
		},
		async run(_options: RunOptions) {
			return {
				ok: true,
				value: {screenshots: [], printh: '', exitReason: 'sentinel'},
			};
		},
		async record(options) {
			if (seen !== undefined) seen.record = options;
			return recordResult;
		},
	};
}

/** A successful record report with a WAV the fake "captured". */
function recorded(wavPath: string | undefined): Pico8RecordResult {
	return {ok: true, value: {wavPath, printh: 'ok\n', exitReason: 'sentinel'}};
}

/** Drives an `audio ...` subcommand through incur's serve DI with an injected adapter. */
async function runAudio(
	factory: Pico8AdapterFactory,
	argv: string[],
	env: Record<string, string | undefined> = {PATH: '/does/not/matter'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerAudio(cli, factory);
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

describe('audio record/render: PICO-8 absent (the CI-testable boundary)', () => {
	it('record returns structured pico8-not-found + nonzero exit (never a crash)', async () => {
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(pico8NotFound()),
			['audio', 'record', cartPath, '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('set PICO8_PATH or install PICO-8');
		expect(stdout).toContain('pico8');
	});

	it('render returns structured pico8-not-found + nonzero exit', async () => {
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(pico8NotFound()),
			['audio', 'render', cartPath, '--sfx', '0', '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('set PICO8_PATH or install PICO-8');
	});
});

describe('audio render: orchestration against a fake runner', () => {
	it('records a WAV and returns its path + the target description', async () => {
		const seen: {record?: RecordOptions} = {};
		const wav = join(dir, 'out.wav');
		writeFileSync(wav, 'x');
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(wav), seen),
			['audio', 'render', cartPath, '--sfx', '0', '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.wav).toBe(wav);
		expect(out.captured).toBe(true);
		expect(out.target).toBe('sfx 0');
		// The adapter got a real A/V record request for a THROWAWAY harness cart,
		// never the user's cart directly.
		expect(seen.record?.cartPath).not.toBe(cartPath);
		expect(seen.record?.cartPath.endsWith('.p8')).toBe(true);
	});

	it('injects a play-harness whose _update plays the target + records it', async () => {
		const seen: {record?: RecordOptions} = {};
		await runAudio(
			() => stubAdapter(recorded(undefined), seen),
			['audio', 'render', cartPath, '--sfx', '0', '--json'],
		);
		// The throwaway harness cart the adapter was pointed at contains the
		// record recipe + the target play call (assert on-disk, not just the arg).
		const harness = readFileSync(seen.record!.cartPath, 'utf8');
		expect(harness).toContain('extcmd("audio_rec")');
		expect(harness).toContain('sfx(0)');
		expect(harness).toContain('extcmd("audio_end",1)');
	});

	it('the whole-song default renders music(0)', async () => {
		const seen: {record?: RecordOptions} = {};
		await runAudio(
			() => stubAdapter(recorded(undefined), seen),
			['audio', 'render', cartPath, '--json'],
		);
		expect(readFileSync(seen.record!.cartPath, 'utf8')).toContain('music(0)');
	});

	it('refuses --sfx and --pattern together (a render targets ONE thing)', async () => {
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(undefined)),
			['audio', 'render', cartPath, '--sfx', '0', '--pattern', '1', '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('ambiguous-target');
	});

	it('refuses an empty SFX slot (nothing to render), no capture attempted', async () => {
		let recordCalled = false;
		const {stdout, exitCode} = await runAudio(
			() => ({
				async drive() {
					throw new Error('drive not used');
				},
				async export() {
					throw new Error('export not used');
				},
				async run() {
					return {
						ok: true,
						value: {screenshots: [], printh: '', exitReason: 'sentinel'},
					};
				},
				async record() {
					recordCalled = true;
					return recorded(undefined);
				},
			}),
			['audio', 'render', cartPath, '--sfx', '9', '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('audio-render-target-empty');
		expect(recordCalled).toBe(false); // the target refusal precedes any capture
	});

	it('a no-audio capture surfaces captured:false + a CTA, not a hard error', async () => {
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(undefined)),
			['audio', 'render', cartPath, '--sfx', '0', '--json'],
		);
		expect(exitCode).toBe(0); // the orchestration worked; there was just no audio
		const out = JSON.parse(stdout);
		expect(out.captured).toBe(false);
		expect(out.wav).toBeUndefined();
	});
});

describe('audio record: orchestration against a fake runner', () => {
	it('records the running cart and returns the WAV path', async () => {
		const seen: {record?: RecordOptions} = {};
		const wav = join(dir, 'rec.wav');
		writeFileSync(wav, 'x');
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(wav), seen),
			['audio', 'record', cartPath, '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.wav).toBe(wav);
		expect(out.captured).toBe(true);
		expect(out.target).toBe('the running cart');
		// The recorder harness keeps the cart's OWN code (captures its playback).
		const harness = readFileSync(seen.record!.cartPath, 'utf8');
		expect(harness).toContain('function _update() end'); // the cart's code survives
		expect(harness).toContain('extcmd("audio_rec")');
	});

	it('errors with a nonzero exit when the cart path does not exist', async () => {
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(undefined)),
			['audio', 'record', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});
});

describe('audio: WAV-dir isolation (never ~/Desktop or the carts root)', () => {
	it('defaults the WAV dir to an isolated temp dir, not ~/Desktop', async () => {
		const seen: {record?: RecordOptions} = {};
		await runAudio(
			() => stubAdapter(recorded(undefined), seen),
			['audio', 'render', cartPath, '--sfx', '0', '--json'],
		);
		const wavDir = seen.record?.wavDir ?? '';
		expect(wavDir.startsWith(tmpdir())).toBe(true);
		expect(wavDir).not.toContain(join(homedir(), 'Desktop'));
		expect(existsSync(wavDir)).toBe(true); // created for PICO-8 to write into
	});

	it('leaves the real ~/Desktop BYTE-untouched across a record run', async () => {
		const desktop = join(homedir(), 'Desktop');
		const snap = (): string[] =>
			existsSync(desktop) ? readdirSync(desktop).sort() : [];
		const before = snap();
		await runAudio(
			() => stubAdapter(recorded(undefined)),
			['audio', 'record', cartPath, '--json'],
		);
		expect(snap()).toEqual(before);
	});

	it('never mutates the user cart (the throwaway harness is a separate file)', async () => {
		const before = readFileSync(cartPath, 'utf8');
		await runAudio(
			() => stubAdapter(recorded(undefined)),
			['audio', 'render', cartPath, '--sfx', '0', '--json'],
		);
		expect(readFileSync(cartPath, 'utf8')).toBe(before);
	});
});

describe('audio: honest help text (record-based, NOT an offline export)', () => {
	it('render help states it is a real-time recording, not an offline export', async () => {
		const {stdout} = await runAudio(
			() => stubAdapter(recorded(undefined)),
			['audio', 'render', '--help'],
		);
		const lower = stdout.toLowerCase();
		expect(lower).toContain('real-time');
		expect(lower).toContain('not');
		expect(lower).toContain('offline export');
	});
});

describe('audio record/render: headless (ADR-0017)', () => {
	it('record inlines `#include main.lua` so the harness loads from the temp wavDir', async () => {
		writeFileSync(cartPath, `${HEADER}__lua__\n#include main.lua\n`);
		writeFileSync(
			join(dir, 'main.lua'),
			'function _update() from_main=1 end\n',
		);
		const seen: {record?: RecordOptions} = {};
		await runAudio(
			() => stubAdapter(recorded(undefined), seen),
			['audio', 'record', cartPath, '--json'],
		);
		const harness = readFileSync(seen.record!.cartPath, 'utf8');
		expect(harness).not.toMatch(/#include/);
		expect(harness).toContain('from_main=1');
	});

	for (const sub of [
		['audio', 'record'],
		['audio', 'render', '--sfx', '0'],
	]) {
		it(`${sub.join(' ')}: display-unavailable is a structured error naming the fix`, async () => {
			const {stdout, exitCode} = await runAudio(
				() => stubAdapter(displayUnavailable('no display, no Xvfb')),
				[
					...sub.slice(0, 2),
					cartPath,
					...sub.slice(2),
					'--json',
					'--full-output',
				],
			);
			expect(exitCode).not.toBe(0);
			const out = JSON.parse(stdout);
			expect(out.error.code).toBe('display-unavailable');
			expect(out.meta.cta.description).toMatch(/install Xvfb/);
		});
	}

	it('a run with no WAV reports noAudioReason, pico8LogTail and the display used', async () => {
		const {stdout} = await runAudio(
			() =>
				stubAdapter({
					ok: true,
					value: {
						wavPath: undefined,
						printh: '',
						exitReason: 'timeout',
						display: 'Xvfb',
						noWavReason: 'the backstop fired',
						pico8LogTail: 'could not include main.lua',
					},
				}),
			['audio', 'record', cartPath, '--json'],
		);
		const out = JSON.parse(stdout);
		expect(out.captured).toBe(false);
		expect(out.display).toBe('Xvfb');
		expect(out.noAudioReason).toBe('the backstop fired');
		expect(out.pico8LogTail).toContain('main.lua');
	});
});

describe('audio record/render: the backstop follows the record window', () => {
	it('defaults to the window plus a startup margin (a 24 s window is not killed at 30 s)', async () => {
		for (const argv of [
			[
				'audio',
				'render',
				cartPath,
				'--pattern',
				'0',
				'--seconds',
				'24',
				'--json',
			],
			['audio', 'record', cartPath, '--seconds', '24', '--json'],
		]) {
			const seen: {record?: RecordOptions} = {};
			const {exitCode} = await runAudio(
				() => stubAdapter(recorded(undefined), seen),
				argv,
			);
			expect(exitCode).toBe(0);
			expect(seen.record?.backstopMs).toBe(24_000 + RECORD_STARTUP_MARGIN_MS);
		}
	});

	it('an explicit backstop that cannot fit the window is refused up front', async () => {
		const seen: {record?: RecordOptions} = {};
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(undefined), seen),
			[
				'audio',
				'render',
				cartPath,
				'--pattern',
				'0',
				'--seconds',
				'28',
				'--backstop-ms',
				'30000',
				'--json',
			],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('audio-backstop-too-small');
		expect(stdout).toContain('33000');
		expect(seen.record).toBeUndefined(); // PICO-8 was never launched
	});

	it('an explicit backstop with room for startup is honoured', async () => {
		const seen: {record?: RecordOptions} = {};
		await runAudio(
			() => stubAdapter(recorded(undefined), seen),
			[
				'audio',
				'record',
				cartPath,
				'--seconds',
				'4',
				'--backstop-ms',
				'12000',
				'--json',
			],
		);
		expect(seen.record?.backstopMs).toBe(12_000);
	});

	it('resolveRecordBackstop', () => {
		expect(resolveRecordBackstop(8, undefined)).toEqual({ok: true, ms: 38_000});
		expect(resolveRecordBackstop(8, 13_000)).toEqual({ok: true, ms: 13_000});
		expect(resolveRecordBackstop(8, 12_999).ok).toBe(false);
	});
});

/** Writes a WAV of `seconds` of a sine at `amp` to `path`. */
function writeSineWav(path: string, seconds: number, hz: number, amp: number) {
	const samples = new Float32Array(Math.round(seconds * 22050));
	for (let i = 0; i < samples.length; i++) {
		samples[i] = amp * Math.sin((2 * Math.PI * hz * i) / 22050);
	}
	writeFileSync(path, encodeWav16(samples, 22050));
}

describe('audio analyze (no PICO-8 needed)', () => {
	it('reports loudness/brightness/dynamics and plain-language warnings', async () => {
		const wav = join(dir, 'm.wav');
		writeSineWav(wav, 4, 440, 0.3);
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(pico8NotFound()),
			['audio', 'analyze', wav, '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.skippedSeconds).toBe(1);
		expect(out.loudness.meanRms).toBeCloseTo(0.212, 2);
		expect(Math.abs(out.brightness.centroidHz - 440)).toBeLessThan(30);
		const codes = out.warnings.map((w: {code: string}) => w.code);
		expect(codes).toContain('loud');
		expect(codes).toContain('monotonous');
	});

	it('--against compares the music with a reference SFX', async () => {
		const music = join(dir, 'm.wav');
		const sfx = join(dir, 's.wav');
		writeSineWav(music, 4, 330, 0.05);
		writeSineWav(sfx, 1, 660, 0.3);
		const {stdout} = await runAudio(
			() => stubAdapter(pico8NotFound()),
			['audio', 'analyze', music, '--against', sfx, '--json'],
		);
		expect(JSON.parse(stdout).against.musicOverReferenceDb).toBeLessThan(-10);
	});

	it('a missing or bad WAV is a structured error', async () => {
		const bad = join(dir, 'bad.wav');
		writeFileSync(bad, 'not a wav');
		for (const p of [bad, join(dir, 'missing.wav')]) {
			const {stdout, exitCode} = await runAudio(
				() => stubAdapter(pico8NotFound()),
				['audio', 'analyze', p, '--json'],
			);
			expect(exitCode).not.toBe(0);
			expect(stdout).toContain('audio-analyze-bad-wav');
		}
	});

	it('render --analyze attaches the analysis of the captured WAV', async () => {
		const wav = join(dir, 'cap.wav');
		writeSineWav(wav, 3, 440, 0.05);
		const {stdout, exitCode} = await runAudio(
			() => stubAdapter(recorded(wav)),
			['audio', 'render', cartPath, '--sfx', '0', '--analyze', '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.captured).toBe(true);
		expect(out.analysis.loudness.meanRms).toBeCloseTo(0.035, 2);
	});

	it('without --analyze there is no analysis', async () => {
		const wav = join(dir, 'cap.wav');
		writeSineWav(wav, 3, 440, 0.05);
		const {stdout} = await runAudio(
			() => stubAdapter(recorded(wav)),
			['audio', 'record', cartPath, '--json'],
		);
		expect(JSON.parse(stdout).analysis).toBeUndefined();
	});
});

describe('render --analyze on an SFX target', () => {
	it('analyzes the whole capture (no 1 s skip) with sfx rules', async () => {
		const wav = join(dir, 'blip.wav');
		writeSineWav(wav, 1.5, 440, 0.3);
		const {stdout} = await runAudio(
			() => stubAdapter(recorded(wav)),
			['audio', 'render', cartPath, '--sfx', '0', '--analyze', '--json'],
		);
		const out = JSON.parse(stdout);
		expect(out.analysis.skippedSeconds).toBe(0);
		expect(out.analysis.warnings).toEqual([]);
	});
});
