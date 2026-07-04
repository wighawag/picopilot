import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
	type ChildResult,
	type ChildRunner,
	parseCount,
	SHRINKO_REMEDY,
	ShellShrinkoAdapter,
	ShrinkoParseError,
} from './index.js';

/** Reads a captured `--count` sample as raw text. */
function sample(name: string): string {
	return readFileSync(
		fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
		'utf8',
	);
}

/** A recorded spawn, so tests can assert the exact argv + env the adapter used. */
interface Spawn {
	file: string;
	args: string[];
	env: NodeJS.ProcessEnv;
}

/**
 * Builds a stub {@link ChildRunner} that returns a fixed {@link ChildResult} for
 * a chosen `file`, and ENOENT for every other candidate. Records each spawn so a
 * test can assert which invocation was used and with what env. This is how every
 * test drives shrinko present/absent WITHOUT the real binary.
 */
function stubRunner(opts: {
	presentFile?: string;
	stdout?: string;
	stderr?: string;
	code?: number;
}): {run: ChildRunner; spawns: Spawn[]} {
	const spawns: Spawn[] = [];
	const run: ChildRunner = async (file, args, env) => {
		spawns.push({file, args, env});
		if (opts.presentFile !== undefined && file === opts.presentFile) {
			return {
				code: opts.code ?? 0,
				stdout: opts.stdout ?? '',
				stderr: opts.stderr ?? '',
				spawnError: undefined,
			} satisfies ChildResult;
		}
		// Not the present binary → simulate ENOENT (not installed on PATH).
		const err = Object.assign(new Error(`spawn ${file} ENOENT`), {
			code: 'ENOENT',
		}) as NodeJS.ErrnoException;
		return {code: null, stdout: '', stderr: '', spawnError: err};
	};
	return {run, spawns};
}

describe('parseCount: parses shrinko --count output', () => {
	it('parses the documented over-budget sample', () => {
		const report = parseCount(sample('count-over-budget.txt'));
		expect(report).toEqual({
			tokens: 8053,
			tokensPct: 98,
			chars: 30320,
			charsPct: 46,
			compressed: 12176,
			compressedPct: 77,
		});
	});

	it('parses a sample with no compressed line (compressed undefined)', () => {
		const report = parseCount(sample('count-no-compressed.txt'));
		expect(report.tokens).toBe(300);
		expect(report.chars).toBe(1200);
		expect(report.compressed).toBeUndefined();
		expect(report.compressedPct).toBeUndefined();
	});

	it('parses the count even when embedded in surrounding output/whitespace', () => {
		const noisy = `some banner line\n\n  tokens: 8053 98%\n  chars: 30320 46%\n  compressed: 12176 77%\ntrailing\n`;
		const report = parseCount(noisy);
		expect(report.tokens).toBe(8053);
		expect(report.chars).toBe(30320);
		expect(report.compressed).toBe(12176);
	});

	it('throws ShrinkoParseError when the required lines are absent', () => {
		expect(() => parseCount('unexpected shrinko output\n')).toThrow(
			ShrinkoParseError,
		);
	});
});

describe('ShellShrinkoAdapter.count: present', () => {
	it('parses --count from the shrinko8 entry-point on PATH', async () => {
		const {run, spawns} = stubRunner({
			presentFile: 'shrinko8',
			stdout: sample('count-over-budget.txt'),
		});
		const adapter = new ShellShrinkoAdapter({env: {PATH: '/fake/bin'}, run});
		const result = await adapter.count('/carts/main.p8');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.tokens).toBe(8053);
			expect(result.value.chars).toBe(30320);
			expect(result.value.compressed).toBe(12176);
		}
		// It spawned `shrinko8 /carts/main.p8 --count` first and stopped there.
		expect(spawns[0]?.file).toBe('shrinko8');
		expect(spawns[0]?.args).toEqual(['/carts/main.p8', '--count']);
	});

	it('parses --count even when shrinko prints to stderr', async () => {
		const {run} = stubRunner({
			presentFile: 'shrinko8',
			stdout: '',
			stderr: sample('count-under-budget.txt'),
		});
		const adapter = new ShellShrinkoAdapter({env: {PATH: '/fake/bin'}, run});
		const result = await adapter.count('/carts/main.p8');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.tokens).toBe(512);
	});

	it('falls back to `python -m shrinko8` when shrinko8 is not on PATH', async () => {
		const {run, spawns} = stubRunner({
			presentFile: 'python',
			stdout: sample('count-over-budget.txt'),
		});
		const adapter = new ShellShrinkoAdapter({env: {PATH: '/fake/bin'}, run});
		const result = await adapter.count('/carts/main.p8');

		expect(result.ok).toBe(true);
		// First tried shrinko8 (ENOENT), then python -m shrinko8 (spawned).
		expect(spawns.map((s) => s.file)).toEqual(['shrinko8', 'python']);
		expect(spawns[1]?.args).toEqual([
			'-m',
			'shrinko8',
			'/carts/main.p8',
			'--count',
		]);
	});
});

describe('ShellShrinkoAdapter.count: absent (structured, never a crash)', () => {
	it('returns shrinko-not-found with the EXACT remedy when nothing spawns', async () => {
		// Every candidate ENOENTs (an empty PATH is the isolation lever).
		const {run, spawns} = stubRunner({presentFile: undefined});
		const adapter = new ShellShrinkoAdapter({env: {}, run});
		const result = await adapter.count('/carts/main.p8');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('shrinko-not-found');
			expect(result.remedy).toBe(SHRINKO_REMEDY);
			expect(result.remedy).toBe('uv pip install shrinko');
			expect(result.needs).toEqual(['python>=3.8']);
		}
		// It tried every invocation candidate before giving up.
		expect(spawns.map((s) => s.file)).toEqual([
			'shrinko8',
			'python',
			'python3',
		]);
	});

	it('passes ONLY the given env to the child (the PATH isolation lever)', async () => {
		const {run, spawns} = stubRunner({
			presentFile: 'shrinko8',
			stdout: sample('count-over-budget.txt'),
		});
		const env = {PATH: '/only/this/bin', SOME_OTHER: 'x'};
		const adapter = new ShellShrinkoAdapter({env, run});
		await adapter.count('/carts/main.p8');
		// The child sees exactly the env we handed the adapter, nothing ambient.
		expect(spawns[0]?.env).toEqual(env);
	});
});
