/**
 * `engine/audio` — the shrinko-free picopilot-MML to `__sfx__` codec.
 *
 * This module OWNS the picopilot-MML dialect and its transpilation into ONE
 * `__sfx__` text row (the friendly text surface PICO-8 serializes, NOT the
 * scattered RAM bit-packing). It is the greenfield/algorithmic seam of the audio
 * path; the `sfx from-mml` command is thin wiring over {@link mmlToSfxRow}.
 *
 * The mapping is the CLOSED spec from the ADR-0005 spike, verified byte-for-byte
 * against PICO-8 v0.2.7:
 * `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` (Part A =
 * the `__sfx__` text layout; Part B = the picopilot-MML grammar + mapping).
 *
 * The KEY reframe (finding B.4 / B.7 #1): PICO-8 has NO per-note duration or
 * tempo. Every note occupies exactly one tracker ROW; all rows share ONE
 * SFX-level `speed`. A picopilot-MML length is therefore a ROW COUNT, not a
 * musical fraction, and there is no tempo/BPM token. Holding a note for M rows
 * emits the same pitch on M rows; PICO-8 plays consecutive same-pitch rows as
 * one continuous tone, so a held note is shaped by stepping its VOLUME across
 * those rows (fade/drop effects land once per held note, ADR-0019).
 *
 * Out-of-range pitch and >32 rows are STRUCTURED ERRORS ({@link AudioMmlError}),
 * never silent clamps: a silent clamp produces wrong-sounding music the author
 * cannot see (finding B.2 / B.4, matching picopilot's smart-refuse philosophy).
 *
 * SFX-level FILTER directives (finding A.7): `!noiz !buzz !detune1/!detune2
 * !reverb !dampen[1|2]` set PICO-8's 5 per-SFX filters (the first header
 * byte), reaching the class of DESIGNED sounds (explosion = DAMPEN body + REVERB
 * tail, engine hum, pad) that no per-note pitch/waveform/volume MML can
 * synthesize. `!`-prefixed keywords never collide with the note grammar (unlike
 * the rejected bare-letter effect mnemonics, ADR-0008). A bad DAMPEN/REVERB level
 * is a structured refusal, never a clamp.
 */

/** A `__sfx__` row is exactly this many hex chars: 8 header + 32 notes x 5. */
export const SFX_ROW_LENGTH = 168;

/** The number of tracker rows (notes) in one SFX. A hard PICO-8 limit. */
export const SFX_MAX_ROWS = 32;

/** The lowest representable pitch: C0 = 0 (finding A.2 / B.2). */
export const PITCH_MIN = 0;

/** The highest representable pitch: D#5 = 63 (finding A.2 / B.2). */
export const PITCH_MAX = 63;

/** The default octave when none is set (`o2`, pitch 24 = C2; finding B.2). */
export const DEFAULT_OCTAVE = 2;

/** The default SFX speed (ticks/row) when `s<N>` is omitted (finding B.5). */
export const DEFAULT_SPEED = 16;

/** The default note length in tracker rows (one row; finding B.4). */
export const DEFAULT_LENGTH = 1;

/**
 * The per-SFX FILTER switches (finding A.7). They live in the FIRST header byte
 * of the `__sfx__` row (the `[0:2]` hex pair, the byte A.1 called "editor mode"):
 * an 8-bit bitfield whose LOW bit is the cosmetic pitch/tracker mode flag and
 * whose upper 7 bits are the filters. picopilot emits mode 0 (pitch mode), so the
 * byte is exactly the OR of the selected filter values below.
 *
 * Decoded byte-for-byte on PICO-8 v0.2.7 by poke-and-readback + single-bit audio
 * diff (finding A.7). NOIZ applies only to instrument 6 (`@6`, manual);
 * DAMPEN has 2 levels (`!dampen`/`!dampen2`); REVERB is one switch (ADR-0010).
 */
export const FILTER_NOIZ = 0x02;
export const FILTER_BUZZ = 0x04;
export const FILTER_DETUNE_1 = 0x08;
export const FILTER_DETUNE_2 = 0x10;
/** REVERB (echo) switch (`0x20`); see the level note below (finding A.7). */
export const FILTER_REVERB = 0x20;
/**
 * DAMPEN (low-pass) level 1 (`0x80`) and level 2 (`0xc0`); 0 = off (finding
 * A.7). Verified progressive: `0xc0` low-passes strictly more than `0x80`.
 */
export const FILTER_DAMPEN_LEVEL = [0x00, 0x80, 0xc0] as const;

/** The highest level DAMPEN (`!dampen<N>`) accepts (finding A.7). */
export const FILTER_MAX_LEVEL = 2;

/**
 * Semitone offset of each note letter from C, within an octave (finding B.2:
 * `c=0,d=2,e=4,f=5,g=7,a=9,b=11`).
 */
const SEMITONE: Readonly<Record<string, number>> = {
	c: 0,
	d: 2,
	e: 4,
	f: 5,
	g: 7,
	a: 9,
	b: 11,
};

// The finding (B.3) lists OPTIONAL two-letter effect mnemonics
// (`sl vb dr fi fo a4 a8`) as sugar ("SHOULD accept"), sitting atop the
// REQUIRED canonical `e0..e7`. picopilot-MML ships ONLY `e0..e7` (ADR-0008
// decision): every mnemonic collides with a note-letter sequence in this
// tracker-row grammar (`a4`/`a8` = note A + length; `dr` = note D + rest;
// `sl` shares its head with the `s` speed directive), so shipping them would
// SILENTLY re-mean genuine note sequences, exactly the coherence trap to avoid.
// The canonical numeric form is unambiguous and covers all 8 effects.

/** Machine-readable reason a picopilot-MML string could not be transpiled. */
export type AudioMmlErrorCode =
	/** A pitch fell outside C0..D#5 (0..63) (finding B.2). */
	| 'audio-mml-pitch-out-of-range'
	/** The accumulated tracker rows exceeded the 32-row SFX cap (finding B.4). */
	| 'audio-mml-sfx-overflow'
	/** A `!dampen<N>`/`!reverb<N>` level fell outside 1..2 (finding A.7). */
	| 'audio-mml-filter-level-out-of-range'
	/**
	 * A modal setter (`v`, `v[...]`, `e`, `@`, `~`) sat between a note and its `^`
	 * tie. A tie continues ONE held note (ADR-0019), so the change would be
	 * ignored; it is refused instead of silently dropped.
	 */
	| 'audio-mml-tie-state-change'
	/** The MML text is syntactically malformed (a token we cannot parse). */
	| 'audio-mml-parse-error';

/**
 * A structured picopilot-MML transpile failure. Carries a machine-readable
 * `code` (surfaced by the command as incur's `error({code,...})` envelope) plus
 * a human-readable, actionable `message`. Never thrown for a case the spec
 * defines a clamp/round for; only the genuine refusals + parse errors.
 */
export class AudioMmlError extends Error {
	readonly code: AudioMmlErrorCode;

	constructor(code: AudioMmlErrorCode, message: string) {
		super(message);
		this.name = 'AudioMmlError';
		this.code = code;
	}
}

/** One decoded tracker note (row): the 5 `__sfx__` nibbles `PP W V E`. */
export interface SfxNote {
	/** Chromatic pitch index 0..63 (C0..D#5). Ignored when `volume === 0`. */
	pitch: number;
	/** Waveform / instrument nibble 0..15 (0..7 built-in, 8..15 custom SFX-instr). */
	waveform: number;
	/** Volume 0..7; 0 = silent (a rest). */
	volume: number;
	/** Effect 0..7 (finding A.4 table). */
	effect: number;
}

/** A rounding note surfaced to the caller (a dotted length that was not integral). */
export interface RowRoundingWarning {
	/** The picopilot-MML token whose row count was rounded, e.g. `c4.`. */
	token: string;
	/** The exact (fractional) row count the length + dots computed. */
	exactRows: number;
	/** The integer row count actually emitted (nearest, min 1). */
	roundedRows: number;
}

/** The successful result of transpiling picopilot-MML to one `__sfx__` row. */
export interface SfxTranspileResult {
	/** The `__sfx__` text row: exactly {@link SFX_ROW_LENGTH} hex chars. */
	row: string;
	/** The number of tracker rows the MML produced (0..32). */
	rows: number;
	/** The SFX speed (ticks/row) written into the header (1..255). */
	speed: number;
	/** The header loop-start value (row index, or a LEN; finding A.1 / B.5). */
	loopStart: number;
	/** The header loop-end value (0 when off or in the LEN special case). */
	loopEnd: number;
	/**
	 * The per-SFX FILTER byte (the first header byte, finding A.7): the OR of the
	 * selected filter values, with the low mode bit 0. 0 = no filters.
	 */
	filters: number;
	/** Any dotted-length rows that had to be rounded to a whole row. */
	roundingWarnings: RowRoundingWarning[];
}

/**
 * A per-note VOLUME ENVELOPE (`v[...]`, ADR-0019). `head` is applied from the
 * note's first row, its last value held for as long as the note lasts; the
 * optional `tail` (after `/`) replaces the note's LAST rows, so a release lands
 * at the end of every note long enough to carry it (more rows than the tail).
 */
export interface VolumeEnvelope {
	readonly head: readonly number[];
	readonly tail: readonly number[];
}

/** Modal parser state (finding B.1: `@`/`v`/`e`/`o`/`l` are sticky). */
interface State {
	octave: number;
	waveform: number;
	volume: number;
	/** `v[...]`: when set, it shapes every note's volume instead of `volume`. */
	envelope: VolumeEnvelope | undefined;
	effect: number;
	/** `~N`: switch held notes to vibrato (e2) from their row N on; 0 = off. */
	vibratoDelay: number;
	length: number;
}

/** The modal values a held note was struck with (a `^` tie must not change them). */
export interface HeldNote {
	pitch: number;
	waveform: number;
	volume: number;
	envelope: VolumeEnvelope | undefined;
	effect: number;
	vibratoDelay: number;
}

/** The effect numbers whose behaviour is per ROW, not per held note (finding A.4). */
const EFFECT_DROP = 3;
const EFFECT_FADE_IN = 4;
const EFFECT_FADE_OUT = 5;
const EFFECT_VIBRATO = 2;

/**
 * The parsed row stream of a picopilot-MML string, before it is cut into one
 * `__sfx__` row. `music from-score` consumes this directly (a channel of ANY
 * length), `sfx from-mml` caps it at 32 rows and emits one SFX.
 */
export interface MmlRows {
	/** Every tracker row, in order. */
	notes: SfxNote[];
	/** The `s<N>` speed, or {@link DEFAULT_SPEED} when no `s<N>` was given. */
	speed: number;
	/** Whether an explicit `s<N>` appeared (a score refuses a mismatching one). */
	speedSet: boolean;
	/** The OR of the `!` filter directives. */
	filters: number;
	/** The row index at `{`, if any. */
	loopStartRow: number | undefined;
	/** The row index at `}`, if any. */
	loopEndRow: number | undefined;
	/** Dotted lengths that were rounded to whole rows. */
	roundingWarnings: RowRoundingWarning[];
}

/**
 * Renders ONE held note (struck once, held for `rows` rows) into tracker rows
 * (ADR-0019). PICO-8 plays consecutive same-pitch rows as one continuous tone,
 * so a held note is shaped by stepping VOLUME across its rows, never by
 * repeating a one-row effect on each of them:
 *
 * - volume: the `v[...]` envelope when one is set; otherwise, under fade-out
 *   (`e5`), a linear ramp from `v` towards 0 (`ceil`, so no row goes silent
 *   before the end); otherwise the flat `v`.
 * - `e4` fade in: the FIRST row only (the attack), the rest hold.
 * - `e5` fade out: the LAST row only (it fades the ramp's final step to 0).
 * - `e3` drop: the FIRST row only; the remaining rows are SILENT. A drop ends far
 *   below the note's pitch, so a held drop is a one-row hit followed by rests
 *   (re-sounding the pitch would be a second, un-dropped note).
 * - `e1` slide, `e2` vibrato, `e6`/`e7` arpeggio: EVERY row. They are
 *   continuous (vibrato), a no-op between equal pitches (slide), or defined over
 *   the 4-row group a row sits in (arpeggio), so carrying them on is what keeps
 *   their meaning.
 * - `~N` delayed vibrato: rows from index N on that would carry no effect get
 *   `e2`, so a long note starts plain and blooms into vibrato.
 *
 * A one-row note is emitted exactly as written (its effect included).
 */
export function renderHeldNote(note: HeldNote, rows: number): SfxNote[] {
	const out: SfxNote[] = [];
	for (let k = 0; k < rows; k++) {
		let volume: number;
		if (note.envelope !== undefined) {
			volume = envelopeVolume(note.envelope, k, rows);
		} else if (note.effect === EFFECT_FADE_OUT && rows > 1) {
			volume = Math.ceil(note.volume * (1 - k / rows));
		} else {
			volume = note.volume;
		}

		let effect: number;
		switch (note.effect) {
			case EFFECT_FADE_IN:
				effect = k === 0 ? EFFECT_FADE_IN : 0;
				break;
			case EFFECT_FADE_OUT:
				effect = k === rows - 1 ? EFFECT_FADE_OUT : 0;
				break;
			case EFFECT_DROP:
				if (k > 0) {
					out.push({pitch: 0, waveform: note.waveform, volume: 0, effect: 0});
					continue;
				}
				effect = EFFECT_DROP;
				break;
			default:
				effect = note.effect;
		}
		if (effect === 0 && note.vibratoDelay > 0 && k >= note.vibratoDelay) {
			effect = EFFECT_VIBRATO;
		}
		// A silent row inside a note carries no effect (nothing to shape).
		if (volume === 0) effect = 0;
		out.push({pitch: note.pitch, waveform: note.waveform, volume, effect});
	}
	return out;
}

/**
 * The volume a `v[...]` envelope gives row `k` of a `rows`-row note: the tail
 * owns the note's last `tail.length` rows when the note is LONGER than the tail
 * (so the head always sounds), the head owns the rest with its last value held.
 */
function envelopeVolume(env: VolumeEnvelope, k: number, rows: number): number {
	const tailLen = env.tail.length;
	if (tailLen > 0 && rows > tailLen && k >= rows - tailLen) {
		return env.tail[k - (rows - tailLen)]!;
	}
	return env.head[Math.min(k, env.head.length - 1)]!;
}

/**
 * Transpiles a picopilot-MML string into ONE `__sfx__` text row (finding Part
 * A/B). Emits the friendly text nibbles directly.
 *
 * Modal state model (finding B.1): `@<hex>` waveform, `v<0-7>` volume (or
 * `v[...]` a per-note volume envelope, ADR-0019), `e<0-7>` effect, `~<N>`
 * delayed vibrato, `o<0-5>` octave, `l<N>` default length, `>`/`<` octave
 * shift, all sticky. A bare note emits one row using the current state.
 *
 * SFX-level directives (finding B.5): `s<N>` speed (default 16), `{`/`}` loop
 * markers (single `{` = the LEN special case).
 *
 * Durations are TRACKER ROWS (finding B.4): a length `N` = one note HELD for N
 * rows, shaped by {@link renderHeldNote} (ADR-0019); `.` multiplies by 1.5
 * (rounded to the nearest whole row, warned); `r` = silent rows; `^` extends the
 * previous note (re-shaping it as one longer note).
 *
 * @throws {AudioMmlError} `audio-mml-pitch-out-of-range` (a note below C0 / above
 *   D#5), `audio-mml-sfx-overflow` (>32 rows), `audio-mml-tie-state-change` (a
 *   modal change between a note and its `^`), or `audio-mml-parse-error` (a
 *   token that cannot be parsed, incl. a tempo-style input).
 */
export function mmlToSfxRow(mml: string): SfxTranspileResult {
	const parsed = mmlToRows(mml, {maxRows: SFX_MAX_ROWS});
	const {loopStart, loopEnd} = resolveLoop(
		parsed.loopStartRow,
		parsed.loopEndRow,
		parsed.notes.length,
	);
	return {
		row: emitSfxRow({
			filters: parsed.filters,
			speed: parsed.speed,
			loopStart,
			loopEnd,
			notes: parsed.notes,
		}),
		rows: parsed.notes.length,
		speed: parsed.speed,
		loopStart,
		loopEnd,
		filters: parsed.filters,
		roundingWarnings: parsed.roundingWarnings,
	};
}

/**
 * Parses picopilot-MML into its tracker-row stream (the core of
 * {@link mmlToSfxRow}). `maxRows` is the overflow cap: 32 for one SFX,
 * `Infinity` for a `music from-score` channel, which is cut into SFX later.
 *
 * @throws {AudioMmlError} as {@link mmlToSfxRow}.
 */
export function mmlToRows(
	mml: string,
	options: {maxRows?: number} = {},
): MmlRows {
	const maxRows = options.maxRows ?? SFX_MAX_ROWS;
	const state: State = {
		octave: DEFAULT_OCTAVE,
		waveform: 0,
		volume: 7,
		envelope: undefined,
		effect: 0,
		vibratoDelay: 0,
		length: DEFAULT_LENGTH,
	};

	const notes: SfxNote[] = [];
	const warnings: RowRoundingWarning[] = [];
	let speed = DEFAULT_SPEED;
	let speedSet = false;
	let filters = 0;
	let loopStartRow: number | undefined;
	let loopEndRow: number | undefined;
	/** The last held note, where its rows start, and how many rows it holds. */
	let last: {note: HeldNote; start: number; rows: number} | undefined;

	const src = mml;
	let i = 0;
	const len = src.length;

	/** The overflow check, applied every time rows are appended (finding B.4). */
	const pushRows = (rows: SfxNote[]): void => {
		if (notes.length + rows.length > maxRows) {
			throw new AudioMmlError(
				'audio-mml-sfx-overflow',
				`picopilot-MML produced more than ${maxRows} tracker rows (an SFX holds at most ${maxRows} rows). Write a longer melody with \`music from-score\` (it splits any length into SFX + patterns), or shorten it. (Remember: a length is a ROW COUNT, not a musical note value.)`,
			);
		}
		notes.push(...rows);
	};

	while (i < len) {
		const ch = src[i] as string;

		// Whitespace + `|` bar separators are cosmetic and ignored (readability).
		if (/\s/.test(ch) || ch === '|') {
			i++;
			continue;
		}

		const lower = ch.toLowerCase();

		// --- SFX-level directives -------------------------------------------------
		if (lower === 's') {
			const {value, next} = readInt(src, i + 1);
			if (value === undefined) {
				throw parseError(src, i, "expected a number after 's' (SFX speed)");
			}
			if (value < 1 || value > 255) {
				throw parseError(
					src,
					i,
					`SFX speed 's${value}' out of range 1..255 (ticks per row)`,
				);
			}
			speed = value;
			speedSet = true;
			i = next;
			continue;
		}
		// `!<name>[<level>]`: an SFX-level FILTER directive (finding A.7). A `!` head
		// never collides with the note grammar (unlike the rejected `sl vb dr`
		// mnemonics, which WERE bare note-letter sequences, ADR-0008). They set the
		// first header byte; DAMPEN takes an optional 1..2 level (default 1).
		if (ch === '!') {
			const parsed = readFilter(src, i);
			filters |= parsed.bits;
			i = parsed.next;
			continue;
		}
		if (ch === '{') {
			loopStartRow = notes.length;
			i++;
			continue;
		}
		if (ch === '}') {
			loopEndRow = notes.length;
			i++;
			continue;
		}

		// --- Modal setters --------------------------------------------------------
		if (lower === '@') {
			// `@<hexdigit>`: waveform 0..7 built-in, 8..15 custom SFX-instrument.
			const hd = src[i + 1];
			const wv = hd === undefined ? Number.NaN : Number.parseInt(hd, 16);
			if (Number.isNaN(wv)) {
				throw parseError(
					src,
					i,
					"expected a hex digit 0-f after '@' (waveform 0-7, 8-f = custom SFX-instrument)",
				);
			}
			state.waveform = wv;
			i += 2;
			continue;
		}
		if (lower === 'v') {
			// `v[...]`: a per-note volume ENVELOPE (ADR-0019). `[` after `v` was a
			// parse error before, so no previously valid MML changes meaning.
			if (src[i + 1] === '[') {
				const env = readEnvelope(src, i);
				state.envelope = env.envelope;
				i = env.next;
				continue;
			}
			const {value, next} = readInt(src, i + 1);
			if (value === undefined || value > 7) {
				throw parseError(
					src,
					i,
					"expected a digit 0-7 after 'v' (volume), or 'v[...]' (a volume envelope, e.g. v[3 2 2 1/0])",
				);
			}
			state.volume = value;
			state.envelope = undefined; // a flat volume replaces an envelope
			i = next;
			continue;
		}
		// `~<N>`: delayed vibrato (ADR-0019). Held notes switch to e2 from their
		// row N; `~0` turns it off. `~` was an unexpected token before.
		if (ch === '~') {
			const {value, next} = readInt(src, i + 1);
			if (value === undefined || value > SFX_MAX_ROWS - 1) {
				throw parseError(
					src,
					i,
					`expected a row count 0-${SFX_MAX_ROWS - 1} after '~' (delayed vibrato: ~4 = vibrato from a held note's 5th row, ~0 = off)`,
				);
			}
			state.vibratoDelay = value;
			i = next;
			continue;
		}
		if (lower === 'o') {
			const {value, next} = readInt(src, i + 1);
			if (value === undefined || value > 5) {
				throw parseError(src, i, "expected a digit 0-5 after 'o' (octave)");
			}
			state.octave = value;
			i = next;
			continue;
		}
		if (lower === 'l') {
			// `l<N>[.]`: default note length in ROWS (may be dotted).
			const {value, next} = readInt(src, i + 1);
			if (value === undefined || value < 1) {
				throw parseError(
					src,
					i,
					"expected a positive number after 'l' (default note length in rows)",
				);
			}
			const dots = countDots(src, next);
			const token = src.slice(i, dots.next);
			const rows = resolveRows(value, dots.count, token, warnings);
			state.length = rows;
			i = dots.next;
			continue;
		}
		if (ch === '>') {
			state.octave += 1;
			i++;
			continue;
		}
		if (ch === '<') {
			state.octave -= 1;
			i++;
			continue;
		}

		// --- Effect ---------------------------------------------------------------
		// `e` is BOTH a note letter and the effect prefix (finding B.1). The
		// committed disambiguation (finding B.3: `e0..e7` is "the canonical,
		// unambiguous form"): `e` FOLLOWED BY a digit 0-7 is the effect token; a
		// bare `e` (or `e` + accidental/dot) falls through to the note-E handler
		// below. So note E takes the default length (`l4 e`) rather than `e4`
		// (which is effect 4). Documented in the command help (ADR-0008).
		if (lower === 'e') {
			const d = src[i + 1];
			if (d !== undefined && d >= '0' && d <= '7') {
				state.effect = Number.parseInt(d, 10);
				i += 2;
				continue;
			}
			if (d !== undefined && d >= '8' && d <= '9') {
				throw parseError(
					src,
					i,
					"effect 'e8'/'e9' out of range; effects are e0..e7",
				);
			}
			// else: fall through, `e` is the note E.
		}
		// --- Rest -----------------------------------------------------------------
		if (lower === 'r') {
			const dur = readDuration(src, i, i + 1, state.length);
			const silent: SfxNote[] = [];
			for (let k = 0; k < dur.rows; k++) {
				silent.push({pitch: 0, waveform: state.waveform, volume: 0, effect: 0});
			}
			pushRows(silent);
			collectWarning(dur, warnings);
			last = undefined;
			i = dur.next;
			continue;
		}

		// --- Tie: extend the previous note ---------------------------------------
		if (ch === '^') {
			if (last === undefined) {
				throw parseError(src, i, "'^' (tie) with no preceding note to extend");
			}
			// A tie extends the SAME held note, so it is re-shaped as one longer
			// note. A modal change in between (`c4 v3 ^4`, `c4 e5 ^2`) used to be
			// silently ignored; it is now refused, because a held note has one
			// shape (ADR-0019): use a `v[...]` envelope or a new note instead.
			const changed = tieStateChange(last.note, state);
			if (changed !== undefined) {
				throw new AudioMmlError(
					'audio-mml-tie-state-change',
					`'^' (tie) at column ${i + 1} extends a note struck with a different ${changed}: a tie continues the SAME held note, so the ${changed} set between the note and its '^' would be ignored. Shape a held note's volume with an envelope (e.g. "v[3 2 2 1] c8"), or start a new note instead of a tie.`,
				);
			}
			const dur = readDuration(src, i, i + 1, state.length);
			const total = last.rows + dur.rows;
			notes.splice(last.start);
			pushRows(renderHeldNote(last.note, total));
			last.rows = total;
			collectWarning(dur, warnings);
			i = dur.next;
			continue;
		}

		// --- Note -----------------------------------------------------------------
		if (lower in SEMITONE) {
			let semitone = SEMITONE[lower] as number;
			let j = i + 1;
			// Accidental: `+`/`#` sharp, `-` flat.
			if (src[j] === '+' || src[j] === '#') {
				semitone += 1;
				j++;
			} else if (src[j] === '-') {
				semitone -= 1;
				j++;
			}
			const pitch = 12 * state.octave + semitone;
			const noteToken = src.slice(i, j);
			if (pitch < PITCH_MIN || pitch > PITCH_MAX) {
				throw new AudioMmlError(
					'audio-mml-pitch-out-of-range',
					`note '${noteToken}' at octave o${state.octave} maps to pitch ${pitch}, outside PICO-8's range C0..D#5 (0..${PITCH_MAX}). PICO-8 has no notes above D#5 or below C0; pick an octave in range rather than transposing off the keyboard.`,
				);
			}
			const dur = readDuration(src, i, j, state.length);
			const note: HeldNote = {
				pitch,
				waveform: state.waveform,
				volume: state.volume,
				envelope: state.envelope,
				effect: state.effect,
				vibratoDelay: state.vibratoDelay,
			};
			const start = notes.length;
			pushRows(renderHeldNote(note, dur.rows));
			collectWarning(dur, warnings);
			last = {note, start, rows: dur.rows};
			i = dur.next;
			continue;
		}

		throw parseError(src, i, `unexpected token '${ch}'`);
	}

	return {
		notes,
		speed,
		speedSet,
		filters,
		loopStartRow,
		loopEndRow,
		roundingWarnings: warnings,
	};
}

/**
 * Names the modal value that changed between a held note and a `^` tie, or
 * `undefined` when the tie continues the note's own state. Octave and default
 * length are free to change (a tie keeps its pitch, and `^` reads the length).
 */
function tieStateChange(note: HeldNote, state: State): string | undefined {
	if (note.waveform !== state.waveform) return 'waveform (@)';
	if (note.effect !== state.effect) return 'effect (e)';
	if (note.vibratoDelay !== state.vibratoDelay) return 'delayed vibrato (~)';
	if (JSON.stringify(note.envelope) !== JSON.stringify(state.envelope)) {
		return 'volume envelope (v[...])';
	}
	if (note.envelope === undefined && note.volume !== state.volume) {
		return 'volume (v)';
	}
	return undefined;
}

/**
 * Parses a `v[...]` volume envelope at `at` (the `v`): digits 0-7 (one digit =
 * one row's volume, whitespace optional), and at most one `/` separating the
 * head from the release tail (ADR-0019).
 */
function readEnvelope(
	src: string,
	at: number,
): {envelope: VolumeEnvelope; next: number} {
	const close = src.indexOf(']', at + 2);
	if (close < 0) {
		throw parseError(src, at, "unclosed volume envelope 'v[': missing ']'");
	}
	const body = src.slice(at + 2, close);
	const parts = body.split('/');
	if (parts.length > 2) {
		throw parseError(
			src,
			at,
			"a volume envelope takes at most one '/' (head/release), e.g. v[3 2 2/1 0]",
		);
	}
	const digits = (part: string): number[] => {
		const out: number[] = [];
		for (const c of part) {
			if (/\s/.test(c)) continue;
			if (c < '0' || c > '7') {
				throw parseError(
					src,
					at,
					`volume envelope values are digits 0-7 (one per row), got '${c}'`,
				);
			}
			out.push(c.charCodeAt(0) - 48);
		}
		return out;
	};
	const head = digits(parts[0]!);
	const tail = parts.length === 2 ? digits(parts[1]!) : [];
	if (head.length === 0) {
		throw parseError(
			src,
			at,
			'a volume envelope needs at least one value before any /, e.g. v[3 2 2 1]',
		);
	}
	return {envelope: {head, tail}, next: close + 1};
}

/** A parsed duration: how many rows, whether it rounded, and where parsing resumed. */
interface Duration {
	rows: number;
	next: number;
	warning?: RowRoundingWarning;
}

/**
 * Reads an optional `[length][dots]` after a note/rest/tie head at `from`. If no
 * explicit length digit is present the current default `length` (already in
 * rows) is used, and any dots still multiply it.
 */
function readDuration(
	src: string,
	head: number,
	from: number,
	defaultRows: number,
): Duration {
	const {value, next} = readInt(src, from);
	const dots = countDots(src, value === undefined ? from : next);
	if (value === undefined && dots.count === 0) {
		return {rows: defaultRows, next: dots.next};
	}
	const base = value ?? defaultRows;
	const warnings: RowRoundingWarning[] = [];
	const token = src.slice(head, dots.next);
	const rows = resolveRows(base, dots.count, token, warnings);
	return {rows, next: dots.next, warning: warnings[0]};
}

/**
 * Resolves a base row count + dot count into an integer row count. Each dot
 * multiplies by an added 1/2, 1/4, ... (dotted-note convention): `n` dots =>
 * factor `2 - (1/2)^n`. Fractional results round to the nearest whole row (min
 * 1), and a rounding is recorded so the command can warn (finding B.4).
 */
function resolveRows(
	base: number,
	dots: number,
	token: string,
	warnings: RowRoundingWarning[],
): number {
	if (dots === 0) return base;
	const factor = 2 - 0.5 ** dots;
	const exact = base * factor;
	const rounded = Math.max(1, Math.round(exact));
	if (rounded !== exact) {
		warnings.push({token, exactRows: exact, roundedRows: rounded});
	}
	return rounded;
}

/** Pushes a duration's rounding warning (if any) into the accumulator. */
function collectWarning(dur: Duration, warnings: RowRoundingWarning[]): void {
	if (dur.warning) warnings.push(dur.warning);
}

/** Counts consecutive `.` dots from `at`, returning the count + resume index. */
function countDots(src: string, at: number): {count: number; next: number} {
	let n = at;
	while (src[n] === '.') n++;
	return {count: n - at, next: n};
}

/** Reads a non-negative integer at `at`, or `undefined` if none; returns resume index. */
function readInt(
	src: string,
	at: number,
): {value: number | undefined; next: number} {
	let j = at;
	while (j < src.length && src[j]! >= '0' && src[j]! <= '9') j++;
	if (j === at) return {value: undefined, next: at};
	return {value: Number.parseInt(src.slice(at, j), 10), next: j};
}

/** Builds an `audio-mml-parse-error` naming the offending column (1-based). */
function parseError(src: string, at: number, why: string): AudioMmlError {
	const col = at + 1;
	const near = src.slice(at, at + 8);
	return new AudioMmlError(
		'audio-mml-parse-error',
		`picopilot-MML parse error at column ${col} (near "${near}"): ${why}. Note: durations are TRACKER ROWS (l4 = 4 rows), not tempo/BPM; there is no tempo token.`,
	);
}

/**
 * Parses one `!<name>[<level>]` FILTER directive at `at` (the `!`), returning the
 * filter bits to OR into the SFX header byte + the resume index (finding A.7).
 *
 * The 5 switches: `!noiz` (instrument-6-only), `!buzz`, `!detune1`, `!detune2`,
 * `!reverb[1|2]`, `!dampen[1|2]`. DAMPEN/REVERB take an optional level 1..2
 * (default 1); `!dampen`/`!dampen1` = level 1, `!dampen2` = level 2. A level
 * OUTSIDE 1..2 is a STRUCTURED refusal ({@link AudioMmlError}
 * `audio-mml-filter-level-out-of-range`), never a silent clamp (matching the
 * pitch/overflow refusals, ADR-0008). `!detune` requires an explicit 1/2 (the
 * two detunes are distinct sub-modes, not levels of one).
 *
 * @throws {AudioMmlError} `audio-mml-filter-level-out-of-range` (bad DAMPEN/
 *   REVERB/DETUNE level) or `audio-mml-parse-error` (an unknown `!<name>`).
 */
function readFilter(src: string, at: number): {bits: number; next: number} {
	// Read the lowercase name letters after `!`.
	let j = at + 1;
	while (j < src.length && /[a-z]/i.test(src[j]!)) j++;
	const name = src.slice(at + 1, j).toLowerCase();
	// Read an optional trailing level digit (e.g. `!dampen2`, `!detune1`).
	const {value: level, next} = readInt(src, j);
	const token = src.slice(at, next);

	const leveled = (
		table: readonly number[],
		label: string,
		defaultLevel: number,
	): number => {
		const lvl = level ?? defaultLevel;
		if (lvl < 1 || lvl > FILTER_MAX_LEVEL) {
			throw new AudioMmlError(
				'audio-mml-filter-level-out-of-range',
				`filter '${token}' has ${label} level ${lvl}, outside 1..${FILTER_MAX_LEVEL}. PICO-8 gives ${label} exactly ${FILTER_MAX_LEVEL} levels; use !${name}1 or !${name}2.`,
			);
		}
		return table[lvl]!;
	};

	switch (name) {
		case 'noiz':
			rejectLevel(src, at, token, name, level);
			return {bits: FILTER_NOIZ, next};
		case 'buzz':
			rejectLevel(src, at, token, name, level);
			return {bits: FILTER_BUZZ, next};
		case 'reverb':
			rejectLevel(src, at, token, name, level);
			return {bits: FILTER_REVERB, next};
		case 'detune': {
			// `!detune` needs an explicit 1 or 2 (they are distinct sub-modes).
			if (level === undefined) {
				throw new AudioMmlError(
					'audio-mml-filter-level-out-of-range',
					`filter '${token}' needs a mode: !detune1 (flange) or !detune2 (octave). PICO-8 has two distinct detunes, not a level.`,
				);
			}
			if (level === 1) return {bits: FILTER_DETUNE_1, next};
			if (level === 2) return {bits: FILTER_DETUNE_2, next};
			throw new AudioMmlError(
				'audio-mml-filter-level-out-of-range',
				`filter '${token}' mode ${level} is not 1 (flange) or 2 (octave).`,
			);
		}
		case 'detune1':
			return {bits: FILTER_DETUNE_1, next};
		case 'detune2':
			return {bits: FILTER_DETUNE_2, next};
		case 'dampen':
			return {bits: leveled(FILTER_DAMPEN_LEVEL, 'DAMPEN', 1), next};
		default:
			throw parseError(
				src,
				at,
				`unknown filter '${token}'. The 5 SFX filters are !noiz !buzz !detune1/!detune2 !reverb !dampen[1|2]`,
			);
	}
}

/** Refuses a level on a filter that has none (`!noiz2`, `!buzz1`), no silent drop. */
function rejectLevel(
	src: string,
	at: number,
	token: string,
	name: string,
	level: number | undefined,
): void {
	if (level !== undefined) {
		throw new AudioMmlError(
			'audio-mml-filter-level-out-of-range',
			`filter '${token}' takes no level; !${name} is a simple on/off switch (only !dampen and !reverb have levels).`,
		);
	}
}

/**
 * Resolves the raw `{`/`}` marker rows into header `loopStart`/`loopEnd` values
 * (finding A.1 / B.5):
 * - neither marker: loop off (`0 0`).
 * - both: `loopStart` = row at `{`, `loopEnd` = row at `}`.
 * - only `{`: the LEN special case (`loopEnd == 0`, `loopStart` reinterpreted as
 *   the pattern length): emit `loopStart = rowCount`, `loopEnd = 0`.
 */
function resolveLoop(
	loopStartRow: number | undefined,
	loopEndRow: number | undefined,
	rowCount: number,
): {loopStart: number; loopEnd: number} {
	if (loopStartRow === undefined && loopEndRow === undefined) {
		return {loopStart: 0, loopEnd: 0};
	}
	if (loopStartRow !== undefined && loopEndRow === undefined) {
		// Single `{` = LEN special case: this SFX is `rowCount` rows long.
		return {loopStart: rowCount, loopEnd: 0};
	}
	// `}` present (with or without `{`): a real loop. A bare `}` loops back to 0.
	return {loopStart: loopStartRow ?? 0, loopEnd: loopEndRow ?? 0};
}

/** Serializes the header + notes into the 168-char `__sfx__` text row (finding A). */
export function emitSfxRow(sfx: {
	filters: number;
	speed: number;
	loopStart: number;
	loopEnd: number;
	notes: readonly SfxNote[];
}): string {
	// Header: filter-byte(2) speed(2) loopstart(2) loopend(2). The first byte is the
	// per-SFX FILTER bitfield (finding A.7); its low bit is the cosmetic pitch/
	// tracker mode flag, which we leave 0 (pitch mode), so the byte is exactly the
	// OR of the selected filter values.
	const header =
		byte(sfx.filters) +
		byte(sfx.speed) +
		byte(sfx.loopStart) +
		byte(sfx.loopEnd);

	let body = '';
	for (let r = 0; r < SFX_MAX_ROWS; r++) {
		const note = sfx.notes[r];
		if (note === undefined) {
			// Unfilled rows are all-zero (pitch 0, wave 0, vol 0 = silent, eff 0).
			body += '00000';
			continue;
		}
		body +=
			byte(note.pitch) +
			nib(note.waveform) +
			nib(note.volume) +
			nib(note.effect);
	}
	return header + body;
}

/** A byte as two lowercase hex chars. */
function byte(n: number): string {
	return n.toString(16).padStart(2, '0');
}

/** A nibble as one lowercase hex char. */
function nib(n: number): string {
	return n.toString(16);
}
