import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ShrinkoAdapter} from '../engine/shrinko/index.js';
import {shrinkoNotFound} from '../engine/shrinko/index.js';
import {type ShrinkoAdapterFactory, registerGfx} from './gfx.js';

/**
 * `gfx export` / `gfx import` are the shrinko-BACKED spritesheet round-trip
 * (distinct from the shrinko-free show/set/render). Driven here with a STUB
 * shrinko factory that writes fake outputs and records its args, so no test
 * needs the real shrinko8 binary.
 */

const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n__gfx__\n1234567890abcdef\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-gfxio-'));
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

interface Seen {
	exportArgs?: [string, string];
	importArgs?: [string, string, string];
}

/**
 * A stub shrinko adapter for the two spritesheet methods: records args, writes a
 * fake output so on-disk assertions are real, and returns ok. `absent` makes
 * both methods return the structured not-found value instead.
 */
function stubFactory(seen: Seen, absent = false): ShrinkoAdapterFactory {
	const adapter: ShrinkoAdapter = {
		async count() {
			throw new Error('not used');
		},
		async lint() {
			throw new Error('not used');
		},
		async minify() {
			throw new Error('not used');
		},
		async exportSpritesheet(cart, png) {
			seen.exportArgs = [cart, png];
			if (absent) return shrinkoNotFound();
			writeFileSync(png, 'fake png');
			return {ok: true, value: undefined};
		},
		async importSpritesheet(src, png, out) {
			seen.importArgs = [src, png, out];
			if (absent) return shrinkoNotFound();
			writeFileSync(out, '-- imported cart\n');
			return {ok: true, value: undefined};
		},
	};
	return () => adapter;
}

async function runGfx(factory: ShrinkoAdapterFactory, argv: string[]) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerGfx(cli, factory);
	let stdout = '';
	let exitCode = 0;
	await cli.serve(argv, {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		env: {PATH: '/x'},
	});
	return {stdout, exitCode};
}

describe('gfx export: raw spritesheet PNG round-trip', () => {
	it('exports to <name>-sheet.png by default', async () => {
		const seen: Seen = {};
		const {stdout, exitCode} = await runGfx(stubFactory(seen), [
			'gfx',
			'export',
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.outPath).toBe(join(dir, 'main-sheet.png'));
		expect(existsSync(join(dir, 'main-sheet.png'))).toBe(true);
		expect(seen.exportArgs?.[0]).toBe(cartPath);
	});

	it('no-clobber: refuses an existing PNG without --force', async () => {
		writeFileSync(join(dir, 'main-sheet.png'), 'existing');
		const {stdout, exitCode} = await runGfx(stubFactory({}), [
			'gfx',
			'export',
			cartPath,
		]);
		expect(exitCode).not.toBe(0);
		expect(stdout.toLowerCase()).toContain('refusing to overwrite');
	});

	it('shrinko absent -> structured not-found', async () => {
		const {stdout, exitCode} = await runGfx(stubFactory({}, true), [
			'gfx',
			'export',
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('uv pip install shrinko');
	});
});

describe('gfx import: merge a spritesheet PNG into the cart', () => {
	it('imports IN PLACE by default (writes back to the cart, like gfx set)', async () => {
		const png = join(dir, 'sheet.png');
		writeFileSync(png, 'png bytes');
		const seen: Seen = {};
		const {stdout, exitCode} = await runGfx(stubFactory(seen), [
			'gfx',
			'import',
			png,
			cartPath,
			'--json',
		]);
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout).outPath).toBe(cartPath);
		// src cart + png -> out cart, all three recorded; out defaults to the cart.
		expect(seen.importArgs).toEqual([cartPath, png, cartPath]);
	});

	it('--out writes a separate cart, leaving the source untouched', async () => {
		const png = join(dir, 'sheet.png');
		writeFileSync(png, 'png bytes');
		const outCart = join(dir, 'with-art.p8');
		const before = readFileSync(cartPath, 'utf8');
		const seen: Seen = {};
		await runGfx(stubFactory(seen), [
			'gfx',
			'import',
			png,
			cartPath,
			'--out',
			outCart,
			'--json',
		]);
		expect(seen.importArgs?.[2]).toBe(outCart);
		expect(readFileSync(cartPath, 'utf8')).toBe(before); // source untouched
	});

	it('missing PNG is a distinct error', async () => {
		const {stdout, exitCode} = await runGfx(stubFactory({}), [
			'gfx',
			'import',
			join(dir, 'nope.png'),
			cartPath,
			'--json',
		]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no PNG at');
	});
});
