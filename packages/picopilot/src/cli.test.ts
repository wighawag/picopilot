import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createCli} from './cli.js';
import {displayModeOf} from './commands/pico8-env.js';

/**
 * The display mode (ADR-0017) is resolved ONCE, globally, by the root CLI:
 * `--display` > `PICOPILOT_DISPLAY` > picopilot.json `display` > `auto`. A probe
 * command mounted on the real CLI reports what a command handler sees.
 */

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-cli-'));
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

async function probe(
	argv: string[],
	env: Record<string, string | undefined> = {},
	config?: unknown,
) {
	const cli = createCli();
	cli.command('probe-display', {
		run: (c) => ({display: displayModeOf(c.var)}),
	});
	const args = [...argv];
	if (config !== undefined) {
		const path = join(dir, 'picopilot.json');
		writeFileSync(path, JSON.stringify(config));
		args.push('--config', path);
	}
	let stdout = '';
	let exitCode = 0;
	await cli.serve([...args, '--json'], {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		env,
	});
	return {out: JSON.parse(stdout), exitCode};
}

describe('display mode resolution through the CLI', () => {
	it('defaults to auto', async () => {
		expect((await probe(['probe-display'])).out.display).toBe('auto');
	});

	it('reads picopilot.json "display"', async () => {
		const {out} = await probe(['probe-display'], {}, {display: 'native'});
		expect(out.display).toBe('native');
	});

	it('PICOPILOT_DISPLAY beats picopilot.json', async () => {
		const {out} = await probe(
			['probe-display'],
			{PICOPILOT_DISPLAY: 'xvfb'},
			{display: 'native'},
		);
		expect(out.display).toBe('xvfb');
	});

	it('--display beats both, before or after the command', async () => {
		for (const argv of [
			['--display', 'native', 'probe-display'],
			['probe-display', '--display', 'native'],
		]) {
			const {out} = await probe(
				argv,
				{PICOPILOT_DISPLAY: 'xvfb'},
				{display: 'xvfb'},
			);
			expect(out.display).toBe('native');
		}
	});

	it('an invalid PICOPILOT_DISPLAY is an error for a display command, not a silent auto', async () => {
		const cli = createCli();
		let stdout = '';
		let exitCode = 0;
		await cli.serve(['run', join(dir, 'none.p8'), '--json'], {
			stdout(s) {
				stdout += s;
			},
			exit(code) {
				exitCode = code;
			},
			env: {PICOPILOT_DISPLAY: 'xfvb'},
		});
		expect(exitCode).not.toBe(0);
		const out = JSON.parse(stdout);
		expect(out.code).toBe('invalid-display-mode');
		expect(out.message).toContain('PICOPILOT_DISPLAY');
	});

	it('an invalid value does not break commands that never use the display', async () => {
		const cli = createCli();
		let stdout = '';
		let exitCode = 0;
		await cli.serve(['version', '--json'], {
			stdout(s) {
				stdout += s;
			},
			exit(code) {
				exitCode = code;
			},
			env: {PICOPILOT_DISPLAY: 'xfvb'},
		});
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout).name).toBe('picopilot');
	});

	it('--no-config ignores the picopilot.json display key', async () => {
		const path = join(dir, 'picopilot.json');
		writeFileSync(path, JSON.stringify({display: 'native'}));
		// First load it (so a stale value could leak), then disable config.
		const cli = createCli();
		cli.command('probe-display', {
			run: (c) => ({display: displayModeOf(c.var)}),
		});
		const outs: string[] = [];
		for (const argv of [
			['probe-display', '--config', path, '--json'],
			['probe-display', '--no-config', '--json'],
		]) {
			let stdout = '';
			await cli.serve(argv, {
				stdout(s) {
					stdout += s;
				},
				exit() {},
				env: {},
			});
			outs.push(JSON.parse(stdout).display);
		}
		expect(outs).toEqual(['native', 'auto']);
	});

	it('--config naming a missing file is an error', async () => {
		const cli = createCli();
		let stdout = '';
		let exitCode = 0;
		await cli.serve(['version', '--config', join(dir, 'nope.json'), '--json'], {
			stdout(s) {
				stdout += s;
			},
			exit(code) {
				exitCode = code;
			},
			env: {},
		});
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('not found');
	});

	it('a per-command config option still loads next to the display key', async () => {
		// The custom config loader must keep incur's per-command option defaults.
		const cli = createCli();
		let seen: unknown;
		cli.command('probe-opt', {
			options: z.object({flag: z.boolean().default(false)}),
			run: (c) => {
				seen = c.options.flag;
				return {};
			},
		});
		const path = join(dir, 'picopilot.json');
		writeFileSync(
			path,
			JSON.stringify({
				display: 'native',
				commands: {'probe-opt': {options: {flag: true}}},
			}),
		);
		await cli.serve(['probe-opt', '--config', path, '--json'], {
			stdout() {},
			exit() {},
			env: {},
		});
		expect(seen).toBe(true);
	});
});
