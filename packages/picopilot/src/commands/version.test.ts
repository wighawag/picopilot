import {describe, expect, it} from 'vitest';
import {createCli} from '../cli.js';
import {VERSION} from '../version.js';

/**
 * Drives the CLI end-to-end through incur's `serve(argv, { stdout, exit })` DI,
 * capturing output and the exit code without touching the real process.
 */
async function run(argv: string[]) {
	let stdout = '';
	let exitCode = 0;
	await createCli().serve(argv, {
		stdout(s) {
			stdout += s;
		},
		exit(code) {
			exitCode = code;
		},
	});
	return {stdout, exitCode};
}

describe('picopilot version', () => {
	it('runs end-to-end and reports the package version, exit 0', async () => {
		const {stdout, exitCode} = await run(['version']);
		expect(exitCode).toBe(0);
		expect(stdout).toContain(VERSION);
		expect(stdout).toContain('picopilot');
	});

	it('emits TOON by default (unquoted key: value, not JSON braces)', async () => {
		const {stdout} = await run(['version']);
		// TOON renders `name: picopilot`, never the JSON `"name": "picopilot"`.
		expect(stdout).toContain(`version: ${VERSION}`);
		expect(stdout).not.toContain('"version"');
		expect(stdout.trimStart().startsWith('{')).toBe(false);
	});

	it('emits parseable JSON under --json', async () => {
		const {stdout, exitCode} = await run(['version', '--json']);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed).toEqual({name: 'picopilot', version: VERSION});
	});
});

describe('picopilot CLI surface', () => {
	it('--help lists the incur agent-discovery built-ins', async () => {
		const {stdout} = await run(['--help']);
		// incur renders `skills add` / `mcp add` as grouped integrations.
		expect(stdout).toMatch(/skills\s+Sync skill files to agents/);
		expect(stdout).toMatch(/mcp\s+Register as MCP server/);
		expect(stdout).toContain('--format');
		expect(stdout).toContain('--llms');
		expect(stdout).toContain('--mcp');
	});

	it('exposes `skills add` and `mcp add` as real subcommands', async () => {
		const skills = await run(['skills', '--help']);
		expect(skills.stdout).toMatch(/\badd\b/);
		const mcp = await run(['mcp', '--help']);
		expect(mcp.stdout).toMatch(/\badd\b/);
	});

	it('--llms emits a machine-readable manifest that includes version', async () => {
		const {stdout, exitCode} = await run(['--llms']);
		expect(exitCode).toBe(0);
		expect(stdout).toContain('version');
	});
});
