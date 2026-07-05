import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {
	MinifyReport,
	ShrinkoAdapter,
	ShrinkoResult,
} from '../engine/shrinko/index.js';
import {shrinkoNotFound} from '../engine/shrinko/index.js';
import {type ShrinkoAdapterFactory, registerMinify} from './minify.js';

const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-minify-'));
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
 * A stub adapter whose `minify` records the outPath it was handed, WRITES a fake
 * minified cart there (so the command's on-disk assertions are real), and
 * returns a wired token delta. `count`/`lint` unused.
 */
function stubAdapter(
	result: ShrinkoResult<MinifyReport> | 'write',
	seen?: {outPath?: string},
): ShrinkoAdapter {
	return {
		async count() {
			throw new Error('not used');
		},
		async lint() {
			throw new Error('not used');
		},
		async minify(_cart, outPath) {
			if (seen !== undefined) seen.outPath = outPath;
			if (result === 'write') {
				writeFileSync(outPath, '-- minified\n');
				return {
					ok: true,
					value: {beforeTokens: 100, afterTokens: 60, outPath},
				};
			}
			return result;
		},
	};
}

async function runMinify(
	factory: ShrinkoAdapterFactory,
	argv: string[] = ['minify', cartPath, '--json'],
	env: Record<string, string | undefined> = {PATH: '/x'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerMinify(cli, factory);
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

describe('picopilot minify: compiler-style (ADR-0007)', () => {
	it('writes <name>.min.p8 by default and reports the token delta', async () => {
		const {stdout, exitCode} = await runMinify(() => stubAdapter('write'));
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.outPath).toBe(join(dir, 'main.min.p8'));
		expect(out.beforeTokens).toBe(100);
		expect(out.afterTokens).toBe(60);
		expect(out.saved).toBe(40);
		expect(existsSync(join(dir, 'main.min.p8'))).toBe(true);
	});

	it('NEVER mutates the source cart (the compiler invariant)', async () => {
		const before = readFileSync(cartPath, 'utf8');
		await runMinify(() => stubAdapter('write'));
		expect(readFileSync(cartPath, 'utf8')).toBe(before); // source byte-identical
	});

	it('honours an explicit --out path', async () => {
		const seen: {outPath?: string} = {};
		const chosen = join(dir, 'dist', 'game.p8');
		await runMinify(
			() => stubAdapter('write', seen),
			['minify', cartPath, '--out', chosen, '--json'],
		);
		expect(seen.outPath).toBe(chosen);
	});
});

describe('picopilot minify: no-clobber + source guard', () => {
	it('refuses to overwrite an existing output without --force', async () => {
		writeFileSync(join(dir, 'main.min.p8'), 'existing artifact');
		const {stdout, exitCode} = await runMinify(() => stubAdapter('write'));
		expect(exitCode).not.toBe(0);
		expect(stdout.toLowerCase()).toContain('refusing to overwrite');
		// The existing artifact is untouched (the adapter never ran).
		expect(readFileSync(join(dir, 'main.min.p8'), 'utf8')).toBe(
			'existing artifact',
		);
	});

	it('--force overwrites an existing output', async () => {
		writeFileSync(join(dir, 'main.min.p8'), 'old');
		const {exitCode} = await runMinify(
			() => stubAdapter('write'),
			['minify', cartPath, '--force', '--json'],
		);
		expect(exitCode).toBe(0);
		expect(readFileSync(join(dir, 'main.min.p8'), 'utf8')).toContain(
			'minified',
		);
	});

	it('refuses --out pointing AT the source (no in-place mutation)', async () => {
		const {stdout, exitCode} = await runMinify(
			() => stubAdapter('write'),
			['minify', cartPath, '--out', cartPath, '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout.toLowerCase()).toContain('must differ from the source');
	});
});

describe('picopilot minify: shrinko absent + cart missing', () => {
	it('returns structured shrinko-not-found (and writes nothing)', async () => {
		const {stdout, exitCode} = await runMinify(() =>
			stubAdapter(shrinkoNotFound()),
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('uv pip install shrinko');
		expect(existsSync(join(dir, 'main.min.p8'))).toBe(false);
	});

	it('cart-not-found is a distinct picopilot-side error', async () => {
		const {stdout, exitCode} = await runMinify(
			() => stubAdapter('write'),
			['minify', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});
});
