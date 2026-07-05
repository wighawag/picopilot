import {describe, expect, it} from 'vitest';

import {
	MUSIC_PATTERN_MAX,
	MusicError,
	type Pattern,
	patternsToMusic,
} from './music.js';

/**
 * Table-driven codec tests: a known pattern list -> a known `__music__` row,
 * asserted BYTE-FOR-BYTE against the finding's Part A.5 (`FF CCCCCCCC` = a 2-hex
 * flag byte + space + 4 channel bytes; flag bits loop-start=0x01, loop-back=0x02,
 * stop=0x04, combinable; channel byte = sfx 0..63, bit6=0x40 = off).
 */
describe('patternsToMusic: one pattern -> one FF CCCCCCCC row (finding A.5)', () => {
	const cases: Array<{name: string; pattern: Pattern; row: string}> = [
		{
			name: 'a plain 4-channel pattern (no flags, no off) -> flag 00',
			pattern: {channels: [0, 1, 2, 3]},
			row: '00 00010203',
		},
		{
			name: 'loop-start alone -> flag 01',
			pattern: {channels: [0, 0, 0, 0], loopStart: true},
			row: '01 00000000',
		},
		{
			name: 'loop-back alone -> flag 02 (with a loop-start elsewhere, no warn)',
			// A lone loopBack would warn; here we test the FLAG BYTE in isolation.
			pattern: {channels: [1, 1, 1, 1], loopBack: true},
			row: '02 01010101',
		},
		{
			name: 'stop alone -> flag 04',
			pattern: {channels: [5, 6, 7, 8], stop: true},
			row: '04 05060708',
		},
		{
			name: 'combined loop-start + stop -> flag 05 (0x01 | 0x04)',
			pattern: {channels: [0, 0, 0, 0], loopStart: true, stop: true},
			row: '05 00000000',
		},
		{
			name: 'all three flags -> flag 07 (0x01 | 0x02 | 0x04)',
			pattern: {
				channels: [0, 0, 0, 0],
				loopStart: true,
				loopBack: true,
				stop: true,
			},
			row: '07 00000000',
		},
		{
			name: 'an off channel sets bit6 -> byte 40 (finding A.5: null = bare 0x40)',
			pattern: {channels: [null, 1, 2, 3]},
			row: '00 40010203',
		},
		{
			name: 'the finding\u2019s verified 0x40|17 = 51 example (off + sfx 17)... but null carries no index, so a null ch0 is 40',
			pattern: {channels: [null, null, null, null]},
			row: '00 40404040',
		},
		{
			name: 'max SFX index 63 -> byte 3f',
			pattern: {channels: [63, 63, 63, 63]},
			row: '00 3f3f3f3f',
		},
	];

	for (const {name, pattern, row} of cases) {
		it(name, () => {
			const result = patternsToMusic([pattern]);
			expect(result.section).toBe(`${row}\n`);
			expect(result.patterns).toBe(1);
		});
	}
});

describe('patternsToMusic: "off" is NOT "sfx 0" (finding B.6 / B.7 #9)', () => {
	it('sfx 0 -> byte 00 (a real, playing SFX)', () => {
		expect(patternsToMusic([{channels: [0, 1, 2, 3]}]).section).toBe(
			'00 00010203\n',
		);
	});

	it('off -> byte 40 (bit6 set, silent), DISTINCT from sfx 0', () => {
		expect(patternsToMusic([{channels: [null, 1, 2, 3]}]).section).toBe(
			'00 40010203\n',
		);
	});

	it('the two are different bytes for the same channel position', () => {
		const sfx0 = patternsToMusic([{channels: [0, 0, 0, 0]}]).section;
		const off = patternsToMusic([{channels: [null, null, null, null]}]).section;
		expect(sfx0).toBe('00 00000000\n');
		expect(off).toBe('00 40404040\n');
		expect(sfx0).not.toBe(off);
	});
});

describe('patternsToMusic: multiple patterns are song order (finding A.5/B.6)', () => {
	it('emits one row per pattern, top to bottom = song order', () => {
		const result = patternsToMusic([
			{channels: [0, 1, 2, 3], loopStart: true},
			{channels: [4, 5, null, 6]},
			{channels: [0, 0, 0, 0], loopBack: true, stop: true},
		]);
		expect(result.section).toBe(
			['01 00010203', '00 04054006', '06 00000000'].join('\n') + '\n',
		);
		expect(result.patterns).toBe(3);
	});
});

describe('patternsToMusic: loop-back without loop-start WARNS, not errors (finding B.6)', () => {
	it('a lone loopBack (no loopStart anywhere) warns about the pattern-0 fall-back', () => {
		const result = patternsToMusic([
			{channels: [0, 0, 0, 0]},
			{channels: [1, 1, 1, 1], loopBack: true},
		]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]!.code).toBe('loop-back-without-loop-start');
		expect(result.warnings[0]!.message).toContain('pattern 0');
		// It still emits (does NOT hard-fail).
		expect(result.patterns).toBe(2);
	});

	it('a loopBack WITH a loopStart somewhere does NOT warn', () => {
		const result = patternsToMusic([
			{channels: [0, 0, 0, 0], loopStart: true},
			{channels: [1, 1, 1, 1], loopBack: true},
		]);
		expect(result.warnings).toHaveLength(0);
	});
});

describe('patternsToMusic: out-of-range + malformed refusals (NO silent clamp)', () => {
	it('an SFX index > 63 -> audio-music-sfx-out-of-range', () => {
		try {
			patternsToMusic([{channels: [64, 0, 0, 0]}]);
			expect.fail('expected a MusicError');
		} catch (e) {
			expect(e).toBeInstanceOf(MusicError);
			expect((e as MusicError).code).toBe('audio-music-sfx-out-of-range');
		}
	});

	it('a negative SFX index -> audio-music-sfx-out-of-range', () => {
		expect(() => patternsToMusic([{channels: [-1, 0, 0, 0]}])).toThrow(
			MusicError,
		);
	});

	it('the wrong channel count -> audio-music-bad-channel-count', () => {
		try {
			// Deliberately malformed (3 channels) via a cast, mirroring how a
			// hand-authored JSON payload could arrive.
			patternsToMusic([
				{channels: [0, 1, 2] as unknown as Pattern['channels']},
			]);
			expect.fail('expected a MusicError');
		} catch (e) {
			expect((e as MusicError).code).toBe('audio-music-bad-channel-count');
		}
	});

	it('an empty list -> audio-music-empty', () => {
		try {
			patternsToMusic([]);
			expect.fail('expected a MusicError');
		} catch (e) {
			expect((e as MusicError).code).toBe('audio-music-empty');
		}
	});

	it('more than 64 patterns -> audio-music-too-many-patterns', () => {
		const many: Pattern[] = Array.from({length: MUSIC_PATTERN_MAX + 1}, () => ({
			channels: [0, 0, 0, 0] as Pattern['channels'],
		}));
		try {
			patternsToMusic(many);
			expect.fail('expected a MusicError');
		} catch (e) {
			expect((e as MusicError).code).toBe('audio-music-too-many-patterns');
		}
	});
});
