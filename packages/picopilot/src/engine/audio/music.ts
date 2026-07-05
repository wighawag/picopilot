/**
 * `engine/audio`: the shrinko-free structural pattern-list to `__music__` codec.
 *
 * `__music__` carries NO melodic content (that lives entirely in the referenced
 * SFX built by `sfx from-mml`). A song is authored STRUCTURALLY: an ordered list
 * of patterns, each naming up to 4 SFX-channel references plus the 3 pattern-flow
 * flags. This module OWNS that pattern-list -> `__music__` text emission; the
 * `music from-patterns` command is thin wiring over {@link patternsToMusic}.
 *
 * The layout is the CLOSED spec from the ADR-0005 spike, verified byte-for-byte
 * against PICO-8 v0.2.7:
 * `work/notes/findings/pico8-audio-sfx-music-layout-and-mml-subset.md` Part A.5
 * (the `__music__` text row) + Part B.6 (the structural authoring model). Each
 * pattern serializes to `<flagbyte> <4 channel bytes>` = `FF CCCCCCCC` (a 2-hex
 * flag byte + space + 8 hex = 4 channel bytes). Patterns are listed top to
 * bottom = song order.
 *
 * The load-bearing subtlety (finding B.6 / B.7 #9): "channel off" is NOT "sfx 0".
 * An off channel sets bit6 (`0x40`) on its channel byte and is silent this
 * pattern; sfx 0 is a real, playing SFX. The model keeps them DISTINCT: a channel
 * entry is an SFX index 0..63 OR `null` (off).
 *
 * Pattern LENGTH is not stored here: PICO-8 ends a pattern when the LEFT-MOST
 * non-looping channel's SFX finishes (finding B.6), so timing is INHERITED from
 * the referenced SFX (its speed + LEN, set via `sfx from-mml`). The music model
 * carries no per-pattern length by design.
 */

/** The flag bit set on the leading flag byte for a loop-start pattern (finding A.5). */
export const FLAG_LOOP_START = 0x01;

/** The flag bit for a loop-back pattern (jump back to loop-start at its end). */
export const FLAG_LOOP_BACK = 0x02;

/** The flag bit for a stop pattern (music stops after it). */
export const FLAG_STOP = 0x04;

/** The bit6 marker that makes a channel byte "off" (silent this pattern; finding A.5). */
export const CHANNEL_OFF_BIT = 0x40;

/** The highest valid SFX index a channel may reference (0..63; finding A.5). */
export const SFX_INDEX_MAX = 63;

/** The most patterns `__music__` holds (song positions 0..63; finding: 64 slots). */
export const MUSIC_PATTERN_MAX = 64;

/**
 * One channel reference in a pattern: an SFX index 0..63, or `null` = "off"
 * (bit6 set; the channel is silent this pattern). `null` and `0` are DISTINCT
 * (finding B.6): 0 is a real, playing SFX; `null` is silence.
 */
export type ChannelRef = number | null;

/**
 * One song pattern (finding B.6). `channels` is EXACTLY 4 entries (ch0..ch3);
 * each is an SFX index 0..63 or `null` (off). The 3 flow flags are optional and
 * default to false. Pattern order in the list = song order.
 */
export interface Pattern {
	/** The 4 channel references (ch0..ch3): each an SFX index 0..63 or `null` (off). */
	channels: [ChannelRef, ChannelRef, ChannelRef, ChannelRef];
	/** Flag 0x01: a `music` loop-back searches back to the nearest of these (or pattern 0). */
	loopStart?: boolean;
	/** Flag 0x02: at the end of this pattern, jump back to the loop-start pattern. */
	loopBack?: boolean;
	/** Flag 0x04: music stops after this pattern. */
	stop?: boolean;
}

/** Machine-readable reason a pattern list could not be transpiled. */
export type MusicErrorCode =
	/** A channel referenced an SFX index outside 0..63 (finding A.5). */
	| 'audio-music-sfx-out-of-range'
	/** A pattern did not carry exactly 4 channel entries (finding A.5). */
	| 'audio-music-bad-channel-count'
	/** More than 64 patterns were supplied (the `__music__` slot count). */
	| 'audio-music-too-many-patterns'
	/** The pattern list was empty (nothing to emit). */
	| 'audio-music-empty';

/**
 * A structured pattern-list transpile failure. Mirrors {@link AudioMmlError}'s
 * shape (a machine-readable `code` + an actionable `message`), surfaced by the
 * `music from-patterns` command as incur's `error({code,...})` envelope with a
 * nonzero exit. Never thrown for a case the spec allows (e.g. a loop-back with
 * no loop-start, which WARNS, not errors).
 */
export class MusicError extends Error {
	readonly code: MusicErrorCode;

	constructor(code: MusicErrorCode, message: string) {
		super(message);
		this.name = 'MusicError';
		this.code = code;
	}
}

/** A non-fatal advisory surfaced to the caller (finding B.6: loop-back w/o loop-start). */
export interface MusicWarning {
	/** A machine handle for the advisory. */
	code: 'loop-back-without-loop-start';
	/** A human-readable, actionable explanation. */
	message: string;
}

/** The successful result of transpiling a pattern list to `__music__`. */
export interface MusicTranspileResult {
	/** The `__music__` section body: one `FF CCCCCCCC` row per pattern, `\n`-terminated. */
	section: string;
	/** The number of patterns emitted (= song length). */
	patterns: number;
	/** Any non-fatal advisories (e.g. a loop-back with no loop-start anywhere). */
	warnings: MusicWarning[];
}

/** A byte as two lowercase hex chars. */
function byte(n: number): string {
	return n.toString(16).padStart(2, '0');
}

/**
 * Encodes one pattern into its `FF CCCCCCCC` text row (finding A.5): the 3 flow
 * flags are hoisted into the leading flag byte; each channel byte is the SFX
 * index (0..63), OR the index with bit6 (`0x40`) set for an "off" channel. A
 * `null` channel is off (bit6, index bits 0 -> byte `0x40`); the finding notes
 * an off byte keeps its low 6 bits (`0x41` = off + sfx 1), so a `null` becomes a
 * bare `0x40` (there is no underlying sfx index to preserve).
 *
 * @throws {MusicError} `audio-music-bad-channel-count` (not exactly 4 channels),
 *   `audio-music-sfx-out-of-range` (a channel index outside 0..63).
 */
function encodePattern(pattern: Pattern, index: number): string {
	const {channels} = pattern;
	if (!Array.isArray(channels) || channels.length !== 4) {
		throw new MusicError(
			'audio-music-bad-channel-count',
			`pattern ${index} must have exactly 4 channels (ch0..ch3), got ${
				Array.isArray(channels) ? channels.length : typeof channels
			}. Each channel is an SFX index 0..${SFX_INDEX_MAX} or null (off).`,
		);
	}

	let flags = 0;
	if (pattern.loopStart) flags |= FLAG_LOOP_START;
	if (pattern.loopBack) flags |= FLAG_LOOP_BACK;
	if (pattern.stop) flags |= FLAG_STOP;

	let channelBytes = '';
	for (let c = 0; c < 4; c++) {
		const ref = channels[c] as ChannelRef;
		if (ref === null) {
			// "Off" is bit6 with no sfx index: a bare 0x40 (finding A.5). Distinct
			// from sfx 0 (byte 0x00), which is a real, playing SFX.
			channelBytes += byte(CHANNEL_OFF_BIT);
			continue;
		}
		if (!Number.isInteger(ref) || ref < 0 || ref > SFX_INDEX_MAX) {
			throw new MusicError(
				'audio-music-sfx-out-of-range',
				`pattern ${index} channel ${c} references SFX ${ref}, outside 0..${SFX_INDEX_MAX}. A channel is an SFX index 0..${SFX_INDEX_MAX} or null (off); use null to silence a channel, not an out-of-range index.`,
			);
		}
		channelBytes += byte(ref);
	}

	return `${byte(flags)} ${channelBytes}`;
}

/**
 * Transpiles an ordered pattern list into a `__music__` section body (finding
 * Part A.5 + B.6). Emits the friendly text rows directly (flow flags hoisted
 * into the leading flag byte; bit6 set on off channels).
 *
 * Pattern order = song order. The result body is one `FF CCCCCCCC` row per
 * pattern, `\n`-joined with a terminating newline (what PICO-8 writes).
 *
 * A `loopBack` flag anywhere with NO `loopStart` flag anywhere is ALLOWED (PICO-8
 * falls back to pattern 0; finding B.6) but surfaces a {@link MusicWarning}, not
 * an error. Pattern LENGTH is inherited from the referenced SFX and is not stored
 * here (finding B.6).
 *
 * @throws {MusicError} `audio-music-empty` (no patterns),
 *   `audio-music-too-many-patterns` (>64), `audio-music-bad-channel-count` or
 *   `audio-music-sfx-out-of-range` (a malformed / out-of-range channel).
 */
export function patternsToMusic(patterns: Pattern[]): MusicTranspileResult {
	if (!Array.isArray(patterns) || patterns.length === 0) {
		throw new MusicError(
			'audio-music-empty',
			'no patterns to assemble: supply at least one pattern (each: 4 channel refs + optional loopStart/loopBack/stop flags).',
		);
	}
	if (patterns.length > MUSIC_PATTERN_MAX) {
		throw new MusicError(
			'audio-music-too-many-patterns',
			`${patterns.length} patterns exceeds the ${MUSIC_PATTERN_MAX}-pattern __music__ limit (song positions 0..${MUSIC_PATTERN_MAX - 1}).`,
		);
	}

	const rows = patterns.map((p, i) => encodePattern(p, i));

	const warnings: MusicWarning[] = [];
	const anyLoopStart = patterns.some((p) => p.loopStart === true);
	const anyLoopBack = patterns.some((p) => p.loopBack === true);
	if (anyLoopBack && !anyLoopStart) {
		warnings.push({
			code: 'loop-back-without-loop-start',
			message:
				'a pattern has loopBack but no pattern has loopStart: PICO-8 loops back to pattern 0. Add loopStart to the pattern you want the loop to return to, or accept the fall-back to pattern 0.',
		});
	}

	return {
		section: rows.join('\n') + '\n',
		patterns: rows.length,
		warnings,
	};
}
