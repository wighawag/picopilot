import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ChildRunner} from '../engine/shrinko/index.js';
import {createShellShrinkoFactory} from './shrinko-env.js';
import {registerTokens} from './tokens.js';

/**
 * shrinko8 is a Python tool: a `pip install --user` copy is found through HOME
 * (user site-packages), so the child must inherit the parent environment, with
 * the command's resolved PATH overlaid (the same rule as the PICO-8 child,
 * ADR-0017).
 */

let dir: string;
let cartPath: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-shrinko-env-'));
	cartPath = join(dir, 'main.p8');
	writeFileSync(
		cartPath,
		'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n',
	);
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

describe('shrinko child env', () => {
	it('HOME and the rest of the parent env reach shrinko; PATH comes from the resolved env', async () => {
		let seen: NodeJS.ProcessEnv | undefined;
		const run: ChildRunner = async (_file, _args, env) => {
			seen = env;
			return {
				code: 0,
				stdout: 'tokens: 3 0%\nchars: 11 0%\ncompressed: 20 0%\n',
				stderr: '',
				spawnError: undefined,
			};
		};
		const cli = Cli.create('picopilot', {version: '0.0.0'});
		registerTokens(
			cli,
			createShellShrinkoFactory({
				parentEnv: {
					HOME: '/home/agent',
					PYTHONUSERBASE: '/home/agent/.local',
					PATH: '/parent/bin',
				},
				run,
			}),
		);
		let stdout = '';
		await cli.serve(['tokens', cartPath, '--json'], {
			stdout(s) {
				stdout += s;
			},
			exit() {},
			env: {PATH: '/resolved/bin'},
		});
		expect(JSON.parse(stdout).tokens).toBe(3);
		expect(seen).toMatchObject({
			HOME: '/home/agent',
			PYTHONUSERBASE: '/home/agent/.local',
			PATH: '/resolved/bin',
		});
	});
});
