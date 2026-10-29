import {describe, expect, it} from 'vitest';

import {AudioMmlError, mmlToSfxRow} from './sfx.js';
import {
	EMPTY_SFX_ROW,
	formatSlots,
	isFreeSfxRow,
	musicSfxRefs,
	parseSlotList,
	planScore,
	readScore,
	type ScoreCartState,
	ScoreError,
} from './score.js';

/** An empty cart: no SFX, no music. */
const EMPTY: ScoreCartState = {sfxRows: [], musicRefs: new Set()};

/** The 4 channel bytes + flag byte of each `__music__` row. */
function musicRows(section: string) {
	return section
		.trim()
		.split('\n')
		.map((line) => {
			const [flags, ch] = line.split(' ');
			return {
				flags: Number.parseInt(flags!, 16),
				channels: [0, 1, 2, 3].map((c) => {
					const b = Number.parseInt(ch!.slice(c * 2, c * 2 + 2), 16);
					return b & 0x40 ? null : b;
				}),
			};
		});
}

/** Decoded volume of row `r` of an `__sfx__` row. */
function vol(row: string, r: number): number {
	return Number.parseInt(row[8 + r * 5 + 3]!, 16);
}

/** Expects `fn` to throw a ScoreError with `code`. */
function expectScoreError(fn: () => unknown, code: string) {
	let err: unknown;
	try {
		fn();
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(ScoreError);
	expect((err as ScoreError).code).toBe(code);
	return err as ScoreError;
}

describe('readScore', () => {
	it('accepts {songs:[...]} and a single song shorthand', () => {
		expect(readScore({songs: [{channels: ['c']}]}).songs).toHaveLength(1);
		expect(readScore({channels: ['c']}).songs).toHaveLength(1);
	});

	it('refuses malformed shapes', () => {
		expectScoreError(() => readScore([]), 'audio-score-parse-error');
		expectScoreError(() => readScore({}), 'audio-score-parse-error');
		expectScoreError(() => readScore({songs: []}), 'audio-score-empty');
		expectScoreError(
			() => readScore({songs: [{channels: [3]}]}),
			'audio-score-parse-error',
		);
	});
});

describe('planScore: splitting channels of any length into aligned patterns', () => {
	it('cuts a 64-row melody into 2 SFX and 2 patterns', () => {
		const plan = planScore(
			readScore({channels: ['l8 c d e f g a b > c', 'o1 l32 c c']}),
			EMPTY,
		);
		expect(plan.patterns).toBe(2);
		const rows = musicRows(plan.musicSection);
		expect(rows[0]!.channels.slice(2)).toEqual([null, null]);
		// 3 distinct SFX: two melody halves + one bass bar used twice (deduped).
		expect(plan.slots).toHaveLength(3);
		expect(rows[0]!.channels[1]).toBe(rows[1]!.channels[1]);
		expect(rows[0]!.channels[0]).not.toBe(rows[1]!.channels[0]);
	});

	it('a channel silent for a whole pattern is null (off), not a silent SFX', () => {
		const plan = planScore(
			readScore({channels: ['c32 r32 d32', 'l96 e']}),
			EMPTY,
		);
		const rows = musicRows(plan.musicSection);
		expect(rows.map((r) => r.channels[0] === null)).toEqual([
			false,
			true,
			false,
		]);
		expect(rows.every((r) => r.channels[1] !== null)).toBe(true);
	});

	it('a pattern silent on every channel keeps one silent SFX on ch0 (it must last)', () => {
		const plan = planScore(readScore({channels: ['c32 r32 c32']}), EMPTY);
		const rows = musicRows(plan.musicSection);
		expect(rows[1]!.channels[0]).not.toBeNull();
		const rest = plan.slots.find((s) => s.slot === rows[1]!.channels[0])!;
		expect(rest.uses[0]).toContain('rest');
		expect(isFreeSfxRow(rest.row)).toBe(true);
	});

	it('pads a short channel and a ragged song end, with warnings', () => {
		const plan = planScore(readScore({channels: ['c40', 'd8']}), EMPTY);
		expect(plan.patterns).toBe(2);
		expect(plan.warnings.join('\n')).toMatch(/not a multiple of 32/);
		expect(plan.warnings.join('\n')).toMatch(/channel 1 is 8 rows/);
	});

	it('every SFX carries the song speed and the channel filters', () => {
		const plan = planScore(
			readScore({
				songs: [
					{
						speed: 20,
						channels: [{mml: 'c32', filters: '!dampen'}, '!reverb d32'],
					},
				],
			}),
			EMPTY,
		);
		const headers = plan.slots.map((s) => s.row.slice(0, 8)).sort();
		expect(headers).toEqual(['20140000', '80140000']);
	});

	it('patternRows < 32 writes the LEN header on every SFX (e.g. 3/4 bars)', () => {
		const plan = planScore(
			readScore({songs: [{patternRows: 24, channels: ['c48']}]}),
			EMPTY,
		);
		expect(plan.patterns).toBe(2);
		expect(plan.slots[0]!.row.slice(0, 8)).toBe('00101800'); // LEN 24
		expect(plan.songs[0]!.seconds).toBeCloseTo((48 * 16) / 120);
	});

	it('held-note shaping crosses a pattern boundary (the fade spans both SFX)', () => {
		const plan = planScore(readScore({channels: ['r28 v4 e5 c8']}), EMPTY);
		const [a, b] = musicRows(plan.musicSection).map(
			(r) => plan.slots.find((s) => s.slot === r.channels[0])!.row,
		);
		expect([28, 29, 30, 31].map((r) => vol(a!, r))).toEqual([4, 4, 3, 3]);
		expect([0, 1, 2, 3].map((r) => vol(b!, r))).toEqual([2, 2, 1, 1]);
	});
});

describe('planScore: songs (sections) and loop flags', () => {
	it('lays songs back to back and reports each start pattern', () => {
		const plan = planScore(
			readScore({
				songs: [
					{name: 'title', channels: ['c64']},
					{name: 'game', channels: ['d96'], loopFrom: 1},
					{name: 'jingle', loop: false, channels: ['l32 e']},
				],
			}),
			EMPTY,
		);
		expect(plan.songs.map((s) => [s.name, s.startPattern, s.patterns])).toEqual(
			[
				['title', 0, 2],
				['game', 2, 3],
				['jingle', 5, 1],
			],
		);
		const flags = musicRows(plan.musicSection).map((r) => r.flags);
		// title: loopStart@0, loopBack@1; game: loopStart@3 (loopFrom 1), loopBack@4;
		// jingle: stop@5.
		expect(flags).toEqual([1, 2, 0, 1, 2, 4]);
		expect(plan.songs[1]!.loopStartPattern).toBe(3);
	});

	it('refuses a bad loopFrom, channel count, speed or loop marker', () => {
		expectScoreError(
			() => planScore(readScore({channels: ['c32'], loopFrom: 1}), EMPTY),
			'audio-score-bad-loop-from',
		);
		expectScoreError(
			() => planScore(readScore({channels: ['c', 'c', 'c', 'c', 'c']}), EMPTY),
			'audio-score-bad-channel-count',
		);
		expectScoreError(
			() => planScore(readScore({speed: 12, channels: ['s10 c']}), EMPTY),
			'audio-score-speed-mismatch',
		);
		expectScoreError(
			() => planScore(readScore({channels: ['s10 c', 's11 c']}), EMPTY),
			'audio-score-speed-mismatch',
		);
		expectScoreError(
			() => planScore(readScore({channels: ['{c d}']}), EMPTY),
			'audio-score-loop-marker',
		);
		expectScoreError(
			() => planScore(readScore({channels: ['c'], patternRows: 33}), EMPTY),
			'audio-score-bad-pattern-rows',
		);
	});

	it('a shared s<N> in the channels is the song speed', () => {
		const plan = planScore(readScore({channels: ['s9 c', 's9 d']}), EMPTY);
		expect(plan.songs[0]!.speed).toBe(9);
	});

	it('an MML error names the song and channel', () => {
		let err: unknown;
		try {
			planScore(
				readScore({songs: [{name: 'title', channels: ['c', 'o5 g']}]}),
				EMPTY,
			);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(AudioMmlError);
		expect((err as AudioMmlError).code).toBe('audio-mml-pitch-out-of-range');
		expect((err as AudioMmlError).message).toMatch(/^song 'title' channel 1:/);
	});

	it('refuses more than 64 patterns', () => {
		expectScoreError(
			() => planScore(readScore({channels: ['c32 '.repeat(65)]}), EMPTY),
			'audio-score-too-many-patterns',
		);
	});
});

describe('planScore: slot allocation', () => {
	const gameSfx = mmlToSfxRow('s4 @3 v6 c e g').row;

	it('without a range: free slots only, from 63 down, never touching content', () => {
		const sfxRows: (string | undefined)[] = [];
		sfxRows[63] = gameSfx; // a game SFX up top
		sfxRows[62] = mmlToSfxRow('').row; // empty body = free
		const plan = planScore(readScore({channels: ['c32 d32']}), {
			sfxRows,
			musicRefs: new Set(),
		});
		expect(plan.slots.map((s) => s.slot)).toEqual([61, 62]);
		expect(plan.slots.every((s) => !s.overwrote)).toBe(true);
		expect(plan.cleared).toEqual([]);
	});

	it('refuses when there are not enough free slots, pointing at --slots', () => {
		const sfxRows = new Array(64).fill(gameSfx);
		sfxRows[10] = undefined;
		const err = expectScoreError(
			() =>
				planScore(readScore({channels: ['c32 d32']}), {
					sfxRows,
					musicRefs: new Set(),
				}),
			'audio-score-no-free-slots',
		);
		expect(err.message).toContain('--slots');
	});

	it('with a range: owns it (overwrites, clears unused), never touches outside', () => {
		const sfxRows: (string | undefined)[] = [];
		for (let s = 0; s < 64; s++) sfxRows[s] = gameSfx;
		const plan = planScore(
			readScore({channels: ['c32']}),
			{
				sfxRows,
				musicRefs: new Set(),
			},
			{slots: {from: 40, to: 42}},
		);
		expect(plan.slots.map((s) => [s.slot, s.overwrote])).toEqual([[40, true]]);
		expect(plan.cleared).toEqual([41, 42]);
	});

	it('re-running an unchanged score keeps every SFX in its slot', () => {
		const score = readScore({channels: ['c32 d32 l32 e', 'o1 c96']});
		const first = planScore(score, EMPTY, {slots: {from: 20, to: 30}});
		const sfxRows: (string | undefined)[] = [];
		for (const s of first.slots) sfxRows[s.slot] = s.row;
		const second = planScore(
			score,
			{sfxRows, musicRefs: new Set()},
			{slots: {from: 20, to: 30}},
		);
		expect(second.slots).toEqual(
			first.slots.map((s) => ({...s, overwrote: false})),
		);
		expect(second.musicSection).toBe(first.musicSection);
	});

	it('warns about slots the previous __music__ used that are now orphaned', () => {
		const sfxRows: (string | undefined)[] = [];
		sfxRows[5] = gameSfx;
		const plan = planScore(readScore({channels: ['c32']}), {
			sfxRows,
			musicRefs: new Set([5]),
		});
		expect(plan.warnings.join('\n')).toMatch(
			/SFX 5 were used by the previous __music__/,
		);
	});

	it('custom instruments (@8-@f) keep the allocator out of slots 0-7', () => {
		const sfxRows = new Array(64).fill(gameSfx);
		for (let s = 0; s < 8; s++) sfxRows[s] = undefined;
		expectScoreError(
			() =>
				planScore(readScore({channels: ['@8 c32']}), {
					sfxRows,
					musicRefs: new Set(),
				}),
			'audio-score-no-free-slots',
		);
	});

	it('refuses a bad slot range', () => {
		expectScoreError(
			() =>
				planScore(readScore({channels: ['c']}), EMPTY, {
					slots: {from: 10, to: 64},
				}),
			'audio-score-bad-slot-range',
		);
	});
});

describe('slot helpers', () => {
	it('parseSlotList / formatSlots round-trip', () => {
		expect(parseSlotList('3,5,16-18')).toEqual([3, 5, 16, 17, 18]);
		expect(parseSlotList('64')).toBeUndefined();
		expect(parseSlotList('5-3')).toBeUndefined();
		expect(parseSlotList('x')).toBeUndefined();
		expect(formatSlots([18, 3, 16, 17, 5])).toBe('3,5,16-18');
	});

	it('musicSfxRefs reads the referenced slots, skipping off channels', () => {
		expect(
			[...musicSfxRefs('01 10114040\n02 12134041\n')].sort((a, b) => a - b),
		).toEqual([16, 17, 18, 19]);
	});

	it('EMPTY_SFX_ROW is free', () => {
		expect(isFreeSfxRow(EMPTY_SFX_ROW)).toBe(true);
	});
});

describe('planScore: review fixes', () => {
	it('without a range, re-running an unchanged score reuses its own slots (no leak)', () => {
		const score = readScore({channels: ['c32 d32', 'o1 c64']});
		const first = planScore(score, EMPTY);
		const sfxRows: (string | undefined)[] = [];
		for (const s of first.slots) sfxRows[s.slot] = s.row;
		const musicRefs = musicSfxRefs(first.musicSection);
		const second = planScore(score, {sfxRows, musicRefs});
		expect(second.slots.map((s) => s.slot)).toEqual(
			first.slots.map((s) => s.slot),
		);
		expect(second.musicSection).toBe(first.musicSection);
		expect(second.warnings).toEqual([]);
	});

	it('a full cart still re-runs an unchanged score (its rows are already there)', () => {
		const score = readScore({channels: ['c32']});
		const first = planScore(score, EMPTY);
		const filler = mmlToSfxRow('s4 @3 v6 c e g').row;
		const sfxRows = new Array(64).fill(filler);
		sfxRows[first.slots[0]!.slot] = first.slots[0]!.row;
		const again = planScore(score, {sfxRows, musicRefs: new Set()});
		expect(again.slots[0]!.slot).toBe(first.slots[0]!.slot);
	});

	it('"filters" only takes ! directives, and "loop" must be a boolean', () => {
		expectScoreError(
			() => readScore({channels: [{mml: 'c', filters: '@3 v1'}]}),
			'audio-score-parse-error',
		);
		expect(
			readScore({channels: [{mml: 'c', filters: '!dampen2 !reverb'}]}).songs,
		).toHaveLength(1);
		expectScoreError(
			() => readScore({channels: ['c'], loop: 'false'}),
			'audio-score-parse-error',
		);
	});

	it('a range only reports slots with notes as cleared', () => {
		const sfxRows: (string | undefined)[] = [];
		sfxRows[41] = mmlToSfxRow('').row; // header only: already empty
		sfxRows[42] = mmlToSfxRow('s4 c').row;
		const plan = planScore(
			readScore({channels: ['c32']}),
			{sfxRows, musicRefs: new Set()},
			{
				slots: {from: 40, to: 42},
			},
		);
		expect(plan.cleared).toEqual([42]);
	});
});
