import {describe, expect, it} from 'vitest';
import {DONE_SENTINEL} from './adapter.js';
import {findSentinel, SentinelWatcher, splitLines} from './sentinel.js';

/**
 * The sentinel-watch core is the load-bearing run logic AND the one piece
 * testable without the paid PICO-8 binary (ADR-0006), so it carries the run's
 * termination guarantees: a cart that prints the sentinel ends the run promptly,
 * and a cart that never signals leaves it to the backstop. These tests drive it
 * with SYNTHETIC stdout, exactly as the shell adapter drives it with real stdout.
 */

describe('splitLines: whole-line splitting with a carried remainder', () => {
	it('splits complete lines and returns the unterminated remainder', () => {
		const {lines, rest} = splitLines('a\nb\nhalf');
		expect(lines).toEqual(['a', 'b']);
		expect(rest).toBe('half');
	});

	it('strips \\r so a sentinel matches regardless of line endings', () => {
		const {lines} = splitLines('done\r\n');
		expect(lines).toEqual(['done']);
	});

	it('an empty chunk yields no lines and an empty remainder', () => {
		expect(splitLines('')).toEqual({lines: [], rest: ''});
	});
});

describe('findSentinel: exact whole-line match', () => {
	it('matches the sentinel on its own line', () => {
		const {matched, index} = findSentinel(['a', DONE_SENTINEL, 'b']);
		expect(matched).toBe(true);
		expect(index).toBe(1);
	});

	it('does NOT match an incidental substring in other output', () => {
		// A line that merely CONTAINS the sentinel text must not trip it.
		const {matched} = findSentinel([`printing ${DONE_SENTINEL} soon`]);
		expect(matched).toBe(false);
	});

	it('reports no match when absent', () => {
		expect(findSentinel(['a', 'b'])).toEqual({matched: false, index: -1});
	});
});

describe('SentinelWatcher: streaming accumulation + prompt match', () => {
	it('matches the sentinel the moment it arrives (kill-on-match)', () => {
		const w = new SentinelWatcher();
		expect(w.push('RUNNING:\n')).toBe(false); // not yet
		expect(w.push(`${DONE_SENTINEL}\n`)).toBe(true); // signal -> kill now
		expect(w.sentinelSeen).toBe(true);
	});

	it('matches a sentinel split ACROSS two chunks (partial-line buffering)', () => {
		const w = new SentinelWatcher();
		expect(w.push('__PICOPILOT')).toBe(false); // half a line, no newline yet
		expect(w.push('_DONE__\n')).toBe(true); // completes the line -> match
	});

	it('never matches when the cart does not signal (backstop territory)', () => {
		const w = new SentinelWatcher();
		w.push('RUNNING:\nx=1\nx=2\n');
		expect(w.sentinelSeen).toBe(false); // caller falls through to the backstop
	});

	it('captures the full stdout text (printh), sentinel line included', () => {
		const w = new SentinelWatcher();
		w.push('score=10\n');
		w.push(`${DONE_SENTINEL}\n`);
		expect(w.text).toContain('score=10');
		expect(w.text).toContain(DONE_SENTINEL);
	});

	it('honours a custom sentinel string', () => {
		const w = new SentinelWatcher('END!');
		expect(w.push('END!\n')).toBe(true);
	});
});
