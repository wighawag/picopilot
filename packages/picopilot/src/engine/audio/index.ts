/**
 * `engine/audio` — the shrinko-free, PICO-8-free audio codec. Currently the
 * picopilot-MML to `__sfx__` transpiler (finding Part A/B, ADR-0005 + ADR-0008);
 * later tasks add the structural pattern-list to `__music__` codec.
 *
 * Mirrors the `engine/gfx` shape: a pure module + this index re-export, no
 * adapter. The `sfx from-mml` command is thin wiring over {@link mmlToSfxRow}.
 */
export {mergeSfxRow, SFX_SLOT_COUNT} from './section.js';
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
