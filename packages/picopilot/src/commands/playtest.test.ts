import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {
	DriveOptions,
	Pico8Adapter,
	Pico8DriveResult,
} from '../engine/pico8/index.js';
import {BlockDecoder, pico8NotFound} from '../engine/pico8/index.js';
import {type Pico8AdapterFactory, registerPlaytest} from './playtest.js';

/**
 * `picopilot playtest` command wiring tests. Like `run`, they inject a STUB
 * adapter (never spawning the paid PICO-8 binary), so the CI-testable surface is
 * exercised: PICO-8 absent, the structured envelope, --seed threading, input
 * validation, shotDir isolation (never ~/Desktop), and the entry cart being
 * untouched. Live drive-and-capture is the manual/opt-in tier.
 */

const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n' +
	'x=64\nfunction _update() if btnp(4) then x+=1 end end\n' +
	'function _draw() cls() circfill(x,64,4,8) end\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-playtest-test-'));
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
 * A stub {@link Pico8Adapter} standing in for the shell adapter. It never spawns
 * PICO-8 and RECORDS the {@link DriveOptions} it was handed, so a test can assert
 * the command chose an isolated shotDir + piped the encoded blocks.
 */
function stubAdapter(
	result: Pico8DriveResult,
	seen?: {options?: DriveOptions},
): Pico8Adapter {
	return {
		async run() {
			throw new Error('run not used by playtest');
		},
		async record() {
			throw new Error('record not used by playtest');
		},
		async drive(options) {
			if (seen !== undefined) seen.options = options;
			return result;
		},
	};
}

function drove(exitReason: 'sentinel' | 'timeout' | 'exit'): Pico8DriveResult {
	return {
		ok: true,
		value: {
			screenshots: ['/tmp/play0.png', '/tmp/play1.png'],
			printh: '__PP_ACK_STEP__\n__PICOPILOT_DONE__\n',
			exitReason,
		},
	};
}

async function runPlaytest(
	factory: Pico8AdapterFactory,
	argv: string[] = ['playtest', 'run', cartPath, '--json'],
	env: Record<string, string | undefined> = {PATH: '/does/not/matter'},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerPlaytest(cli, factory);
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

describe('picopilot playtest: PICO-8 absent (the CI-testable boundary)', () => {
	it('returns structured pico8-not-found + nonzero exit (mirrors run, never a crash)', async () => {
		const {stdout, exitCode} = await runPlaytest(() =>
			stubAdapter(pico8NotFound()),
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('set PICO8_PATH or install PICO-8');
		expect(stdout).toContain('pico8');
	});
});

describe('picopilot playtest: structured drive envelope', () => {
	it('reports screenshots + printh + exitReason + steps on a sentinel-ended run', async () => {
		const {stdout, exitCode} = await runPlaytest(() =>
			stubAdapter(drove('sentinel')),
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.exitReason).toBe('sentinel');
		expect(out.screenshots).toHaveLength(2);
		expect(out.steps).toBeGreaterThan(0);
		expect(out.shotCount).toBeGreaterThan(0);
	});

	it('a backstop timeout CTAs toward verify/run', async () => {
		const {stdout, exitCode} = await runPlaytest(() =>
			stubAdapter(drove('timeout')),
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.exitReason).toBe('timeout');
		expect(stdout.toLowerCase()).toContain('verify');
	});
});

describe('picopilot playtest: --input + --seed threading', () => {
	it('parses an explicit --input into the driven blocks (right-nudge present)', async () => {
		const seen: {options?: DriveOptions} = {};
		await runPlaytest(
			() => stubAdapter(drove('sentinel'), seen),
			[
				'playtest',
				'run',
				cartPath,
				'--input',
				'3:1',
				'--frames',
				'5',
				'--json',
			],
		);
		// The blocks piped to the cart decode to a script that presses Right (bit 1).
		const cmds = new BlockDecoder().push(seen.options!.blocks);
		const inputs = cmds.filter((c) => c.op === 'input');
		expect(inputs.some((c) => c.op === 'input' && c.held === 0b10)).toBe(true);
	});

	it('rejects a malformed --input with a structured error (no launch)', async () => {
		let launched = false;
		const {stdout, exitCode} = await runPlaytest(() => {
			launched = true;
			return stubAdapter(drove('sentinel'));
		}, ['playtest', 'run', cartPath, '--input', '3:9', '--json']);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('playtest-input-invalid');
		expect(launched).toBe(false); // fails before the adapter is built
	});

	it('--seed sets seeded=true and injects srand into the driven cart', async () => {
		const seen: {options?: DriveOptions} = {};
		const {stdout} = await runPlaytest(
			() => stubAdapter(drove('sentinel'), seen),
			['playtest', 'run', cartPath, '--seed', '7', '--json'],
		);
		expect(JSON.parse(stdout).seeded).toBe(true);
		// The driven cart written for PICO-8 carries srand(7).
		const driven = readFileSync(seen.options!.cartPath, 'utf8');
		expect(driven).toContain('srand(7)');
	});

	it('no --seed => seeded false and no srand injected', async () => {
		const seen: {options?: DriveOptions} = {};
		const {stdout} = await runPlaytest(
			() => stubAdapter(drove('sentinel'), seen),
			['playtest', 'run', cartPath, '--json'],
		);
		expect(JSON.parse(stdout).seeded).toBe(false);
		expect(readFileSync(seen.options!.cartPath, 'utf8')).not.toContain(
			'srand(',
		);
	});
});

describe('picopilot playtest: shared-write discipline (never ~/Desktop, entry untouched)', () => {
	it('defaults to an isolated temp dir, not the real ~/Desktop', async () => {
		const seen: {options?: DriveOptions} = {};
		const {exitCode} = await runPlaytest(() =>
			stubAdapter(drove('sentinel'), seen),
		);
		expect(exitCode).toBe(0);
		const shotDir = seen.options?.shotDir ?? '';
		expect(shotDir.startsWith(tmpdir())).toBe(true);
		expect(shotDir).not.toContain(join(homedir(), 'Desktop'));
		expect(existsSync(shotDir)).toBe(true);
	});

	it('writes the throwaway driven cart into the temp dir, NOT next to the entry', async () => {
		const seen: {options?: DriveOptions} = {};
		await runPlaytest(() => stubAdapter(drove('sentinel'), seen));
		const drivenCart = seen.options?.cartPath ?? '';
		expect(drivenCart.startsWith(tmpdir())).toBe(true);
		expect(drivenCart).not.toBe(cartPath);
	});

	it('leaves the entry cart bytes BYTE-untouched across a playtest', async () => {
		await runPlaytest(
			() => stubAdapter(drove('sentinel')),
			['playtest', 'run', cartPath, '--seed', '1', '--json'],
		);
		expect(readFileSync(cartPath, 'utf8')).toBe(CART_TEXT);
	});

	it('leaves the real ~/Desktop BYTE-untouched across a playtest', async () => {
		const desktop = join(homedir(), 'Desktop');
		const snap = (): string[] =>
			existsSync(desktop) ? readdirSync(desktop).sort() : [];
		const before = snap();
		await runPlaytest(() => stubAdapter(drove('sentinel')));
		expect(snap()).toEqual(before);
	});
});

describe('picopilot playtest: cart-not-found (picopilot-side, distinct from pico8 absence)', () => {
	it('errors with a nonzero exit when the cart path does not exist', async () => {
		const {stdout, exitCode} = await runPlaytest(
			() => stubAdapter(drove('sentinel')),
			['playtest', 'run', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});

	it('does NOT invoke the adapter when the cart is missing (fails fast)', async () => {
		let called = false;
		await runPlaytest(() => {
			called = true;
			return stubAdapter(drove('sentinel'));
		}, ['playtest', 'run', join(dir, 'missing.p8'), '--json']);
		expect(called).toBe(false);
	});
});

/**
 * The RESUMABLE session verbs' CI-safe surface (no daemon, no binary): a verb
 * against an id with no live daemon is a structured `playtest-session-not-found`;
 * a malformed id / buttons is a structured refusal before any socket work. The
 * live daemon round-trip is covered in `session-daemon.test.ts` (fake process)
 * and the manual/opt-in tier (real PICO-8).
 */
describe('picopilot playtest session verbs: structured boundaries (no daemon)', () => {
	it('step/input/shot/status on an unknown id -> playtest-session-not-found', async () => {
		for (const argv of [
			['playtest', 'step', 'ghost', '--json'],
			['playtest', 'input', 'ghost', 'right', '--json'],
			['playtest', 'shot', 'ghost', '--json'],
			['playtest', 'status', 'ghost', '--json'],
		]) {
			const {stdout, exitCode} = await runPlaytest(
				() => stubAdapter(drove('sentinel')),
				argv,
			);
			expect(exitCode).not.toBe(0);
			expect(stdout).toContain('playtest-session-not-found');
		}
	});

	it('stop on an unknown id is an idempotent no-op success (alive:false)', async () => {
		const {stdout, exitCode} = await runPlaytest(
			() => stubAdapter(drove('sentinel')),
			['playtest', 'stop', 'ghost', '--json'],
		);
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout).alive).toBe(false);
	});

	it('a malformed session id is a structured refusal', async () => {
		const {stdout, exitCode} = await runPlaytest(
			() => stubAdapter(drove('sentinel')),
			['playtest', 'step', '../escape', '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('playtest-session-id-invalid');
	});

	it('an unknown button on `input` is a structured refusal (before any socket)', async () => {
		const {stdout, exitCode} = await runPlaytest(
			() => stubAdapter(drove('sentinel')),
			['playtest', 'input', 'ghost', 'jump', '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('playtest-input-invalid');
	});

	it('start with an invalid id refuses before spawning anything', async () => {
		const {stdout, exitCode} = await runPlaytest(
			() => stubAdapter(drove('sentinel')),
			['playtest', 'start', cartPath, '--id', 'bad id', '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('playtest-session-id-invalid');
	});
});
