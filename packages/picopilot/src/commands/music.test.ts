import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {mmlToSfxRow, patternsToMusic} from '../engine/audio/index.js';
import {createCli} from '../cli.js';

/** A minimal valid cart with lua + gfx + a real __sfx__ (to prove they stay untouched). */
function cartText(opts?: {sfx?: string; music?: string}): string {
	let text =
		'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n__gfx__\n0011223344556677\n';
	if (opts?.sfx !== undefined) text += `__sfx__\n${opts.sfx}`;
	if (opts?.music !== undefined) text += `__music__\n${opts.music}`;
	return text;
}

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-music-'));
	cartPath = join(dir, 'main.p8');
});

afterEach(() => {
	try {
		execFileSync('rm', ['-rf', dir]);
	} catch {
		// ignore
	}
});

/** Drives a `picopilot music ...` invocation through incur's serve DI. */
async function runMusic(argv: string[]) {
	let stdout = '';
	let exitCode = 0;
	await createCli().serve(argv, {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		env: {},
	});
	return {stdout, exitCode};
}

/** Extracts the __music__ body lines from a cart file. */
function musicLines(text: string): string[] {
	const m = text.match(/__music__\n([\s\S]*?)(?:\n__|$)/);
	return (m?.[1] ?? '').split('\n').filter((l) => l.length > 0);
}

describe('picopilot music from-patterns: transpile + merge', () => {
	it('merges the assembled __music__ into the cart and reports it', async () => {
		writeFileSync(cartPath, cartText());
		const list =
			'[{"channels":[0,1,2,3],"loopStart":true},{"channels":[0,1,2,3],"loopBack":true}]';
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			list,
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.patterns).toBe(2);
		expect(out.section).toBe(
			patternsToMusic([
				{channels: [0, 1, 2, 3], loopStart: true},
				{channels: [0, 1, 2, 3], loopBack: true},
			]).section,
		);
		const lines = musicLines(readFileSync(cartPath, 'utf8'));
		expect(lines).toEqual(['01 00010203', '02 00010203']);
	});

	it('writes an OFF channel (null) as byte 40, distinct from sfx 0', async () => {
		writeFileSync(cartPath, cartText());
		await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[0,1,null,3]}]',
			'--cart',
			cartPath,
			'--json',
		]);
		// null is ch2 -> byte 40 at channel-2 position, distinct from sfx 0 (byte 00).
		expect(musicLines(readFileSync(cartPath, 'utf8'))).toEqual(['00 00014003']);
	});

	it('CTAs toward verify + audio render', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout} = await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[0,0,0,0]}]',
			'--cart',
			cartPath,
			'--json',
		]);
		const cta = JSON.stringify(JSON.parse(stdout).cta);
		expect(cta).toContain('verify');
		expect(cta).toContain('audio render');
	});
});

describe('picopilot music from-patterns: leaves every OTHER section byte-identical', () => {
	it('only __music__ changes; lua + gfx + __sfx__ + header preserved', async () => {
		const sfxRow = mmlToSfxRow('s8 @1 v6 c d e').row;
		writeFileSync(cartPath, cartText({sfx: `${sfxRow}\n`}));
		const before = readFileSync(cartPath, 'utf8');
		await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[0,1,2,3]}]',
			'--cart',
			cartPath,
			'--json',
		]);
		const after = readFileSync(cartPath, 'utf8');
		// __music__ appended after __sfx__; everything before it is byte-identical.
		expect(after.startsWith(before)).toBe(true);
		expect(after).toContain('print("hi")');
		expect(after).toContain('__gfx__\n0011223344556677\n');
		expect(after).toContain(`__sfx__\n${sfxRow}\n`);
	});

	it('replaces an existing __music__ body, leaving __sfx__ untouched', async () => {
		const sfxRow = mmlToSfxRow('@2 c').row;
		writeFileSync(
			cartPath,
			cartText({sfx: `${sfxRow}\n`, music: '00 00000000\n'}),
		);
		await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[5,6,7,8],"stop":true}]',
			'--cart',
			cartPath,
			'--json',
		]);
		const text = readFileSync(cartPath, 'utf8');
		expect(musicLines(text)).toEqual(['04 05060708']);
		expect(text).toContain(`__sfx__\n${sfxRow}\n`);
	});
});

describe('picopilot music from-patterns: structured refusals (NO silent clamp)', () => {
	it('out-of-range sfx index -> audio-music-sfx-out-of-range + nonzero exit, no write', async () => {
		writeFileSync(cartPath, cartText());
		const before = readFileSync(cartPath, 'utf8');
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[64,0,0,0]}]',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.code).toBe('audio-music-sfx-out-of-range');
		expect(out.message).toContain('0..63');
		// The cart is byte-untouched (refusal never writes).
		expect(readFileSync(cartPath, 'utf8')).toBe(before);
	});

	it('a wrong channel count -> audio-music-bad-channel-count + nonzero exit', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[0,1,2]}]',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(JSON.parse(stdout).code).toBe('audio-music-bad-channel-count');
	});

	it('malformed JSON -> audio-music-parse-error + nonzero exit', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'not json',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(JSON.parse(stdout).code).toBe('audio-music-parse-error');
	});
});

describe('picopilot music from-patterns: loopBack-without-loopStart WARNS (not a crash)', () => {
	it('emits + warns about the pattern-0 fall-back', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[0,0,0,0]},{"channels":[1,1,1,1],"loopBack":true}]',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.patterns).toBe(2);
		expect(out.warnings.length).toBeGreaterThan(0);
		expect(out.warnings[0]).toContain('pattern 0');
		// It DID write (the warning does not block the merge).
		expect(musicLines(readFileSync(cartPath, 'utf8'))).toEqual([
			'00 00000000',
			'02 01010101',
		]);
	});
});

describe('picopilot music from-patterns: input surface (arg vs --file)', () => {
	it('reads the pattern list from --file', async () => {
		writeFileSync(cartPath, cartText());
		const listPath = join(dir, 'song.json');
		writeFileSync(listPath, '[{"channels":[3,3,3,3],"stop":true}]');
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'--cart',
			cartPath,
			'--file',
			listPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout).section).toBe(
			patternsToMusic([{channels: [3, 3, 3, 3], stop: true}]).section,
		);
	});

	it('errors when neither the patterns arg nor --file is given', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(JSON.parse(stdout).code).toBe('no-patterns');
	});

	it('a missing cart is a distinct cart-not-found error', async () => {
		const {stdout, exitCode} = await runMusic([
			'music',
			'from-patterns',
			'[{"channels":[0,0,0,0]}]',
			'--cart',
			join(dir, 'nope.p8'),
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(JSON.parse(stdout).code).toBe('cart-not-found');
	});
});
