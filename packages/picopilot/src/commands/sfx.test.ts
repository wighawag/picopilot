import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {mmlToSfxRow, SFX_ROW_LENGTH} from '../engine/audio/index.js';
import {createCli} from '../cli.js';

/** A minimal valid cart with a lua + gfx section (to prove they stay untouched). */
function cartText(sfxBody?: string): string {
	let text =
		'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n__gfx__\n0011223344556677\n';
	if (sfxBody !== undefined) text += `__sfx__\n${sfxBody}`;
	return text;
}

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-sfx-'));
	cartPath = join(dir, 'main.p8');
});

afterEach(() => {
	try {
		execFileSync('rm', ['-rf', dir]);
	} catch {
		// ignore
	}
});

/** Drives a `picopilot sfx ...` invocation through incur's serve DI. */
async function runSfx(argv: string[]) {
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

/** Extracts the __sfx__ body lines from a cart file. */
function sfxLines(text: string): string[] {
	const m = text.match(/__sfx__\n([\s\S]*?)(?:\n__|$)/);
	return (m?.[1] ?? '').split('\n').filter((l) => l.length > 0);
}

describe('picopilot sfx from-mml: transpile + merge', () => {
	it('merges a transpiled __sfx__ row into the target slot and reports it', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			's8 @1 v6 c d e',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.slot).toBe(0);
		expect(out.rows).toBe(3);
		expect(out.speed).toBe(8);
		expect(out.row).toBe(mmlToSfxRow('s8 @1 v6 c d e').row);
		expect(out.row).toHaveLength(SFX_ROW_LENGTH);
		// Persisted: slot 0 holds the row.
		const lines = sfxLines(readFileSync(cartPath, 'utf8'));
		expect(lines[0]).toBe(out.row);
	});

	it('writes into a non-zero slot, padding intermediate slots', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'3',
			'@2 c',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout).slot).toBe(3);
		const lines = sfxLines(readFileSync(cartPath, 'utf8'));
		expect(lines).toHaveLength(4);
		expect(lines[3]).toBe(mmlToSfxRow('@2 c').row);
	});

	it('CTAs toward verify + audio render', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'c',
			'--cart',
			cartPath,
			'--json',
		]);
		const cta = JSON.stringify(JSON.parse(stdout).cta);
		expect(cta).toContain('verify');
		expect(cta).toContain('audio render');
	});
});

describe('picopilot sfx from-mml: leaves every OTHER section byte-identical', () => {
	it('only __sfx__ changes; lua + gfx + header preserved', async () => {
		writeFileSync(cartPath, cartText());
		const before = readFileSync(cartPath, 'utf8');
		await runSfx([
			'sfx',
			'from-mml',
			'0',
			'@1 c d e',
			'--cart',
			cartPath,
			'--json',
		]);
		const after = readFileSync(cartPath, 'utf8');
		// The whole prefix up to __sfx__ is byte-identical.
		const cut = before.length; // before has no __sfx__ yet
		expect(after.slice(0, cut)).toBe(before);
		expect(after).toContain('print("hi")');
		expect(after).toContain('__gfx__\n0011223344556677\n');
	});

	it('overwrites only the target slot, preserving other authored slots', async () => {
		// Pre-author slots 0 and 2.
		const row0 = mmlToSfxRow('@2 c').row;
		const row2 = mmlToSfxRow('@5 g').row;
		const empty = '0'.repeat(SFX_ROW_LENGTH);
		writeFileSync(cartPath, cartText(`${row0}\n${empty}\n${row2}\n`));

		await runSfx([
			'sfx',
			'from-mml',
			'1',
			'@7 e',
			'--cart',
			cartPath,
			'--json',
		]);
		const lines = sfxLines(readFileSync(cartPath, 'utf8'));
		expect(lines[0]).toBe(row0); // untouched
		expect(lines[1]).toBe(mmlToSfxRow('@7 e').row); // new
		expect(lines[2]).toBe(row2); // untouched
	});
});

describe('picopilot sfx from-mml: structured refusals (NO silent clamp)', () => {
	it('out-of-range pitch -> audio-mml-pitch-out-of-range + nonzero exit, no write', async () => {
		writeFileSync(cartPath, cartText());
		const before = readFileSync(cartPath, 'utf8');
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'o5 g', // pitch 67 > 63
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.code).toBe('audio-mml-pitch-out-of-range');
		expect(out.message).toContain('C0..D#5');
		// The cart is byte-untouched (refusal never writes).
		expect(readFileSync(cartPath, 'utf8')).toBe(before);
	});

	it('>32 rows -> audio-mml-sfx-overflow + nonzero exit, no write', async () => {
		writeFileSync(cartPath, cartText());
		const before = readFileSync(cartPath, 'utf8');
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'c33',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.code).toBe('audio-mml-sfx-overflow');
		expect(out.message).toContain('32');
		expect(readFileSync(cartPath, 'utf8')).toBe(before);
	});

	it('a tempo-style token -> audio-mml-parse-error naming tracker rows', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			't120 c',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.code).toBe('audio-mml-parse-error');
		expect(out.message).toContain('TRACKER ROWS');
	});
});

describe('picopilot sfx from-mml: input surface (arg vs --file)', () => {
	it('reads the MML from --file', async () => {
		writeFileSync(cartPath, cartText());
		const mmlPath = join(dir, 'lead.mml');
		writeFileSync(mmlPath, 's4 @3 v7 c e g');
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'--cart',
			cartPath,
			'--file',
			mmlPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.row).toBe(mmlToSfxRow('s4 @3 v7 c e g').row);
	});

	it('errors when neither the mml arg nor --file is given', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(JSON.parse(stdout).code).toBe('no-mml');
	});

	it('a missing cart is a distinct cart-not-found error', async () => {
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'c',
			'--cart',
			join(dir, 'nope.p8'),
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(JSON.parse(stdout).code).toBe('cart-not-found');
	});
});

describe('picopilot sfx from-mml: dotted-length rounding is reported', () => {
	it('warns when a dotted length rounds to a whole row', async () => {
		writeFileSync(cartPath, cartText());
		const {stdout, exitCode} = await runSfx([
			'sfx',
			'from-mml',
			'0',
			'c3.', // 4.5 rows -> rounds
			'--cart',
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.warnings.length).toBeGreaterThan(0);
		expect(out.warnings[0]).toContain('rounded');
	});
});
