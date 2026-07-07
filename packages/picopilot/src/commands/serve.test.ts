import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cli} from 'incur';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {
	ExportOptions,
	Pico8Adapter,
	Pico8ExportResult,
} from '../engine/pico8/index.js';
import {pico8NotFound} from '../engine/pico8/index.js';
import {
	type CleanupRegistrar,
	type Pico8AdapterFactory,
	registerServe,
	type ServerFactory,
} from './serve.js';

const CART_TEXT =
	'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint("hi")\n';

let dir: string;
let cartPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-serve-'));
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
 * A stub adapter whose `export` writes the bundle into `outDir` so the serve
 * loop can verify the export step ran and produced a payload, WITHOUT the paid
 * binary. Records the {@link ExportOptions} for assertions.
 */
function stubAdapter(
	result: Pico8ExportResult | 'writes-bundle' | 'writes-no-js',
	seen?: {options?: ExportOptions},
): Pico8Adapter {
	const notUsed = () => {
		throw new Error('not used by serve');
	};
	return {
		run: notUsed as never,
		record: notUsed as never,
		drive: notUsed as never,
		async export(options) {
			if (seen !== undefined) seen.options = options;
			if (result === 'writes-bundle') {
				const html = join(options.outDir, 'index.html');
				const js = join(options.outDir, 'index.js');
				writeFileSync(html, '<html></html>');
				writeFileSync(js, '// runtime');
				return {
					ok: true,
					value: {
						htmlPath: html,
						jsPath: js,
						files: [html, js],
						labelWarning: false,
					},
				};
			}
			if (result === 'writes-no-js') {
				return {
					ok: true,
					value: {
						htmlPath: undefined,
						jsPath: undefined,
						files: [],
						labelWarning: true,
					},
				};
			}
			return result;
		},
	};
}

/**
 * A fake {@link ServerFactory} that never opens a real socket: it records the
 * root dir it was asked to serve and returns a dummy server + the port it would
 * have bound. This keeps the serve loop testable with no dangling listener.
 */
function fakeServer(seen?: {rootDir?: string; port?: number}): ServerFactory {
	return async (rootDir, port) => {
		if (seen !== undefined) {
			seen.rootDir = rootDir;
			seen.port = port;
		}
		// A minimal object satisfying the return contract; nothing listens.
		return {server: {close() {}} as never, port: port === 0 ? 49152 : port};
	};
}

async function runServe(
	factory: Pico8AdapterFactory,
	serverFactory: ServerFactory,
	argv: string[] = ['serve', cartPath, '--json'],
	env: Record<string, string | undefined> = {PATH: '/does/not/matter'},
	// Captures the cleanup fn instead of wiring real process signal handlers.
	cleanupSink?: {cleanup?: () => void},
) {
	const cli = Cli.create('picopilot', {version: '0.0.0'});
	const registerCleanup: CleanupRegistrar = (cleanup) => {
		if (cleanupSink !== undefined) cleanupSink.cleanup = cleanup;
	};
	registerServe(cli, factory, serverFactory, registerCleanup);
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

describe('picopilot serve: PICO-8 absent (serve always exports, so it requires PICO-8)', () => {
	it('returns structured pico8-not-found + nonzero exit before serving anything', async () => {
		const seen: {rootDir?: string} = {};
		const {stdout, exitCode} = await runServe(
			() => stubAdapter(pico8NotFound()),
			fakeServer(seen),
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('set PICO8_PATH or install PICO-8');
		// The server was never bound because the export failed first.
		expect(seen.rootDir).toBeUndefined();
	});
});

describe('picopilot serve: export-then-serve loop', () => {
	it('exports the cart, then serves the export dir and reports the URL', async () => {
		const exportSeen: {options?: ExportOptions} = {};
		const serveSeen: {rootDir?: string; port?: number} = {};
		const {stdout, exitCode} = await runServe(
			() => stubAdapter('writes-bundle', exportSeen),
			fakeServer(serveSeen),
			['serve', cartPath, '--port', '8080', '--json'],
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout);
		expect(out.url).toBe('http://127.0.0.1:8080/');
		expect(out.port).toBe(8080);
		// The dir served is exactly the dir the export wrote into (a temp dir).
		expect(serveSeen.rootDir).toBe(exportSeen.options?.outDir);
		expect(serveSeen.rootDir?.startsWith(tmpdir())).toBe(true);
	});

	it('registers a cleanup that removes the temp serve dir (no leak on a long-lived serve)', async () => {
		const serveSeen: {rootDir?: string} = {};
		const cleanupSink: {cleanup?: () => void} = {};
		await runServe(
			() => stubAdapter('writes-bundle'),
			fakeServer(serveSeen),
			['serve', cartPath, '--json'],
			{PATH: '/does/not/matter'},
			cleanupSink,
		);
		const serveDir = serveSeen.rootDir!;
		// The dir exists while serving; the registered cleanup removes it on exit.
		expect(existsSync(serveDir)).toBe(true);
		expect(cleanupSink.cleanup).toBeTypeOf('function');
		cleanupSink.cleanup!();
		expect(existsSync(serveDir)).toBe(false);
	});

	it('reports the OS-assigned port when --port 0 is chosen', async () => {
		const {stdout} = await runServe(
			() => stubAdapter('writes-bundle'),
			fakeServer(),
			['serve', cartPath, '--port', '0', '--json'],
		);
		const out = JSON.parse(stdout);
		// The fake maps 0 -> 49152 to model an OS-assigned free port.
		expect(out.port).toBe(49152);
		expect(out.url).toBe('http://127.0.0.1:49152/');
	});
});

describe('picopilot serve: failure paths', () => {
	it('errors when the export produced no bundle, and removes the temp dir immediately', async () => {
		const serveSeen: {rootDir?: string} = {};
		const exportSeen: {options?: ExportOptions} = {};
		const {stdout, exitCode} = await runServe(
			() => stubAdapter('writes-no-js', exportSeen),
			fakeServer(serveSeen),
			['serve', cartPath, '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(serveSeen.rootDir).toBeUndefined();
		// The temp dir created before the failed export is cleaned up on the spot.
		expect(existsSync(exportSeen.options!.outDir)).toBe(false);
		// The labelless message redirects to the self-verify tools (run/playtest)
		// and points at the real label remedy, NOT hand-editing main.p8: this is the
		// exact loop weak models fell into.
		const lower = stdout.toLowerCase();
		expect(lower).toContain('picopilot run');
		expect(lower).toContain('playtest');
		expect(lower).toContain('export --label');
		expect(lower).toContain('do not hand-edit main.p8');
	});

	it('errors with a nonzero exit when the cart path does not exist', async () => {
		const {stdout, exitCode} = await runServe(
			() => stubAdapter('writes-bundle'),
			fakeServer(),
			['serve', join(dir, 'nope.p8'), '--json'],
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('no cart at');
	});
});
