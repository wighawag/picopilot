import {describe, expect, it} from 'vitest';
import {
	detectVirtualDisplayBackend,
	needsVirtualDisplay,
	resolveDisplayMode,
	startVirtualDisplay,
	type XvfbSpawner,
} from './display.js';
import {FakeXvfb} from './fake-xvfb.test-support.js';

/**
 * The display-mode seam (ADR-0017) is tested WITHOUT a real X server: the
 * resolution + decision tables are pure, and Xvfb is a fake process that the
 * test makes report a display number, exit early, or hang.
 */

describe('resolveDisplayMode: flag > env > config > default', () => {
	const cases: {
		name: string;
		flag?: string;
		env?: string;
		config?: unknown;
		mode: string;
		source: string;
	}[] = [
		{name: 'nothing set', mode: 'auto', source: 'default'},
		{name: 'config only', config: 'native', mode: 'native', source: 'config'},
		{name: 'env only', env: 'xvfb', mode: 'xvfb', source: 'env'},
		{name: 'flag only', flag: 'native', mode: 'native', source: 'flag'},
		{
			name: 'env beats config',
			env: 'xvfb',
			config: 'native',
			mode: 'xvfb',
			source: 'env',
		},
		{
			name: 'flag beats env and config',
			flag: 'auto',
			env: 'xvfb',
			config: 'native',
			mode: 'auto',
			source: 'flag',
		},
		{
			name: 'an empty env value is unset',
			env: '  ',
			config: 'xvfb',
			mode: 'xvfb',
			source: 'config',
		},
	];
	for (const c of cases) {
		it(c.name, () => {
			expect(
				resolveDisplayMode({flag: c.flag, env: c.env, config: c.config}),
			).toEqual({ok: true, mode: c.mode, source: c.source});
		});
	}

	it('reports an unknown value instead of silently falling back', () => {
		expect(resolveDisplayMode({env: 'xfvb', config: 'native'})).toEqual({
			ok: false,
			source: 'env',
			value: 'xfvb',
		});
		expect(resolveDisplayMode({config: 42})).toEqual({
			ok: false,
			source: 'config',
			value: '42',
		});
	});
});

describe('needsVirtualDisplay: the auto decision', () => {
	const table: [string, NodeJS.ProcessEnv, boolean, boolean, boolean][] = [
		// [name, env, auto, xvfb, native]
		['no display at all', {}, true, true, false],
		['X11 DISPLAY set', {DISPLAY: ':0'}, false, true, false],
		['Wayland only', {WAYLAND_DISPLAY: 'wayland-0'}, false, true, false],
		['both set', {DISPLAY: ':0', WAYLAND_DISPLAY: 'w'}, false, true, false],
		['empty DISPLAY counts as none', {DISPLAY: ''}, true, true, false],
	];
	for (const [name, env, auto, xvfb, native] of table) {
		it(name, () => {
			expect(needsVirtualDisplay('auto', env)).toBe(auto);
			expect(needsVirtualDisplay('xvfb', env)).toBe(xvfb);
			expect(needsVirtualDisplay('native', env)).toBe(native);
		});
	}
});

describe('detectVirtualDisplayBackend', () => {
	it('prefers Xvfb over xvfb-run, and reports none when neither exists', () => {
		const has =
			(...names: string[]) =>
			(n: string) =>
				names.includes(n) ? `/bin/${n}` : undefined;
		expect(detectVirtualDisplayBackend({}, has('Xvfb', 'xvfb-run'))).toBe(
			'Xvfb',
		);
		expect(detectVirtualDisplayBackend({}, has('xvfb-run'))).toBe('xvfb-run');
		expect(detectVirtualDisplayBackend({}, has())).toBeUndefined();
	});
});

const onlyXvfb = (n: string) => (n === 'Xvfb' ? '/fake/Xvfb' : undefined);

describe('startVirtualDisplay: direct Xvfb with -displayfd', () => {
	it('spawns Xvfb -displayfd and sets DISPLAY to the number it reports', async () => {
		const xvfb = new FakeXvfb();
		let spawned: {file: string; args: string[]} | undefined;
		const spawnXvfb: XvfbSpawner = (file, args) => {
			spawned = {file, args};
			setImmediate(() => xvfb.reportDisplay(37));
			return xvfb;
		};
		const started = await startVirtualDisplay({}, {find: onlyXvfb, spawnXvfb});
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		expect(spawned?.file).toBe('/fake/Xvfb');
		expect(spawned?.args).toContain('-displayfd');
		// No fixed display number: the server picks one (no races between runs).
		expect(spawned?.args.some((a) => /^:\d+$/.test(a))).toBe(false);
		expect(started.display.backend).toBe('Xvfb');
		expect(started.display.env).toEqual({DISPLAY: ':37'});
		expect(started.display.wrap('pico8', ['-run', 'c.p8'])).toEqual({
			file: 'pico8',
			args: ['-run', 'c.p8'],
		});
		await started.display.stop();
		expect(xvfb.signals).toContain('SIGTERM');
		expect(xvfb.exited).toBe(true);
	});

	it('escalates to SIGKILL when Xvfb ignores SIGTERM', async () => {
		const xvfb = new FakeXvfb();
		xvfb.exitOnTerm = false;
		const started = await startVirtualDisplay(
			{},
			{
				find: onlyXvfb,
				stopGraceMs: 10,
				spawnXvfb: () => {
					setImmediate(() => xvfb.reportDisplay(1));
					return xvfb;
				},
			},
		);
		if (!started.ok) throw new Error('expected a display');
		await started.display.stop();
		expect(xvfb.signals).toEqual(['SIGTERM', 'SIGKILL']);
		expect(xvfb.exited).toBe(true);
	});

	it('is display-unavailable (with stderr) when Xvfb exits before reporting', async () => {
		const xvfb = new FakeXvfb();
		const started = await startVirtualDisplay(
			{},
			{
				find: onlyXvfb,
				spawnXvfb: () => {
					setImmediate(() => {
						xvfb.writeStderr('Fatal server error: no screens\n');
						xvfb.exit(1);
					});
					return xvfb;
				},
			},
		);
		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.reason).toBe('display-unavailable');
		expect(started.detail).toContain('no screens');
	});

	it('kills Xvfb and is display-unavailable when it never reports a display', async () => {
		const xvfb = new FakeXvfb();
		const started = await startVirtualDisplay(
			{},
			{find: onlyXvfb, startTimeoutMs: 20, spawnXvfb: () => xvfb},
		);
		expect(started.ok).toBe(false);
		expect(xvfb.exited).toBe(true); // never left behind
	});
});

describe('startVirtualDisplay: xvfb-run fallback and absence', () => {
	it('wraps the command in xvfb-run -a when only xvfb-run exists', async () => {
		const started = await startVirtualDisplay(
			{},
			{find: (n) => (n === 'xvfb-run' ? '/fake/xvfb-run' : undefined)},
		);
		if (!started.ok) throw new Error('expected xvfb-run');
		expect(started.display.backend).toBe('xvfb-run');
		const w = started.display.wrap('pico8', ['-run', 'c.p8']);
		expect(w.file).toBe('/fake/xvfb-run');
		expect(w.args[0]).toBe('-a');
		expect(w.args.slice(-3)).toEqual(['pico8', '-run', 'c.p8']);
	});

	it('is display-unavailable with a remedy naming Xvfb when nothing is installed', async () => {
		const started = await startVirtualDisplay({}, {find: () => undefined});
		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.reason).toBe('display-unavailable');
		expect(started.remedy).toMatch(/Xvfb/);
		expect(started.remedy).toMatch(/desktop/);
	});
});
