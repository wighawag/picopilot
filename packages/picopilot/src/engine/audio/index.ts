/**
 * `engine/audio` — the shrinko-free, PICO-8-free audio codec. Two halves:
 * the picopilot-MML to `__sfx__` transpiler (finding Part A/B, ADR-0005 +
 * ADR-0008) and the structural pattern-list to `__music__` codec (finding A.5 /
 * B.6, ADR-0005).
 *
 * Mirrors the `engine/gfx` shape: a pure module + this index re-export, no
 * adapter. The `sfx from-mml` command is thin wiring over {@link mmlToSfxRow};
 * the `music from-patterns` command over {@link patternsToMusic}.
 */
export {mergeSfxRow, setMusicSection, SFX_SLOT_COUNT} from './section.js';
export {
	AudioMmlError,
	type AudioMmlErrorCode,
	DEFAULT_LENGTH,
	DEFAULT_OCTAVE,
	DEFAULT_SPEED,
	mmlToSfxRow,
	PITCH_MAX,
	PITCH_MIN,
	type RowRoundingWarning,
	SFX_MAX_ROWS,
	SFX_ROW_LENGTH,
	type SfxTranspileResult,
} from './sfx.js';
export {
	CHANNEL_OFF_BIT,
	type ChannelRef,
	FLAG_LOOP_BACK,
	FLAG_LOOP_START,
	FLAG_STOP,
	MUSIC_PATTERN_MAX,
	MusicError,
	type MusicErrorCode,
	type MusicTranspileResult,
	type MusicWarning,
	type Pattern,
	patternsToMusic,
	SFX_INDEX_MAX,
} from './music.js';
