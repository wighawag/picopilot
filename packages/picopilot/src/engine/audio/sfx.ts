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
 * re-emits the same note in the following (M-1) rows (PICO-8 has no cross-row
 * sustain bit).
 *
 * Out-of-range pitch and >32 rows are STRUCTURED ERRORS ({@link AudioMmlError}),
 * never silent clamps: a silent clamp produces wrong-sounding music the author
 * cannot see (finding B.2 / B.4, matching picopilot's smart-refuse philosophy).
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
interface Note {
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
	/** Any dotted-length rows that had to be rounded to a whole row. */
	roundingWarnings: RowRoundingWarning[];
}

/** Modal parser state (finding B.1: `@`/`v`/`e`/`o`/`l` are sticky). */
interface State {
	octave: number;
	waveform: number;
	volume: number;
	effect: number;
	length: number;
}

/**
 * Transpiles a picopilot-MML string into ONE `__sfx__` text row (finding Part
 * A/B). Emits the friendly text nibbles directly.
 *
 * Modal state model (finding B.1): `@<hex>` waveform, `v<0-7>` volume,
 * `e<0-7>`/mnemonic effect, `o<0-5>` octave, `l<N>` default length, `>`/`<`
 * octave shift, all sticky. A bare note emits one row using the current state.
 *
 * SFX-level directives (finding B.5): `s<N>` speed (default 16), `{`/`}` loop
 * markers (single `{` = the LEN special case).
 *
 * Durations are TRACKER ROWS (finding B.4): a length `N` = N rows, emitted as
 * the note then `(N-1)` tie rows re-striking it; `.` multiplies by 1.5 (rounded
 * to the nearest whole row, warned); `r` = silent rows; `^` extends the previous
 * note.
 *
 * @throws {AudioMmlError} `audio-mml-pitch-out-of-range` (a note below C0 / above
 *   D#5), `audio-mml-sfx-overflow` (>32 rows), or `audio-mml-parse-error` (a
 *   token that cannot be parsed, incl. a tempo-style input).
 */
export function mmlToSfxRow(mml: string): SfxTranspileResult {
	const state: State = {
		octave: DEFAULT_OCTAVE,
		waveform: 0,
		volume: 7,
		effect: 0,
		length: DEFAULT_LENGTH,
	};

	const notes: Note[] = [];
	const warnings: RowRoundingWarning[] = [];
	let speed = DEFAULT_SPEED;
	let loopStartRow: number | undefined;
	let loopEndRow: number | undefined;
	let lastNote: Note | undefined;

	const src = mml;
	let i = 0;
	const len = src.length;

	/** The overflow check, applied every time rows are appended (finding B.4). */
	const pushNote = (note: Note): void => {
		if (notes.length + 1 > SFX_MAX_ROWS) {
			throw new AudioMmlError(
				'audio-mml-sfx-overflow',
				`picopilot-MML produced more than ${SFX_MAX_ROWS} tracker rows (an SFX holds at most ${SFX_MAX_ROWS} rows). Split the melody across multiple SFX + a music pattern, or shorten it. (Remember: a length is a ROW COUNT, not a musical note value.)`,
			);
		}
		notes.push(note);
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
			i = next;
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
			const {value, next} = readInt(src, i + 1);
			if (value === undefined || value > 7) {
				throw parseError(src, i, "expected a digit 0-7 after 'v' (volume)");
			}
			state.volume = value;
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
			for (let k = 0; k < dur.rows; k++) {
				pushNote({pitch: 0, waveform: state.waveform, volume: 0, effect: 0});
			}
			collectWarning(dur, warnings);
			lastNote = undefined;
			i = dur.next;
			continue;
		}

		// --- Tie: extend the previous note ---------------------------------------
		if (ch === '^') {
			if (lastNote === undefined) {
				throw parseError(src, i, "'^' (tie) with no preceding note to extend");
			}
			const dur = readDuration(src, i, i + 1, state.length);
			for (let k = 0; k < dur.rows; k++) pushNote({...lastNote});
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
			const note: Note = {
				pitch,
				waveform: state.waveform,
				volume: state.volume,
				effect: state.effect,
			};
			for (let k = 0; k < dur.rows; k++) pushNote({...note});
			collectWarning(dur, warnings);
			lastNote = note;
			i = dur.next;
			continue;
		}

		throw parseError(src, i, `unexpected token '${ch}'`);
	}

	const {loopStart, loopEnd} = resolveLoop(
		loopStartRow,
		loopEndRow,
		notes.length,
	);

	return {
		row: emitRow({speed, loopStart, loopEnd, notes}),
		rows: notes.length,
		speed,
		loopStart,
		loopEnd,
		roundingWarnings: warnings,
	};
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
function emitRow(sfx: {
	speed: number;
	loopStart: number;
	loopEnd: number;
	notes: Note[];
}): string {
	// Header: mode(2) speed(2) loopstart(2) loopend(2). Mode 0 = pitch mode
	// (cosmetic; does not affect playback, finding A.1).
	const header =
		byte(0) + byte(sfx.speed) + byte(sfx.loopStart) + byte(sfx.loopEnd);

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
