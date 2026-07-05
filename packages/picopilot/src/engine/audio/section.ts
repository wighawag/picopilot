import type {Cart} from '../cart/index.js';
import {SFX_ROW_LENGTH} from './sfx.js';

/**
 * The number of SFX slots a cart holds (finding: 64 SFX, indices 0..63).
 */
export const SFX_SLOT_COUNT = 64;

/** An all-zero `__sfx__` row (168 chars): the canonical "empty slot". */
const EMPTY_ROW = '0'.repeat(SFX_ROW_LENGTH);

/**
 * Merges one transpiled `__sfx__` row into slot `slot` (0..63) of a cart's
 * `__sfx__` section, leaving every other slot BYTE-IDENTICAL, and commits it
 * back through the cart model (so all other sections stay untouched).
 *
 * PICO-8 trims trailing all-zero SFX rows on save, so a cart's `__sfx__` body
 * may have FEWER than 64 lines (or be absent). This pads with empty rows up to
 * the target slot as needed, replaces the target, and drops trailing empty rows
 * again so the result matches what PICO-8 would write (a stable round-trip).
 *
 * The `__sfx__` body's newline style + trailing-newline are preserved from the
 * existing section (defaulting to `\n` with a terminating newline, matching what
 * PICO-8 writes).
 */
export function mergeSfxRow(cart: Cart, slot: number, row: string): void {
	if (!Number.isInteger(slot) || slot < 0 || slot >= SFX_SLOT_COUNT) {
		throw new RangeError(
			`SFX slot ${slot} out of range 0..${SFX_SLOT_COUNT - 1}`,
		);
	}
	if (row.length !== SFX_ROW_LENGTH) {
		throw new RangeError(
			`SFX row must be ${SFX_ROW_LENGTH} hex chars, got ${row.length}`,
		);
	}

	const body = cart.getSection('sfx');
	const newline = body !== undefined && /\r\n/.test(body) ? '\r\n' : '\n';

	// Parse existing rows (ignoring blank/trailing lines the split produces).
	const existing =
		body === undefined
			? []
			: body.split(/\r?\n/).filter((line) => line.length > 0);

	// Grow to include the target slot, padding intermediate slots with empties.
	const rows = existing.slice();
	while (rows.length <= slot) rows.push(EMPTY_ROW);
	rows[slot] = row;

	// Trim trailing all-zero rows (what PICO-8 does on save) so the body is the
	// canonical minimal form; a cart with only slot 0 authored stays one line.
	while (rows.length > 0 && rows[rows.length - 1] === EMPTY_ROW) rows.pop();

	const newBody = rows.length === 0 ? '' : rows.join(newline) + newline;
	cart.setSection('sfx', newBody);
}

/**
 * Replaces a cart's `__music__` section with a transpiled body, leaving every
 * OTHER section (including `__sfx__`) BYTE-IDENTICAL, and commits it back through
 * the cart model.
 *
 * Unlike `__sfx__` (where {@link mergeSfxRow} writes ONE slot), a `music
 * from-patterns` call authors the WHOLE song at once (an ordered pattern list is
 * the whole `__music__`), so this REPLACES the section wholesale rather than
 * merging a single row. The body is the codec's output (one `FF CCCCCCCC` row per
 * pattern); this only normalises its newline style to match the cart's existing
 * `__music__`/dominant newline so the round-trip stays stable.
 */
export function setMusicSection(cart: Cart, body: string): void {
	const existing = cart.getSection('music');
	// Preserve the file's newline style: CRLF if the existing music section (or,
	// absent, the codec body would already be \n) uses it. The codec emits \n.
	const crlf = existing !== undefined && /\r\n/.test(existing);
	const normalised = crlf ? body.replace(/\n/g, '\r\n') : body;
	cart.setSection('music', normalised);
}
