import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {DONE_SENTINEL} from './adapter.js';
import {findExecutable} from './display.js';
import {ShellPico8Adapter} from './shell.js';

/** An absolute `sleep` (the scripts run with a minimal PATH; NixOS has no /bin/sleep). */
const SLEEP = findExecutable('sleep', process.env) ?? '/bin/sleep';

/**
 * The no-stray-process guarantee (ADR-0017), proven with REAL processes: a fake
 * `Xvfb` (a shell script honouring `-displayfd 3`) and a fake `pico8` (a shell
 * script that prints the sentinel, hangs, or crashes), spawned by the real
 * spawners. After every record run, BOTH pids must be gone. POSIX-only (sh).
 */

let dir: string;
let pidDir: string;

/** Writes an executable shell script. */
function script(name: string, body: string): string {
	const path = join(dir, name);
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'picopilot-vd-proc-'));
	pidDir = join(dir, 'pids');
	mkdirSync(pidDir);
	// The fake X server: record its pid, report display 77 on fd 3, then idle.
	script(
		'Xvfb',
		`echo $$ > "$FAKE_PID_DIR/xvfb.pid"\necho 77 >&3\nexec ${SLEEP} 15`,
	);
	// The fake PICO-8: record its pid and DISPLAY, then behave per FAKE_MODE.
	script(
		'pico8',
		[
			'echo $$ > "$FAKE_PID_DIR/pico8.pid"',
			'echo "$DISPLAY" > "$FAKE_PID_DIR/display"',
			'case "$FAKE_MODE" in',
			`  sentinel) echo ${DONE_SENTINEL}; exec ${SLEEP} 15;;`,
			`  hang) exec ${SLEEP} 15;;`,
			'  crash) exit 3;;',
			'esac',
		].join('\n'),
	);
});

afterEach(() => {
	// If an assertion failed before the run cleaned up, never leave the fake
	// Xvfb / PICO-8 behind (they are `sleep`s, but still strays).
	for (const name of ['xvfb', 'pico8']) {
		const pid = readPid(name);
		if (pid !== undefined && Number.isInteger(pid) && pid > 0) {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				// already gone (the expected case)
			}
		}
	}
	rmSync(dir, {recursive: true, force: true});
});

/** Whether a pid is still alive (signal 0 probes without killing). */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Waits (bounded) for a pid to disappear; the kernel may lag the kill slightly. */
async function gone(pid: number): Promise<boolean> {
	for (let i = 0; i < 100; i++) {
		if (!alive(pid)) return true;
		await new Promise((r) => setTimeout(r, 20));
	}
	return false;
}

function readPid(name: string): number | undefined {
	const p = join(pidDir, `${name}.pid`);
	if (!existsSync(p)) return undefined;
	const pid = Number(readFileSync(p, 'utf8').trim());
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function adapter(mode: string, pico8 = join(dir, 'pico8')) {
	return new ShellPico8Adapter({
		display: 'xvfb',
		env: {
			PATH: `${dir}:/usr/bin:/bin`,
			PICO8_PATH: pico8,
			FAKE_PID_DIR: pidDir,
			FAKE_MODE: mode,
		},
	});
}

describe.skipIf(process.platform === 'win32')(
	'virtual display with real processes: nothing is left behind',
	() => {
		for (const [mode, backstopMs, exitReason] of [
			['sentinel', 10_000, 'sentinel'],
			['hang', 300, 'timeout'],
			['crash', 10_000, 'exit'],
		] as const) {
			it(`${mode}: PICO-8 saw the virtual DISPLAY, and both it and Xvfb are gone`, async () => {
				const result = await adapter(mode).record({
					cartPath: join(dir, 'h.p8'),
					wavDir: dir,
					backstopMs,
				});
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.value.exitReason).toBe(exitReason);
					expect(result.value.display).toBe('Xvfb');
				}
				expect(readFileSync(join(pidDir, 'display'), 'utf8').trim()).toBe(
					':77',
				);
				const xvfb = readPid('xvfb');
				const pico8 = readPid('pico8');
				expect(xvfb).toBeDefined();
				expect(pico8).toBeDefined();
				expect(await gone(xvfb!)).toBe(true);
				expect(await gone(pico8!)).toBe(true);
			});
		}

		it('spawn failure: PICO-8 cannot exec, and Xvfb is still stopped', async () => {
			// Executable, so the pre-flight lookup finds it, but its interpreter does
			// not exist, so the spawn itself fails (ENOENT) after Xvfb is up.
			const broken = join(dir, 'broken-pico8');
			writeFileSync(broken, '#!/nonexistent/interpreter\n');
			chmodSync(broken, 0o755);
			const result = await adapter('sentinel', broken).record({
				cartPath: join(dir, 'h.p8'),
				wavDir: dir,
				backstopMs: 10_000,
			});
			expect(!result.ok && result.reason).toBe('pico8-not-found');
			const xvfb = readPid('xvfb');
			expect(xvfb).toBeDefined();
			expect(await gone(xvfb!)).toBe(true);
		});

		it('picopilot itself killed mid-run (SIGTERM): PICO-8 and Xvfb die with it', async () => {
			// A separate node process runs the record (hanging cart); we SIGTERM it
			// once both children are up, as an agent harness or `timeout` would.
			const tsx = createRequire(import.meta.url).resolve('tsx');
			const shell = new URL('./shell.ts', import.meta.url).pathname;
			const code = `
				const {ShellPico8Adapter} = await import(${JSON.stringify(shell)});
				await new ShellPico8Adapter({display: 'xvfb', env: ${JSON.stringify({
					PATH: `${dir}:/usr/bin:/bin`,
					PICO8_PATH: join(dir, 'pico8'),
					FAKE_PID_DIR: pidDir,
					FAKE_MODE: 'hang',
				})}}).record({cartPath: 'h.p8', wavDir: ${JSON.stringify(dir)}, backstopMs: 60000});
			`;
			const child = spawn(
				process.execPath,
				['--import', tsx, '--input-type=module', '-e', code],
				{stdio: 'ignore'},
			);
			const exited = new Promise((r) => child.on('exit', r));
			try {
				for (let i = 0; i < 250 && readPid('pico8') === undefined; i++) {
					await new Promise((r) => setTimeout(r, 20));
				}
				const xvfb = readPid('xvfb');
				const pico8 = readPid('pico8');
				expect(xvfb).toBeDefined();
				expect(pico8).toBeDefined();
				child.kill('SIGTERM');
				await exited;
				expect(await gone(xvfb!)).toBe(true);
				expect(await gone(pico8!)).toBe(true);
			} finally {
				// Never leave the runner process behind if an assertion failed.
				if (child.exitCode === null && child.signalCode === null) {
					child.kill('SIGKILL');
				}
			}
		}, 15_000);
	},
);
