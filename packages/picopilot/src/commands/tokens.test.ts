import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {
	CountReport,
	ShrinkoAdapter,
	ShrinkoResult,
} from '../engine/shrinko/index.js';
import {shrinkoNotFound} from '../engine/shrinko/index.js';
import {type ShrinkoAdapterFactory, registerTokens} from './tokens.js';

/** A trivial but valid cart the command reads (existence + a path to hand shrinko). */
const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-tokens-'));
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
 * A stub {@link ShrinkoAdapter} standing in for BOTH a shrinko-present shell
 * adapter and a hypothetical native-TS adapter. It never spawns anything, so no
 * test depends on shrinko being installed. `count` returns whatever result the
 * test wired.
 */
function stubAdapter(result: ShrinkoResult<CountReport>): ShrinkoAdapter {
	return {
		async count() {
			return result;
		},
	};
}

function present(over: boolean): ShrinkoResult<CountReport> {
	return {
		ok: true,
		// Over: 9001 tokens > the 8192 budget. Under: a small cart.
		value: over
			? {
					tokens: 9001,
					tokensPct: 109,
					chars: 34000,
					charsPct: 52,
					compressed: 13000,
					compressedPct: 82,
				}
			: {
					tokens: 512,
					tokensPct: 6,
					chars: 1840,
					charsPct: 2,
					compressed: 980,
					compressedPct: 6,
				},
	};
}

/**
 * Drives `picopilot tokens` through incur's `serve` DI with an INJECTED adapter
 * factory (the seam), capturing stdout + exit without the real environment or
 * the real binary. `env` defaults to a bare PATH the (stub) adapter ignores.
 */
async function runTokens(
	factory: ShrinkoAdapterFactory,
	argv: string[] = ['tokens', cartPath, '--json'],
	env: Record<string, string | undefined> = {PATH: '/does/not/matter'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerTokens(cli, factory);
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

describe('picopilot tokens: present (parses --count into the budget struct)', () => {
	it('reports {tokens, pct, chars, compressed} under budget with no minify CTA', async () => {
		const {stdout, exitCode} = await runTokens(() =>
			stubAdapter(present(false)),
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.tokens).toBe(512);
		expect(out.chars).toBe(1840);
		expect(out.compressed).toBe(980);
		expect(out.budget).toBe(8192);
		expect(out.overBudget).toBe(false);
		// 512 / 8192 ≈ 6%.
		expect(out.pct).toBe(6);
		// Under budget: no minify CTA.
		expect(out.cta).toBeUndefined();
		expect(JSON.stringify(out)).not.toContain('minify');
	});

	it('reports over budget and CTAs to minify', async () => {
		const {stdout, exitCode} = await runTokens(() =>
			stubAdapter(present(true)),
		);
		// Over budget is still a successful count (exit 0); the CTA drives the fix.
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.tokens).toBe(9001);
		expect(out.overBudget).toBe(true);
		// 9001 / 8192 ≈ 110%.
		expect(out.pct).toBe(110);
		// The over-budget → minify CTA is present (incur prefixes the CLI name).
		expect(out.cta.commands[0].command).toContain('minify');
	});
});

describe('picopilot tokens: absent (structured shrinko-not-found + nonzero exit)', () => {
	it('returns the exact structured failure and a nonzero exit, never a crash', async () => {
		const {stdout, exitCode} = await runTokens(() =>
			stubAdapter(shrinkoNotFound()),
		);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		// incur error envelope: the reason is the machine code, the exact remedy is
		// carried in the message so an agent reading only the message learns the fix.
		expect(out.code).toBe('shrinko-not-found');
		expect(out.message).toContain('uv pip install shrinko');
		expect(out.message).toContain('python>=3.8');
	});
});

describe('picopilot tokens: seam-swap (a stub adapter leaves output/exit unchanged)', () => {
	it('produces byte-identical public output whether the adapter is A or B', async () => {
		// Two DIFFERENT adapter implementations returning the SAME count value must
		// yield the SAME command output + exit: the command depends only on the
		// interface, so a native-TS shrinko drops in without a visible change.
		const value = present(true);
		// A: returns the value synchronously-resolved.
		const adapterA: ShrinkoAdapter = {
			async count() {
				return value;
			},
		};
		// B: a DIFFERENT implementation (extra async work, freshly-built struct) that
		// yields the same count. Stands in for a native-TS shrinko behind the seam.
		const adapterB: ShrinkoAdapter = {
			async count() {
				await Promise.resolve();
				const v = value.ok ? value.value : undefined;
				if (v === undefined) throw new Error('unreachable');
				return {ok: true, value: {...v}};
			},
		};

		const a = await runTokens(() => adapterA);
		const b = await runTokens(() => adapterB);
		expect(a.stdout).toBe(b.stdout);
		expect(a.exitCode).toBe(b.exitCode);
	});

	it('the injected factory receives the incur-resolved env (PATH isolation lever)', async () => {
		let seenEnv: NodeJS.ProcessEnv | undefined;
		const factory: ShrinkoAdapterFactory = (env) => {
			seenEnv = env;
			return stubAdapter(present(false));
		};
		await runTokens(factory, ['tokens', cartPath, '--json'], {
			PATH: '/isolated/bin',
		});
		// The command handed the adapter exactly the overridden env, so the child's
		// PATH is controllable from the test without touching the real environment.
		expect(seenEnv?.PATH).toBe('/isolated/bin');
	});
});

describe('picopilot tokens: a missing cart is a distinct error (not shrinko-not-found)', () => {
	it('errors with cart-not-found + nonzero exit when the cart path does not exist', async () => {
		const {stdout, exitCode} = await runTokens(
			() => stubAdapter(present(false)),
			['tokens', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.code).toBe('cart-not-found');
	});
});
