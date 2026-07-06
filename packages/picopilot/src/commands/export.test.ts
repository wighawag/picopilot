import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {
	ExportOptions,
	Pico8Adapter,
	Pico8ExportResult,
} from '../engine/pico8/index.js';
import {pico8NotFound} from '../engine/pico8/index.js';
import {type Pico8AdapterFactory, registerExport} from './export.js';

/** A trivial valid cart the command reads (existence + a path to hand the adapter). */
const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-export-'));
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
 * A stub {@link Pico8Adapter} whose `export` REALLY writes the bundle files into
 * the `outDir` it is handed, so the command's file collection + the
 * --payload-only file split are exercised end-to-end WITHOUT the paid binary. It
 * records the {@link ExportOptions} so a test can assert the chosen out dir.
 */
function stubAdapter(
	result: Pico8ExportResult | 'writes-bundle' | 'writes-no-js',
	seen?: {options?: ExportOptions},
	labelWarning = false,
): Pico8Adapter {
	const notUsed = () => {
		throw new Error('not used by export');
	};
	return {
		run: notUsed as never,
		record: notUsed as never,
		drive: notUsed as never,
		async export(options) {
			if (seen !== undefined) seen.options = options;
			if (result === 'writes-bundle') {
				const html = join(options.outDir, 'index.html');
				const js = join(options.outDir, 'index.js');
				writeFileSync(html, '<html><script src="index.js"></script></html>');
				writeFileSync(js, '// pico8 runtime');
				return {
					ok: true,
					value: {htmlPath: html, jsPath: js, files: [html, js], labelWarning},
				};
			}
			if (result === 'writes-no-js') {
				return {
					ok: true,
					value: {
						htmlPath: undefined,
						jsPath: undefined,
						files: [],
						labelWarning,
					},
				};
			}
			return result;
		},
	};
}

/** Drives `picopilot export` through incur's serve DI with an injected adapter. */
async function runExport(
	factory: Pico8AdapterFactory,
	argv: string[],
	env: Record<string, string | undefined> = {PATH: '/does/not/matter'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerExport(cli, factory);
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

describe('picopilot export: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found + nonzero exit (mirrors run, never a crash)', async () => {
		const {stdout, exitCode} = await runExport(
			() => stubAdapter(pico8NotFound()),
			['export', cartPath, '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('set PICO8_PATH or install PICO-8');
		expect(stdout).toContain('pico8');
	});
});

describe('picopilot export: standalone bundle into a dest dir', () => {
	it('writes index.html + index.js and reports both paths', async () => {
		const dest = join(dir, 'out');
		const {stdout, exitCode} = await runExport(
			() => stubAdapter('writes-bundle'),
			['export', cartPath, dest, '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.outDir).toBe(dest);
		expect(out.html.endsWith('index.html')).toBe(true);
		expect(out.js.endsWith('index.js')).toBe(true);
		// The dest dir is directly serveable: both files are present on disk.
		expect(existsSync(join(dest, 'index.html'))).toBe(true);
		expect(existsSync(join(dest, 'index.js'))).toBe(true);
	});

	it('names the export index.html so a dest folder plays directly', async () => {
		const seen: {options?: ExportOptions} = {};
		await runExport(
			() => stubAdapter('writes-bundle', seen),
			['export', cartPath, join(dir, 'out'), '--json'],
		);
		expect(seen.options?.htmlName).toBe('index.html');
	});

	it('defaults the dest to an isolated temp dir (never a user path)', async () => {
		const seen: {options?: ExportOptions} = {};
		await runExport(
			() => stubAdapter('writes-bundle', seen),
			['export', cartPath, '--json'],
		);
		expect(seen.options?.outDir.startsWith(tmpdir())).toBe(true);
	});
});

describe('picopilot export: --payload-only (drop the shell page for a site component)', () => {
	it('removes index.html and keeps only the js payload', async () => {
		const dest = join(dir, 'payload');
		const {stdout, exitCode} = await runExport(
			() => stubAdapter('writes-bundle'),
			['export', cartPath, dest, '--payload-only', '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.html).toBeUndefined();
		expect(out.js.endsWith('index.js')).toBe(true);
		// The shell page is gone; the runtime payload remains.
		expect(existsSync(join(dest, 'index.html'))).toBe(false);
		expect(existsSync(join(dest, 'index.js'))).toBe(true);
	});
});

describe('picopilot export: labelless cart + failure paths', () => {
	it('surfaces the labelWarning and CTAs toward capturing a label (standalone)', async () => {
		const {stdout, exitCode} = await runExport(
			() => stubAdapter('writes-bundle', undefined, true),
			['export', cartPath, join(dir, 'out'), '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.labelWarning).toBe(true);
		expect(stdout.toLowerCase()).toContain('label');
	});

	it('errors when PICO-8 produced no js payload (labelless bail)', async () => {
		const {stdout, exitCode} = await runExport(
			() => stubAdapter('writes-no-js', undefined, true),
			['export', cartPath, join(dir, 'out'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout.toLowerCase()).toContain('label');
	});
});

describe('picopilot export: cart-not-found (picopilot-side error, distinct from pico8 absence)', () => {
	it('errors with a nonzero exit when the cart path does not exist', async () => {
		const {stdout, exitCode} = await runExport(
			() => stubAdapter('writes-bundle'),
			['export', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});

	it('does NOT invoke the adapter when the cart is missing (fails fast)', async () => {
		let called = false;
		await runExport(() => {
			called = true;
			return stubAdapter('writes-bundle');
		}, ['export', join(dir, 'missing.p8'), '--json']);
		expect(called).toBe(false);
	});
});
