/**
 * `engine/audio`: the score to `__sfx__` + `__music__` planner (ADR-0020).
 *
 * A SCORE is one or more SONGS (sections of `__music__`, e.g. a title song and
 * an in-game song), each up to 4 channels of picopilot-MML of ANY length. The
 * planner does the bookkeeping an author used to do by hand (the conquest
 * dogfood needed a 250-line script for it):
 *
 * 1. parse every channel into its tracker-row stream ({@link mmlToRows});
 * 2. cut all channels of a song at the SAME row boundaries into patterns of
 *    `patternRows` rows (default 32), so channels stay aligned;
 * 3. a channel that is silent for a whole pattern becomes `null` (channel OFF),
 *    not a silent SFX; a pattern silent on EVERY channel keeps one silent SFX on
 *    channel 0 so it still lasts its length;
 * 4. de-duplicate identical SFX rows across the whole score;
 * 5. allocate slots: free (note-less) slots only, from 63 downwards, unless the
 *    caller names an explicit slot RANGE, which the score then OWNS (it may
 *    overwrite any slot in it and clears the slots in it it does not use);
 * 6. lay songs out back to back in `__music__`, with loop / stop flags.
 *
 * Pure: cart-free inputs in, a plan out. The `music from-score` command applies
 * the plan through the cart model (only owned `__sfx__` slots + `__music__`
 * change).
 */

import {
	CHANNEL_OFF_BIT,
	type ChannelRef,
	type Pattern,
	patternsToMusic,
	MUSIC_PATTERN_MAX,
} from './music.js';
import {
	AudioMmlError,
	DEFAULT_SPEED,
	emitSfxRow,
	mmlToRows,
	SFX_MAX_ROWS,
	SFX_ROW_LENGTH,
	type SfxNote,
} from './sfx.js';

/** The number of SFX slots (0..63). */
const SLOT_COUNT = 64;

/** PICO-8 SFX ticks per second (speed 1 = 1/120 s per row). */
const TICKS_PER_SECOND = 120;

/** One score channel: MML text, or `{mml, filters}` where `filters` are `!` directives. */
export type ScoreChannel = string | {mml: string; filters?: string} | null;

/** One song (a contiguous section of `__music__`). */
export interface ScoreSong {
	/** A label for the report (default `song<N>`). */
	name?: string;
	/** SFX speed (ticks/row) for every channel. Default: the channels' shared `s<N>`, else 16. */
	speed?: number;
	/** Rows per pattern, 1..32 (default 32). Under 32, each SFX carries the LEN header. */
	patternRows?: number;
	/** Loop the song (default true). false = the last pattern stops the music. */
	loop?: boolean;
	/** The pattern (0-based, within the song) the loop returns to (default 0). */
	loopFrom?: number;
	/** Up to 4 channels (ch0..ch3); `null` or a missing entry = no channel. */
	channels: ScoreChannel[];
}

/** A whole score: the songs, laid out in this order. */
export interface Score {
	songs: ScoreSong[];
}

/** Machine-readable reason a score could not be planned. */
export type ScoreErrorCode =
	| 'audio-score-parse-error'
	| 'audio-score-empty'
	| 'audio-score-bad-channel-count'
	| 'audio-score-bad-speed'
	| 'audio-score-speed-mismatch'
	| 'audio-score-bad-pattern-rows'
	| 'audio-score-bad-loop-from'
	| 'audio-score-loop-marker'
	| 'audio-score-too-many-patterns'
	| 'audio-score-no-free-slots'
	| 'audio-score-bad-slot-range';

/** A structured score refusal (mirrors {@link AudioMmlError}). */
export class ScoreError extends Error {
	readonly code: ScoreErrorCode;
	constructor(code: ScoreErrorCode, message: string) {
		super(message);
		this.name = 'ScoreError';
		this.code = code;
	}
}

/** What the planner needs to know about the cart it plans for. */
export interface ScoreCartState {
	/** The current `__sfx__` rows, indexed by slot (missing = empty). */
	sfxRows: readonly (string | undefined)[];
	/** The SFX slots the cart's CURRENT `__music__` references (the song being replaced). */
	musicRefs: ReadonlySet<number>;
}

/** Planner options. */
export interface ScorePlanOptions {
	/** An explicit inclusive slot range the score OWNS (overwrite + clear unused). */
	slots?: {from: number; to: number};
}

/** One song as laid out in `__music__`. */
export interface PlannedSong {
	name: string;
	/** The first pattern index: play it with `music(startPattern)`. */
	startPattern: number;
	/** The last pattern index of the song. */
	endPattern: number;
	patterns: number;
	speed: number;
	patternRows: number;
	loop: boolean;
	/** The absolute pattern index the loop returns to (when `loop`). */
	loopStartPattern: number | undefined;
	/** Play length of one pass through the song, in seconds. */
	seconds: number;
}

/** One SFX slot the plan writes. */
export interface PlannedSlot {
	slot: number;
	row: string;
	/** Where the SFX is used, e.g. `title p0 ch1` (pattern index is within the song). */
	uses: string[];
	/** Whether the slot held DIFFERENT, non-empty content before (an overwrite). */
	overwrote: boolean;
}

/** The plan: what to write into the cart, and the report. */
export interface ScorePlan {
	songs: PlannedSong[];
	slots: PlannedSlot[];
	/** Owned slots the score does not use, cleared to empty (only with a range). */
	cleared: number[];
	/** The `__music__` section body. */
	musicSection: string;
	/** Total patterns written. */
	patterns: number;
	/** Advisory warnings. */
	warnings: string[];
}

/** An all-zero `__sfx__` row: the canonical empty slot. */
export const EMPTY_SFX_ROW = '0'.repeat(SFX_ROW_LENGTH);

/** Whether an `__sfx__` row has no notes (its 32 note slots are all zero). */
export function isFreeSfxRow(row: string | undefined): boolean {
	return row === undefined || /^0*$/.test(row.slice(8));
}

/**
 * Parses + validates a score from JSON-ish input. Accepts `{songs:[...]}` or a
 * single song object (`{channels:[...]}`) as shorthand.
 *
 * @throws {ScoreError} `audio-score-parse-error` for a shape it cannot read.
 */
export function readScore(raw: unknown): Score {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new ScoreError(
			'audio-score-parse-error',
			'a score is a JSON object: {"songs":[{"name":"title","speed":16,"channels":["<mml>","<mml>",null,null]}]} (or one song object with "channels").',
		);
	}
	const obj = raw as Record<string, unknown>;
	const songs = Array.isArray(obj.songs)
		? obj.songs
		: Array.isArray(obj.channels)
			? [obj]
			: undefined;
	if (songs === undefined) {
		throw new ScoreError(
			'audio-score-parse-error',
			'a score needs "songs" (an array of songs) or, for one song, "channels".',
		);
	}
	if (songs.length === 0) {
		throw new ScoreError('audio-score-empty', 'the score has no songs.');
	}
	return {
		songs: songs.map((s, i) => {
			if (
				s === null ||
				typeof s !== 'object' ||
				!Array.isArray((s as ScoreSong).channels)
			) {
				throw new ScoreError(
					'audio-score-parse-error',
					`song ${i} must be an object with a "channels" array (up to 4 MML strings, {"mml","filters"} objects, or null).`,
				);
			}
			const song = s as ScoreSong;
			if (song.loop !== undefined && typeof song.loop !== 'boolean') {
				throw new ScoreError(
					'audio-score-parse-error',
					`song ${i} "loop" must be true or false, got ${JSON.stringify(song.loop)}.`,
				);
			}
			for (const [c, ch] of song.channels.entries()) {
				const ok =
					ch === null ||
					typeof ch === 'string' ||
					(typeof ch === 'object' &&
						typeof (ch as {mml?: unknown}).mml === 'string' &&
						((ch as {filters?: unknown}).filters === undefined ||
							typeof (ch as {filters?: unknown}).filters === 'string'));
				const filters =
					ch !== null && typeof ch === 'object'
						? (ch as {filters?: string}).filters
						: undefined;
				if (
					ok &&
					filters !== undefined &&
					!/^\s*(![a-z]+\d?\s*)*$/i.test(filters)
				) {
					throw new ScoreError(
						'audio-score-parse-error',
						`song ${i} channel ${c} "filters" may only hold ! filter directives (e.g. "!dampen !reverb"), got "${filters}". Put notes and modal settings in "mml".`,
					);
				}
				if (!ok) {
					throw new ScoreError(
						'audio-score-parse-error',
						`song ${i} channel ${c} must be an MML string, {"mml": "...", "filters": "!dampen"}, or null.`,
					);
				}
			}
			return song;
		}),
	};
}

/** A parsed channel of one song. */
interface ParsedChannel {
	notes: SfxNote[];
	filters: number;
}

/** Whether a run of rows is silent (every row at volume 0). */
function isSilent(notes: readonly SfxNote[]): boolean {
	return notes.every((n) => n.volume === 0);
}

/** A silent row (the padding past a channel's end). */
const SILENT: SfxNote = {pitch: 0, waveform: 0, volume: 0, effect: 0};

/**
 * Plans a score against a cart's current audio (ADR-0020). Pure.
 *
 * @throws {ScoreError} a malformed score, a speed/loop conflict, more than 64
 *   patterns, or not enough slots.
 * @throws {AudioMmlError} a channel's MML is invalid (message names song+channel).
 */
export function planScore(
	score: Score,
	cart: ScoreCartState,
	options: ScorePlanOptions = {},
): ScorePlan {
	const warnings: string[] = [];
	const allPatterns: Pattern[] = [];
	const songs: PlannedSong[] = [];
	/** Unique SFX rows, in first-use order, with their uses. */
	const unique = new Map<string, string[]>();
	/** Per pattern+channel, the unique row it plays (resolved to a slot later). */
	const channelRows: (string | null)[][] = [];
	let usesCustomInstrument = false;

	for (const [si, song] of score.songs.entries()) {
		const name = song.name ?? `song${si}`;
		if (song.channels.length === 0 || song.channels.length > 4) {
			throw new ScoreError(
				'audio-score-bad-channel-count',
				`song '${name}' has ${song.channels.length} channels; PICO-8 music has 1 to 4 (ch0..ch3).`,
			);
		}
		const patternRows = song.patternRows ?? SFX_MAX_ROWS;
		if (
			!Number.isInteger(patternRows) ||
			patternRows < 1 ||
			patternRows > SFX_MAX_ROWS
		) {
			throw new ScoreError(
				'audio-score-bad-pattern-rows',
				`song '${name}' patternRows ${patternRows} is not a whole number in 1..${SFX_MAX_ROWS} (one SFX holds 32 rows).`,
			);
		}

		// Parse every channel (no 32-row cap: the planner cuts them).
		const parsed: (ParsedChannel | null)[] = [];
		const speeds = new Set<number>();
		for (const [c, ch] of song.channels.entries()) {
			if (ch === null || ch === undefined) {
				parsed.push(null);
				continue;
			}
			const text =
				typeof ch === 'string' ? ch : `${ch.filters ?? ''} ${ch.mml}`;
			let rows;
			try {
				rows = mmlToRows(text, {maxRows: Number.POSITIVE_INFINITY});
			} catch (e) {
				if (e instanceof AudioMmlError) {
					throw new AudioMmlError(
						e.code,
						`song '${name}' channel ${c}: ${e.message}`,
					);
				}
				throw e;
			}
			if (rows.loopStartRow !== undefined || rows.loopEndRow !== undefined) {
				throw new ScoreError(
					'audio-score-loop-marker',
					`song '${name}' channel ${c} uses a '{'/'}' loop marker. In a score, looping is per SONG ("loop", "loopFrom"), not per SFX; remove the markers.`,
				);
			}
			if (rows.speedSet) speeds.add(rows.speed);
			if (rows.notes.some((n) => n.waveform >= 8 && n.volume > 0)) {
				usesCustomInstrument = true;
			}
			parsed.push({notes: rows.notes, filters: rows.filters});
		}

		let speed: number;
		if (song.speed !== undefined) {
			if (!Number.isInteger(song.speed) || song.speed < 1 || song.speed > 255) {
				throw new ScoreError(
					'audio-score-bad-speed',
					`song '${name}' speed ${song.speed} is not a whole number in 1..255 (ticks per row).`,
				);
			}
			speed = song.speed;
			const other = [...speeds].find((s) => s !== speed);
			if (other !== undefined) {
				throw new ScoreError(
					'audio-score-speed-mismatch',
					`song '${name}' has speed ${speed} but a channel sets s${other}. Every channel of a song shares ONE speed (patterns must stay aligned); drop the s<N> from the channel MML.`,
				);
			}
		} else if (speeds.size > 1) {
			throw new ScoreError(
				'audio-score-speed-mismatch',
				`song '${name}' channels set different speeds (${[...speeds].map((s) => `s${s}`).join(', ')}). Every channel of a song shares ONE speed; set "speed" on the song instead.`,
			);
		} else {
			speed = speeds.size === 1 ? [...speeds][0]! : DEFAULT_SPEED;
		}

		const totalRows = Math.max(0, ...parsed.map((p) => p?.notes.length ?? 0));
		if (totalRows === 0) {
			throw new ScoreError(
				'audio-score-empty',
				`song '${name}' has no rows on any channel.`,
			);
		}
		const count = Math.ceil(totalRows / patternRows);
		for (const [c, p] of parsed.entries()) {
			if (p !== null && p.notes.length < totalRows) {
				warnings.push(
					`song '${name}' channel ${c} is ${p.notes.length} rows, shorter than the song (${totalRows}); it is padded with silence.`,
				);
			}
		}
		if (totalRows % patternRows !== 0) {
			warnings.push(
				`song '${name}' is ${totalRows} rows, not a multiple of ${patternRows}; the last pattern is padded with ${count * patternRows - totalRows} silent rows.`,
			);
		}
		const loop = song.loop ?? true;
		const loopFrom = song.loopFrom ?? 0;
		if (!Number.isInteger(loopFrom) || loopFrom < 0 || loopFrom >= count) {
			throw new ScoreError(
				'audio-score-bad-loop-from',
				`song '${name}' loopFrom ${loopFrom} is not a pattern of the song (0..${count - 1}).`,
			);
		}

		const start = allPatterns.length;
		const lenHeader = patternRows < SFX_MAX_ROWS ? patternRows : 0;
		for (let p = 0; p < count; p++) {
			const refs: (string | null)[] = [];
			for (let c = 0; c < 4; c++) {
				const ch = parsed[c];
				if (ch === null || ch === undefined) {
					refs.push(null);
					continue;
				}
				const chunk = ch.notes.slice(p * patternRows, (p + 1) * patternRows);
				if (isSilent(chunk)) {
					refs.push(null);
					continue;
				}
				while (chunk.length < patternRows) chunk.push(SILENT);
				const row = emitSfxRow({
					filters: ch.filters,
					speed,
					loopStart: lenHeader,
					loopEnd: 0,
					notes: chunk,
				});
				refs.push(row);
				const uses = unique.get(row) ?? [];
				uses.push(`${name} p${p} ch${c}`);
				unique.set(row, uses);
			}
			if (!refs.some((r) => r !== null)) {
				// A pattern silent on every channel still has to LAST its length:
				// keep one silent SFX on channel 0 (PICO-8 times a pattern by its
				// left-most playing channel).
				const rest = emitSfxRow({
					speed,
					filters: 0,
					loopStart: lenHeader,
					loopEnd: 0,
					notes: [],
				});
				refs[0] = rest;
				const uses = unique.get(rest) ?? [];
				uses.push(`${name} p${p} ch0 (rest)`);
				unique.set(rest, uses);
			}
			channelRows.push(refs);
			allPatterns.push({
				channels: [null, null, null, null],
				...(loop && p === loopFrom ? {loopStart: true} : {}),
				...(loop && p === count - 1 ? {loopBack: true} : {}),
				...(!loop && p === count - 1 ? {stop: true} : {}),
			});
		}
		songs.push({
			name,
			startPattern: start,
			endPattern: start + count - 1,
			patterns: count,
			speed,
			patternRows,
			loop,
			loopStartPattern: loop ? start + loopFrom : undefined,
			seconds: round2((count * patternRows * speed) / TICKS_PER_SECOND),
		});
	}

	if (allPatterns.length > MUSIC_PATTERN_MAX) {
		throw new ScoreError(
			'audio-score-too-many-patterns',
			`the score needs ${allPatterns.length} patterns; __music__ holds ${MUSIC_PATTERN_MAX}. Shorten a song, or reuse material (identical patterns still take a pattern each).`,
		);
	}

	// --- slot allocation --------------------------------------------------------
	const range = options.slots;
	if (range !== undefined) {
		if (
			!Number.isInteger(range.from) ||
			!Number.isInteger(range.to) ||
			range.from < 0 ||
			range.to > SLOT_COUNT - 1 ||
			range.from > range.to
		) {
			throw new ScoreError(
				'audio-score-bad-slot-range',
				`slot range ${range.from}-${range.to} is not within 0-63 (from <= to).`,
			);
		}
	}
	// Stable allocation: an SFX whose exact row already sits in a usable slot
	// keeps that slot, so re-running an unchanged score is a byte-identical
	// no-op. With a range, "usable" is the range; without one, it is ANY slot
	// (reusing an identical row overwrites nothing), so default-mode re-runs do
	// not leak copies of the previous song into fresh slots.
	const usable = (s: number) =>
		range !== undefined
			? s >= range.from && s <= range.to
			: !(usesCustomInstrument && s < 8); // @8-@f read SFX 0..7
	const slotOf = new Map<string, number>();
	const taken = new Set<number>();
	for (const row of unique.keys()) {
		for (let s = SLOT_COUNT - 1; s >= 0; s--) {
			if (!taken.has(s) && usable(s) && cart.sfxRows[s] === row) {
				slotOf.set(row, s);
				taken.add(s);
				break;
			}
		}
	}

	const candidates: number[] = [];
	if (range !== undefined) {
		for (let s = range.from; s <= range.to; s++) candidates.push(s);
	} else {
		// Free slots only, from the top down: game SFX are usually authored from
		// slot 0 up, so music fills from 63 down and the two meet in the middle.
		for (let s = SLOT_COUNT - 1; s >= 0; s--) {
			if (usable(s) && isFreeSfxRow(cart.sfxRows[s])) candidates.push(s);
		}
	}
	const open = candidates.filter((c) => !taken.has(c));
	const needed = unique.size - slotOf.size;
	if (needed > open.length) {
		throw new ScoreError(
			'audio-score-no-free-slots',
			range !== undefined
				? `the score needs ${unique.size} distinct SFX but the slot range ${range.from}-${range.to} has ${candidates.length}. Widen the range or shorten/simplify the score.`
				: `the score needs ${needed} more SFX slots but the cart has ${open.length} free. Pass --slots <from-to> to give the music a range it owns (it overwrites that range), clear old slots with \`sfx clear\`, or shorten the score.`,
		);
	}
	if (range !== undefined && usesCustomInstrument && range.from < 8) {
		warnings.push(
			`the score uses custom instruments (@8-@f = SFX 0-7) and the slot range ${range.from}-${range.to} overlaps slots 0-7: music written there would replace those instruments.`,
		);
	}
	for (const row of unique.keys()) {
		if (slotOf.has(row)) continue;
		const s = open.shift()!;
		slotOf.set(row, s);
		taken.add(s);
	}

	const slots: PlannedSlot[] = [...unique.entries()]
		.map(([row, uses]) => {
			const slot = slotOf.get(row)!;
			const before = cart.sfxRows[slot];
			return {
				slot,
				row,
				uses,
				overwrote: !isFreeSfxRow(before) && before !== row,
			};
		})
		.sort((a, b) => a.slot - b.slot);

	const cleared =
		range === undefined
			? []
			: candidates.filter(
					(s) => !taken.has(s) && !isFreeSfxRow(cart.sfxRows[s]),
				);

	for (const [p, refs] of channelRows.entries()) {
		allPatterns[p]!.channels = refs.map((r) =>
			r === null ? null : slotOf.get(r)!,
		) as [ChannelRef, ChannelRef, ChannelRef, ChannelRef];
	}

	// Slots the previous __music__ used that nothing references any more, and
	// that we neither rewrote nor cleared: leftovers of the replaced song.
	const nowUsed = new Set(slots.map((s) => s.slot));
	const orphans = [...cart.musicRefs]
		.filter(
			(s) =>
				!nowUsed.has(s) &&
				!cleared.includes(s) &&
				!isFreeSfxRow(cart.sfxRows[s]),
		)
		.sort((a, b) => a - b);
	if (orphans.length > 0) {
		warnings.push(
			`SFX ${formatSlots(orphans)} were used by the previous __music__ and are no longer referenced; they still hold the old song's notes. Clear them with \`sfx clear ${formatSlots(orphans)}\`, or re-run with --slots <from-to> so the score owns (and clears) its range.`,
		);
	}

	const music = patternsToMusic(allPatterns);
	warnings.push(...music.warnings.map((w) => w.message));

	return {
		songs,
		slots,
		cleared,
		musicSection: music.section,
		patterns: allPatterns.length,
		warnings,
	};
}

/** Rounds to 2 decimals. */
function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Formats slot numbers compactly: `16-20,25`. */
export function formatSlots(slots: readonly number[]): string {
	const sorted = [...slots].sort((a, b) => a - b);
	const parts: string[] = [];
	for (let i = 0; i < sorted.length;) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
		parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
		i = j + 1;
	}
	return parts.join(',');
}

/**
 * Parses a slot list like `5`, `16-63` or `3,5,16-20` into sorted unique slots.
 * Returns `undefined` when the text is not a valid list within 0..63.
 */
export function parseSlotList(text: string): number[] | undefined {
	const out = new Set<number>();
	for (const part of text.split(',')) {
		const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
		if (m === null) return undefined;
		const from = Number(m[1]);
		const to = m[2] === undefined ? from : Number(m[2]);
		if (from > to || to > SLOT_COUNT - 1) return undefined;
		for (let s = from; s <= to; s++) out.add(s);
	}
	return [...out].sort((a, b) => a - b);
}

/** The SFX slots a `__music__` body references (on channels that are not off). */
export function musicSfxRefs(body: string | undefined): Set<number> {
	const refs = new Set<number>();
	if (body === undefined) return refs;
	for (const line of body.split(/\r?\n/)) {
		const m = /^[0-9a-f]{2} ([0-9a-f]{8})$/i.exec(line.trim());
		if (m === null) continue;
		for (let c = 0; c < 4; c++) {
			const b = Number.parseInt(m[1]!.slice(c * 2, c * 2 + 2), 16);
			if ((b & CHANNEL_OFF_BIT) === 0) refs.add(b & 0x3f);
		}
	}
	return refs;
}
