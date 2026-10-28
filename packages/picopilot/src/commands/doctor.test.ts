import {Cli} from 'incur';
import {describe, expect, it} from 'vitest';
import type {Pico8Adapter, RunOptions} from '../engine/pico8/index.js';
import {pico8NotFound} from '../engine/pico8/index.js';
import {shrinkoNotFound} from '../engine/shrinko/index.js';
import type {ShrinkoAdapter} from '../engine/shrinko/index.js';
import {type DoctorDeps, registerDoctor} from './doctor.js';

/**
 * `doctor` reports what this machine can do, from injected probes: a fake
 * PICO-8 adapter (prints a version id, or is absent), a fake shrinko, a fake
 * executable lookup and a controlled parent env (DISPLAY or not).
 */

function pico8Present(versionId = 43): Pico8Adapter {
	return {
		async run(_o: RunOptions) {
			return {
				ok: true,
				value: {
					screenshots: [],
					printh: `__PICOPILOT_PICO8_VERSION__${versionId}\n`,
					exitReason: 'sentinel',
				},
			};
		},
		async record() {
			throw new Error('unused');
		},
		async drive() {
			throw new Error('unused');
		},
		async export() {
			throw new Error('unused');
		},
	};
}

const pico8Absent: Pico8Adapter = {
	...pico8Present(),
	async run() {
		return pico8NotFound();
	},
};

function shrinko(present: boolean): ShrinkoAdapter {
	return {
		async count() {
			return present
				? {ok: true, value: {tokens: 1, chars: 1, compressed: 1}}
				: shrinkoNotFound();
		},
	} as unknown as ShrinkoAdapter;
}

async function doctor(deps: DoctorDeps, argv: string[] = []) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	registerDoctor(cli, deps);
	let stdout = '';
	let exitCode = 0;
	await cli.serve(['doctor', ...argv, '--json'], {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
		env: {PICO8_PATH: '/opt/pico-8-0.2.7/pico8'},
	});
	return {out: JSON.parse(stdout), exitCode};
}

const finds =
	(...names: string[]) =>
	(n: string) =>
		names.some((x) => n === x || n.endsWith(`/${x}`)) ? n : undefined;

describe('picopilot doctor', () => {
	it('headless server with Xvfb: everything is available, -run sessions go virtual', async () => {
		const {out, exitCode} = await doctor({
			pico8: () => pico8Present(43),
			shrinko: () => shrinko(true),
			parentEnv: {},
			find: finds('pico8', 'Xvfb'),
		});
		expect(exitCode).toBe(0);
		expect(out.pico8).toMatchObject({
			found: true,
			runs: true,
			versionId: 43,
			version: '0.2.7',
		});
		expect(out.shrinko8.found).toBe(true);
		expect(out.display).toEqual({
			mode: 'auto',
			native: false,
			virtual: 'Xvfb',
			runSessions: 'xvfb',
		});
		expect(out.unavailable).toEqual([]);
		expect(out.available).toContain('audio record');
	});

	it('no display and no Xvfb: only the -run commands are unavailable, missing "display"', async () => {
		const {out} = await doctor({
			pico8: () => pico8Present(),
			shrinko: () => shrinko(true),
			parentEnv: {},
			find: finds('pico8'),
		});
		expect(out.display.runSessions).toBe('none');
		expect(
			out.unavailable.map((u: {command: string}) => u.command).sort(),
		).toEqual(['audio record', 'audio render', 'run --record-audio'].sort());
		expect(out.unavailable[0].missing).toEqual(['display']);
		expect(out.available).toContain('run');
		expect(out.available).toContain('playtest');
		expect(out.available).toContain('export');
	});

	it('a desktop (DISPLAY set): -run sessions are native', async () => {
		const {out} = await doctor({
			pico8: () => pico8Present(),
			shrinko: () => shrinko(true),
			parentEnv: {DISPLAY: ':0'},
			find: finds('pico8'),
		});
		expect(out.display.native).toBe(true);
		expect(out.display.runSessions).toBe('native');
	});

	it('no PICO-8 and no shrinko8: reports both as missing, still exits 0 (the report is the result)', async () => {
		const {out, exitCode} = await doctor({
			pico8: () => pico8Absent,
			shrinko: () => shrinko(false),
			parentEnv: {},
			find: () => undefined,
		});
		expect(exitCode).toBe(0);
		expect(out.pico8).toEqual({found: false, runs: false});
		expect(out.shrinko8.found).toBe(false);
		expect(out.available).toEqual([
			'init',
			'gfx show / set / render',
			'sfx',
			'music',
		]);
	});
});
