import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

/**
 * picopilot as an MCP server (`picopilot --mcp`), end to end over stdio. incur's
 * MCP transport passes no global flags to a tool call and loads no config file,
 * so these prove picopilot closes those gaps itself: the server's own
 * `--display` / `--config`, picopilot.json in the server's cwd, and a per-call
 * `display` argument (ADR-0017).
 */

const tsx = createRequire(import.meta.url).resolve('tsx');
const bin = new URL('./bin.ts', import.meta.url).pathname;

let dir: string;
let child: ChildProcess | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-mcp-'));
});
afterEach(() => {
	child?.kill('SIGKILL');
	child = undefined;
	rmSync(dir, {recursive: true, force: true});
});

/** Starts `picopilot --mcp ...` in `dir` and returns a JSON-RPC caller. */
async function mcp(argv: string[] = [], env: NodeJS.ProcessEnv = {}) {
	const proc = spawn(
		process.execPath,
		['--import', tsx, bin, '--mcp', ...argv],
		{
			cwd: dir,
			// No PICO-8 / shrinko on PATH: doctor's probes fail fast.
			env: {PATH: '/nonexistent', HOME: dir, ...env},
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	);
	child = proc;
	const waiting = new Map<number, (msg: any) => void>();
	let buf = '';
	proc.stdout!.setEncoding('utf8');
	proc.stdout!.on('data', (chunk: string) => {
		buf += chunk;
		let nl: number;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (line === '') continue;
			const msg = JSON.parse(line);
			if (typeof msg.id === 'number') waiting.get(msg.id)?.(msg);
		}
	});
	let nextId = 1;
	const request = (method: string, params: unknown) =>
		new Promise<any>((resolve) => {
			const id = nextId++;
			waiting.set(id, resolve);
			proc.stdin!.write(
				`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`,
			);
		});
	await request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: {name: 'test', version: '0'},
	});
	proc.stdin!.write(
		`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`,
	);
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const res = await request('tools/call', {name, arguments: args});
		const text = res.result?.content?.[0]?.text ?? '';
		return {isError: res.result?.isError === true, text};
	};
	return {request, call};
}

async function doctorMode(
	session: Awaited<ReturnType<typeof mcp>>,
	args: Record<string, unknown> = {},
): Promise<string> {
	const {text, isError} = await session.call('doctor', args);
	expect(isError).toBe(false);
	return JSON.parse(text).display.mode;
}

describe('picopilot --mcp: the display mode reaches tool calls', () => {
	it('defaults to auto', async () => {
		expect(await doctorMode(await mcp())).toBe('auto');
	}, 30_000);

	it('the server flag `--mcp --display xvfb` applies to every call', async () => {
		expect(await doctorMode(await mcp(['--display', 'xvfb']))).toBe('xvfb');
	}, 30_000);

	it('picopilot.json "display" in the server cwd applies (incur loads no config under --mcp)', async () => {
		writeFileSync(
			join(dir, 'picopilot.json'),
			JSON.stringify({display: 'native'}),
		);
		expect(await doctorMode(await mcp())).toBe('native');
	}, 30_000);

	it('the server flag beats PICOPILOT_DISPLAY, which beats picopilot.json', async () => {
		writeFileSync(
			join(dir, 'picopilot.json'),
			JSON.stringify({display: 'native'}),
		);
		expect(await doctorMode(await mcp([], {PICOPILOT_DISPLAY: 'xvfb'}))).toBe(
			'xvfb',
		);
		child?.kill('SIGKILL');
		expect(
			await doctorMode(
				await mcp(['--display', 'auto'], {PICOPILOT_DISPLAY: 'xvfb'}),
			),
		).toBe('auto');
	}, 30_000);

	it('--no-config on the server ignores picopilot.json', async () => {
		writeFileSync(
			join(dir, 'picopilot.json'),
			JSON.stringify({display: 'native'}),
		);
		expect(await doctorMode(await mcp(['--no-config']))).toBe('auto');
	}, 30_000);

	it('--config resolves like incur: `~` is the home dir, the last config flag wins', async () => {
		writeFileSync(
			join(dir, 'custom.json'),
			JSON.stringify({display: 'native'}),
		);
		expect(await doctorMode(await mcp(['--config', '~/custom.json']))).toBe(
			'native',
		);
		child?.kill('SIGKILL');
		expect(
			await doctorMode(await mcp(['--no-config', '--config=custom.json'])),
		).toBe('native');
	}, 30_000);

	it('a broken config stops the server visibly instead of serving without it', async () => {
		writeFileSync(join(dir, 'picopilot.json'), '{not json');
		const proc = spawn(process.execPath, ['--import', tsx, bin, '--mcp'], {
			cwd: dir,
			env: {PATH: '/nonexistent', HOME: dir},
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		child = proc;
		let stderr = '';
		proc.stderr!.setEncoding('utf8');
		proc.stderr!.on('data', (s: string) => {
			stderr += s;
		});
		const code = await new Promise<number | null>((resolve) =>
			proc.once('exit', resolve),
		);
		expect(code).toBe(1);
		expect(stderr).toContain('Invalid JSON config file');
	}, 30_000);

	it('a per-call `display` argument beats the server flag', async () => {
		const session = await mcp(['--display', 'xvfb']);
		expect(await doctorMode(session, {display: 'native'})).toBe('native');
	}, 30_000);

	it('the recording tools expose `display` as an input', async () => {
		const session = await mcp();
		const list = await session.request('tools/list', {});
		for (const name of ['audio_record', 'audio_render', 'run', 'doctor']) {
			const tool = list.result.tools.find(
				(t: {name: string}) => t.name === name,
			);
			expect(tool?.inputSchema?.properties?.display, name).toBeDefined();
		}
	}, 30_000);
});

describe('picopilot --mcp: per-command picopilot.json options still apply', () => {
	/** A cart whose sprite 130 (shared map region) already holds a pixel. */
	function cartWithSprite130Data(): string {
		const rows = Array.from({length: 128}, () => '0'.repeat(128));
		rows[64] = `${'0'.repeat(16)}7${'0'.repeat(111)}`;
		const path = join(dir, 'main.p8');
		writeFileSync(
			path,
			`pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n__gfx__\n${rows.join('\n')}\n`,
		);
		return path;
	}
	const grid = Array.from({length: 8}, () => '33333333').join('\n');

	it('gfx set is refused without authorisation, allowed by allowMapOverlap in picopilot.json', async () => {
		const cart = cartWithSprite130Data();
		const refused = await (
			await mcp()
		).call('gfx_set', {sprite: 130, grid, cart});
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain('refusing');
		child?.kill('SIGKILL');

		writeFileSync(
			join(dir, 'picopilot.json'),
			JSON.stringify({
				commands: {gfx: {commands: {set: {options: {allowMapOverlap: true}}}}},
			}),
		);
		const allowed = await (
			await mcp()
		).call('gfx_set', {sprite: 130, grid, cart});
		expect(allowed.isError).toBe(false);
		expect(JSON.parse(allowed.text).overwroteSharedData).toBe(true);
	}, 30_000);
});
