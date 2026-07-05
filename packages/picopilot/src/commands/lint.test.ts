import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {
	LintReport,
	ShrinkoAdapter,
	ShrinkoResult,
} from '../engine/shrinko/index.js';
import {parseLint, shrinkoNotFound} from '../engine/shrinko/index.js';
import {type ShrinkoAdapterFactory, registerLint} from './lint.js';

const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-lint-'));
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

/** A stub adapter whose `lint` returns whatever the test wires; `count`/`minify` unused here. */
function stubAdapter(result: ShrinkoResult<LintReport>): ShrinkoAdapter {
	return {
		async count() {
			throw new Error('not used');
		},
		async lint() {
			return result;
		},
		async minify() {
			throw new Error('not used');
		},
	};
}

async function runLint(
	factory: ShrinkoAdapterFactory,
	argv: string[] = ['lint', cartPath, '--json'],
	env: Record<string, string | undefined> = {PATH: '/x'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerLint(cli, factory);
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

describe('parseLint: shrinko --lint output to structured findings', () => {
	it('parses file:line:col: message lines, dropping the filename', () => {
		const out = [
			'Lint warnings:',
			"lintme.p8:5:8: Local 'unused' isn't used",
			"lintme.p8:6:4: Identifier 'undefined_global' not found",
		].join('\n');
		const {findings} = parseLint(out);
		expect(findings).toHaveLength(2);
		expect(findings[0]).toEqual({
			line: 5,
			col: 8,
			message: "Local 'unused' isn't used",
		});
		expect(findings[1]?.message).toContain('undefined_global');
	});

	it('a clean cart (no warning lines) parses to zero findings, not an error', () => {
		expect(parseLint('').findings).toEqual([]);
		expect(parseLint('Lint warnings:\n').findings).toEqual([]);
	});
});

describe('picopilot lint: present', () => {
	it('reports findings as data (exit 0) and CTAs when there are warnings', async () => {
		const {stdout, exitCode} = await runLint(() =>
			stubAdapter({
				ok: true,
				value: {findings: [{line: 5, col: 8, message: "Local 'x' isn't used"}]},
			}),
		);
		// Findings are DATA, not a failure exit.
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.clean).toBe(false);
		expect(out.count).toBe(1);
		expect(out.findings[0].message).toContain('x');
	});

	it('a clean cart reports clean=true and no CTA', async () => {
		const {stdout, exitCode} = await runLint(() =>
			stubAdapter({ok: true, value: {findings: []}}),
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.clean).toBe(true);
		expect(out.count).toBe(0);
	});
});

describe('picopilot lint: shrinko absent + cart missing', () => {
	it('returns structured shrinko-not-found + nonzero exit', async () => {
		const {stdout, exitCode} = await runLint(() =>
			stubAdapter(shrinkoNotFound()),
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('uv pip install shrinko');
	});

	it('cart-not-found is a distinct picopilot-side error', async () => {
		const {stdout, exitCode} = await runLint(
			() => stubAdapter({ok: true, value: {findings: []}}),
			['lint', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});
});
