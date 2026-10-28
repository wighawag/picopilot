import {afterEach, describe, expect, it} from 'vitest';
import {killOnAbort} from './cleanup.js';

/** The kill-on-abort registry: one listener per event, however many runs. */
describe('killOnAbort', () => {
	const disposers: (() => void)[] = [];
	afterEach(() => {
		for (const d of disposers.splice(0)) d();
	});

	it('many concurrent runs add ONE listener per signal, removed when all end', () => {
		const before = process.listenerCount('SIGTERM');
		for (let i = 0; i < 20; i++) disposers.push(killOnAbort(() => {}));
		expect(process.listenerCount('SIGTERM')).toBe(before + 1);
		expect(process.listenerCount('exit')).toBeGreaterThan(0);
		for (const d of disposers.splice(0)) d();
		expect(process.listenerCount('SIGTERM')).toBe(before);
	});

	it('kills every pending run on exit, and a disposed run is not killed', () => {
		const killed: number[] = [];
		const d1 = killOnAbort(() => killed.push(1));
		disposers.push(killOnAbort(() => killed.push(2)));
		d1();
		process.emit('exit', 0);
		expect(killed).toEqual([2]);
	});
});
