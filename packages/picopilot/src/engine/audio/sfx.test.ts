import {describe, expect, it} from 'vitest';

import {AudioMmlError, mmlToSfxRow, SFX_ROW_LENGTH} from './sfx.js';

/** The 8-char header of a row (mode/speed/loopstart/loopend). */
function header(row: string): string {
	return row.slice(0, 8);
}

/** The 5-hex-char note at row index `r` (0..31). */
function note(row: string, r: number): string {
	return row.slice(8 + r * 5, 8 + r * 5 + 5);
}

/** The empty (all-zero) SFX body tail: 32 notes of `00000`. */
const EMPTY_NOTES = '00000'.repeat(32);

describe('mmlToSfxRow: row shape (finding A.1)', () => {
	it('always emits exactly 168 hex chars (8 header + 32 notes x 5)', () => {
		const {row} = mmlToSfxRow('c');
		expect(row).toHaveLength(SFX_ROW_LENGTH);
	});

	it('an empty MML string is a valid all-zero SFX at the default speed', () => {
		const {row} = mmlToSfxRow('');
		// mode 0, speed 16 (0x10), loopstart 0, loopend 0.
		expect(header(row)).toBe('00100000');
		expect(row.slice(8)).toBe(EMPTY_NOTES);
	});
});

describe('mmlToSfxRow: header (finding A.1, B.5)', () => {
	it('s<N> sets speed (ticks/row); default is 16', () => {
		expect(header(mmlToSfxRow('c').row)).toBe('00100000'); // default s16
		expect(header(mmlToSfxRow('s1 c').row)).toBe('00010000');
		expect(header(mmlToSfxRow('s255 c').row)).toBe('00ff0000');
	});

	it('rejects an out-of-range speed', () => {
		expect(() => mmlToSfxRow('s0 c')).toThrow(AudioMmlError);
		expect(() => mmlToSfxRow('s256 c')).toThrow(AudioMmlError);
	});
});

describe('mmlToSfxRow: pitch + octave (finding A.2, B.2)', () => {
	// pitch = 12*oct + semitone; c=0,d=2,e=4,f=5,g=7,a=9,b=11; default o2.
	it('default octave is o2 (c2 = pitch 24 = 0x18)', () => {
		expect(note(mmlToSfxRow('c').row, 0)).toBe('18070'); // pitch 0x18, wave0, vol7, eff0
	});

	it('c0 = pitch 0, c5 = pitch 60 (0x3c)', () => {
		expect(note(mmlToSfxRow('o0 c').row, 0).slice(0, 2)).toBe('00');
		expect(note(mmlToSfxRow('o5 c').row, 0).slice(0, 2)).toBe('3c');
	});

	it('d#5 = pitch 63 = 0x3f (the top of the range)', () => {
		expect(note(mmlToSfxRow('o5 d#').row, 0).slice(0, 2)).toBe('3f');
	});

	it('semitone table + sharps/flats', () => {
		// o0: c=0,d=2,e=4,f=5,g=7,a=9,b=11
		expect(note(mmlToSfxRow('o0 c').row, 0).slice(0, 2)).toBe('00');
		expect(note(mmlToSfxRow('o0 d').row, 0).slice(0, 2)).toBe('02');
		expect(note(mmlToSfxRow('o0 e').row, 0).slice(0, 2)).toBe('04');
		expect(note(mmlToSfxRow('o0 g').row, 0).slice(0, 2)).toBe('07');
		expect(note(mmlToSfxRow('o0 b').row, 0).slice(0, 2)).toBe('0b');
		// c+ / c# = 1, d- = 1.
		expect(note(mmlToSfxRow('o0 c#').row, 0).slice(0, 2)).toBe('01');
		expect(note(mmlToSfxRow('o0 c+').row, 0).slice(0, 2)).toBe('01');
		expect(note(mmlToSfxRow('o0 d-').row, 0).slice(0, 2)).toBe('01');
	});

	it('note E disambiguation: e<digit> is effect, bare e is note E (ADR-0008)', () => {
		// e = note E (o2 e = 24+4 = 28 = 0x1c); e4 = effect 4 (not note E length 4).
		expect(note(mmlToSfxRow('e').row, 0).slice(0, 2)).toBe('1c');
		expect(note(mmlToSfxRow('e4 c').row, 0).slice(4, 5)).toBe('4'); // effect on c
		// A held note E is written l4 e (default length), since e4 is taken by effect.
		expect(mmlToSfxRow('l4 e').rows).toBe(4);
	});

	it('>/< shift the octave modally', () => {
		// o2 c = 24; > then c = 36 (0x24); < < then c = 12 (0x0c).
		const row = mmlToSfxRow('c > c < < c').row;
		expect(note(row, 0).slice(0, 2)).toBe('18'); // 24
		expect(note(row, 1).slice(0, 2)).toBe('24'); // 36
		expect(note(row, 2).slice(0, 2)).toBe('0c'); // 12
	});
});

describe('mmlToSfxRow: waveform / instrument (finding A.2, B.1)', () => {
	it('@0..@7 select the 8 built-in waveforms', () => {
		for (let w = 0; w <= 7; w++) {
			const row = mmlToSfxRow(`@${w} c`).row;
			expect(note(row, 0)).toBe(`18${w}70`); // pitch18, wave w, vol7, eff0
		}
	});

	it('@8..@f select custom SFX-instruments (bit 3 set)', () => {
		expect(note(mmlToSfxRow('@8 c').row, 0)).toBe('18870');
		// @d = 13 = custom SFX-instrument 5 (finding: waveform 12 -> `00d00`).
		expect(note(mmlToSfxRow('@d c').row, 0)).toBe('18d70');
		expect(note(mmlToSfxRow('@f c').row, 0)).toBe('18f70');
	});

	it('waveform is modal (sticks until changed)', () => {
		const row = mmlToSfxRow('@3 c c @5 c').row;
		expect(note(row, 0).slice(2, 3)).toBe('3');
		expect(note(row, 1).slice(2, 3)).toBe('3');
		expect(note(row, 2).slice(2, 3)).toBe('5');
	});
});

describe('mmlToSfxRow: volume (finding A.2)', () => {
	it('v0..v7 set the volume nibble; v is modal', () => {
		expect(note(mmlToSfxRow('v0 c').row, 0)).toBe('18000'); // vol 0 = silent
		expect(note(mmlToSfxRow('v7 c').row, 0)).toBe('18070');
		const row = mmlToSfxRow('v3 c c v6 c').row;
		expect(note(row, 0).slice(3, 4)).toBe('3');
		expect(note(row, 1).slice(3, 4)).toBe('3');
		expect(note(row, 2).slice(3, 4)).toBe('6');
	});
});

describe('mmlToSfxRow: effects (finding A.4, B.3)', () => {
	it('e0..e7 set the effect nibble', () => {
		for (let e = 0; e <= 7; e++) {
			const row = mmlToSfxRow(`e${e} c`).row;
			expect(note(row, 0)).toBe(`1807${e}`);
		}
	});

	it('all 8 effects are reachable via the canonical e0..e7 (the only effect form)', () => {
		expect(note(mmlToSfxRow('e6 c').row, 0).slice(4, 5)).toBe('6'); // arpeggio fast
		expect(note(mmlToSfxRow('e7 c').row, 0).slice(4, 5)).toBe('7'); // arpeggio slow
	});

	it('two-letter mnemonics are NOT shipped: a4/a8 are note A, dr is note D + rest (ADR-0008)', () => {
		// a4 = note A held 4 rows (default o2 a = 33 = 0x21), NOT arpeggio.
		const a4 = mmlToSfxRow('a4');
		expect(a4.rows).toBe(4);
		expect(note(a4.row, 0).slice(0, 2)).toBe('21');
		// dr = note D then rest, NOT the drop effect.
		const dr = mmlToSfxRow('dr');
		expect(dr.rows).toBe(2);
		expect(note(dr.row, 0).slice(0, 2)).toBe('1a'); // note D = 26
		expect(note(dr.row, 1).slice(3, 4)).toBe('0'); // rest: vol 0
	});

	it('effect is modal and e0 clears it', () => {
		const row = mmlToSfxRow('e2 c c e0 c').row;
		expect(note(row, 0).slice(4, 5)).toBe('2');
		expect(note(row, 1).slice(4, 5)).toBe('2');
		expect(note(row, 2).slice(4, 5)).toBe('0');
	});
});

describe('mmlToSfxRow: full combined-field probes (finding A.2)', () => {
	it('pitch32,wave5,vol3,eff2 -> 20532', () => {
		// pitch 32 = 12*2 + 8? no: use o2 g# = 24+8 = 32.
		expect(note(mmlToSfxRow('o2 v3 e2 @5 g#').row, 0)).toBe('20532');
	});

	it('pitch63,wave1,vol6,eff4 -> 3f164', () => {
		expect(note(mmlToSfxRow('o5 v6 e4 @1 d#').row, 0)).toBe('3f164');
	});
});

describe('mmlToSfxRow: durations are TRACKER ROWS (finding B.4)', () => {
	it('a bare note is one row; cN holds it for N rows via tie rows', () => {
		const {row, rows} = mmlToSfxRow('c4');
		expect(rows).toBe(4);
		// Same pitch/wave/vol/eff re-emitted in rows 0..3.
		for (let r = 0; r < 4; r++) expect(note(row, r)).toBe('18070');
		expect(note(row, 4)).toBe('00000'); // row 5 empty
	});

	it('l<N> sets the default row-length for subsequent bare notes', () => {
		const {row, rows} = mmlToSfxRow('l3 c d');
		expect(rows).toBe(6);
		for (let r = 0; r < 3; r++) expect(note(row, r).slice(0, 2)).toBe('18'); // c
		for (let r = 3; r < 6; r++) expect(note(row, r).slice(0, 2)).toBe('1a'); // d = 26
	});

	it('r<N> is N silent rows (volume 0)', () => {
		const {row, rows} = mmlToSfxRow('c r2 d');
		expect(rows).toBe(4);
		expect(note(row, 0)).toBe('18070');
		expect(note(row, 1).slice(3, 4)).toBe('0'); // rest: vol 0
		expect(note(row, 2).slice(3, 4)).toBe('0');
		expect(note(row, 3).slice(0, 2)).toBe('1a'); // d
	});

	it('^ (tie) extends the previous note by its length in rows', () => {
		const {row, rows} = mmlToSfxRow('c ^3');
		expect(rows).toBe(4); // 1 + 3 tie rows
		for (let r = 0; r < 4; r++) expect(note(row, r)).toBe('18070');
	});

	it('a dot multiplies the row count and rounding is reported', () => {
		// c4. = 4 * 1.5 = 6 rows (integral, no warning).
		const clean = mmlToSfxRow('c4.');
		expect(clean.rows).toBe(6);
		expect(clean.roundingWarnings).toHaveLength(0);
		// c3. = 3 * 1.5 = 4.5 -> rounds to 4 or 5, with a warning.
		const dotted = mmlToSfxRow('c3.');
		expect(dotted.rows).toBe(Math.round(4.5)); // 5 (bankers? Math.round(4.5)=5)
		expect(dotted.roundingWarnings).toHaveLength(1);
		expect(dotted.roundingWarnings[0]!.token).toBe('c3.');
		expect(dotted.roundingWarnings[0]!.exactRows).toBeCloseTo(4.5);
	});
});

describe('mmlToSfxRow: SFX filters (finding A.7) — the first header byte', () => {
	// The filter byte is the first header byte ([0:2]); mode bit stays 0 (pitch
	// mode), so the byte = the OR of the selected filter values (finding A.7).
	it('each single filter sets its verified bit in the header byte', () => {
		expect(header(mmlToSfxRow('!noiz c').row).slice(0, 2)).toBe('02');
		expect(header(mmlToSfxRow('!buzz c').row).slice(0, 2)).toBe('04');
		expect(header(mmlToSfxRow('!detune1 c').row).slice(0, 2)).toBe('08');
		expect(header(mmlToSfxRow('!detune2 c').row).slice(0, 2)).toBe('10');
		expect(header(mmlToSfxRow('!reverb c').row).slice(0, 2)).toBe('20');
		expect(header(mmlToSfxRow('!dampen c').row).slice(0, 2)).toBe('80');
	});

	it('DAMPEN has 2 levels (default 1); !dampen2 picks level 2 (finding A.7)', () => {
		expect(header(mmlToSfxRow('!dampen1 c').row).slice(0, 2)).toBe('80');
		expect(header(mmlToSfxRow('!dampen2 c').row).slice(0, 2)).toBe('c0');
		// bare !dampen defaults to level 1.
		expect(header(mmlToSfxRow('!dampen c').row)).toBe(
			header(mmlToSfxRow('!dampen1 c').row),
		);
	});

	it('filters OR together (a designed explosion: !dampen !reverb on @6 noise)', () => {
		// !dampen (0x80) | !reverb (0x20) = 0xa0: the boom's low body + resonant tail.
		expect(header(mmlToSfxRow('!dampen !reverb @6 c').row).slice(0, 2)).toBe(
			'a0',
		);
		// !noiz (0x02) | !dampen2 (0xc0) | !reverb (0x20) = 0xe2.
		expect(
			header(mmlToSfxRow('!noiz !dampen2 !reverb c').row).slice(0, 2),
		).toBe('e2');
	});

	it('the note rows are unchanged by a filter directive (filters are SFX-level)', () => {
		// The 5-nibble notes match the same MML WITHOUT the filter; only the header
		// byte differs (finding A.7: filters are per-SFX, not per-note).
		const withF = mmlToSfxRow('!dampen @6 v7 c d e');
		const without = mmlToSfxRow('@6 v7 c d e');
		expect(withF.row.slice(8)).toBe(without.row.slice(8)); // note body identical
		expect(withF.row.slice(2)).toBe(without.row.slice(2)); // speed/loop identical
		expect(withF.filters).toBe(0x80);
		expect(without.filters).toBe(0);
	});

	it('filters coexist with speed + loop markers in the header', () => {
		// s8 !dampen { c d e: filter 0x80, speed 8, LEN 3 (single { special case).
		const {row, filters} = mmlToSfxRow('s8 !dampen { c d e');
		expect(filters).toBe(0x80);
		expect(header(row)).toBe('80080300');
	});

	it('directives are position-independent + case-insensitive', () => {
		expect(mmlToSfxRow('!dampen c').row).toBe(mmlToSfxRow('c !dampen').row);
		expect(mmlToSfxRow('!DAMPEN c').row).toBe(mmlToSfxRow('!dampen c').row);
	});
});

describe('mmlToSfxRow: filter refusals (finding A.7) — NO silent clamp', () => {
	it('a DAMPEN level outside 1..2 is audio-mml-filter-level-out-of-range', () => {
		try {
			mmlToSfxRow('!dampen3 c');
			throw new Error('expected a throw');
		} catch (e) {
			expect(e).toBeInstanceOf(AudioMmlError);
			expect((e as AudioMmlError).code).toBe(
				'audio-mml-filter-level-out-of-range',
			);
			expect((e as AudioMmlError).message).toContain('DAMPEN');
		}
	});

	it('a DAMPEN level of 0 / 3 is refused', () => {
		expect(() => mmlToSfxRow('!dampen0 c')).toThrow(AudioMmlError);
		expect(() => mmlToSfxRow('!dampen9 c')).toThrow(AudioMmlError);
	});

	it('a level on a levelless filter (!noiz2 / !buzz1 / !reverb2) is refused', () => {
		expect(() => mmlToSfxRow('!noiz2 c')).toThrow(AudioMmlError);
		expect(() => mmlToSfxRow('!reverb2 c')).toThrow(AudioMmlError);
		try {
			mmlToSfxRow('!buzz1 c');
			throw new Error('expected a throw');
		} catch (e) {
			expect((e as AudioMmlError).code).toBe(
				'audio-mml-filter-level-out-of-range',
			);
		}
	});

	it('!detune requires an explicit 1 or 2 (two distinct sub-modes, not a level)', () => {
		expect(() => mmlToSfxRow('!detune c')).toThrow(AudioMmlError);
		expect(() => mmlToSfxRow('!detune3 c')).toThrow(AudioMmlError);
		expect(header(mmlToSfxRow('!detune1 c').row).slice(0, 2)).toBe('08');
		expect(header(mmlToSfxRow('!detune2 c').row).slice(0, 2)).toBe('10');
	});

	it('an unknown filter name is a parse error listing the 5 filters', () => {
		try {
			mmlToSfxRow('!wobble c');
			throw new Error('expected a throw');
		} catch (e) {
			expect(e).toBeInstanceOf(AudioMmlError);
			expect((e as AudioMmlError).code).toBe('audio-mml-parse-error');
			expect((e as AudioMmlError).message).toContain('!noiz');
		}
	});
});

describe('mmlToSfxRow: loop markers (finding A.1, B.5)', () => {
	it('no markers -> loop off (0 0)', () => {
		expect(header(mmlToSfxRow('c d e').row)).toBe('00100000');
	});

	it('{ and } resolve to loop-start/loop-end row indices', () => {
		// c { d e } f: loop start at row 1, loop end at row 3.
		const {row, loopStart, loopEnd} = mmlToSfxRow('c { d e } f');
		expect(loopStart).toBe(1);
		expect(loopEnd).toBe(3);
		expect(header(row)).toBe('00100103');
	});

	it('a single { (no }) is the LEN special case (loopEnd == 0)', () => {
		// 3 rows, single { at row 0 -> loopStart = 3 (LEN), loopEnd = 0.
		const {row, loopStart, loopEnd, rows} = mmlToSfxRow('{ c d e');
		expect(rows).toBe(3);
		expect(loopStart).toBe(3);
		expect(loopEnd).toBe(0);
		expect(header(row)).toBe('00100300');
	});
});

describe('mmlToSfxRow: structured refusals (finding B.2, B.4) — NO silent clamp', () => {
	it('a pitch above D#5 is audio-mml-pitch-out-of-range', () => {
		try {
			mmlToSfxRow('o5 g'); // pitch 60+7 = 67 > 63
			throw new Error('expected a throw');
		} catch (e) {
			expect(e).toBeInstanceOf(AudioMmlError);
			expect((e as AudioMmlError).code).toBe('audio-mml-pitch-out-of-range');
			expect((e as AudioMmlError).message).toContain('C0..D#5');
		}
	});

	it('a pitch below C0 is audio-mml-pitch-out-of-range', () => {
		try {
			mmlToSfxRow('o0 c-'); // pitch -1
			throw new Error('expected a throw');
		} catch (e) {
			expect((e as AudioMmlError).code).toBe('audio-mml-pitch-out-of-range');
		}
	});

	it('a sharp at the top of the range that exceeds 63 errors', () => {
		expect(() => mmlToSfxRow('o5 d#+')).toThrow(AudioMmlError); // 63+1
	});

	it('more than 32 rows is audio-mml-sfx-overflow', () => {
		try {
			mmlToSfxRow('c33');
			throw new Error('expected a throw');
		} catch (e) {
			expect(e).toBeInstanceOf(AudioMmlError);
			expect((e as AudioMmlError).code).toBe('audio-mml-sfx-overflow');
			expect((e as AudioMmlError).message).toContain('32');
		}
	});

	it('exactly 32 rows is allowed (the boundary)', () => {
		const {rows} = mmlToSfxRow('c32');
		expect(rows).toBe(32);
	});

	it('33 single notes also overflows', () => {
		expect(() => mmlToSfxRow('c'.repeat(33))).toThrow(AudioMmlError);
	});
});

describe('mmlToSfxRow: parse errors (tempo-style inputs rejected loudly)', () => {
	it('an unknown token is a parse error naming the column', () => {
		try {
			mmlToSfxRow('c t120 d'); // t = tempo, not a picopilot-MML token
			throw new Error('expected a throw');
		} catch (e) {
			expect(e).toBeInstanceOf(AudioMmlError);
			expect((e as AudioMmlError).code).toBe('audio-mml-parse-error');
			// The message reframes toward tracker-rows-not-tempo.
			expect((e as AudioMmlError).message).toContain('TRACKER ROWS');
		}
	});

	it('is case-insensitive for note letters and directives', () => {
		expect(mmlToSfxRow('C').row).toBe(mmlToSfxRow('c').row);
		expect(mmlToSfxRow('O3 C').row).toBe(mmlToSfxRow('o3 c').row);
	});

	it('whitespace and | bars are cosmetic', () => {
		expect(mmlToSfxRow('c d e').row).toBe(mmlToSfxRow('c|d|e').row);
	});
});
