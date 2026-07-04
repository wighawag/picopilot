import {SPRITE_SIZE} from '../cart/index.js';

/**
 * The shrinko-free char-grid codec: converts a sprite's per-pixel colour
 * nibbles (as {@link import('../cart/index.js').GfxSheet} reads/writes them)
 * to and from a readable CHAR GRID, and back, as an IDENTITY.
 *
 * The char grid is the "SVG for pixels" (CONTEXT.md `char grid`): the EDIT
 * surface an agent reads with `gfx show` and writes with `gfx set`. Each pixel
 * is one character:
 *
 * - `.` = transparent = colour index 0 (PICO-8's index-0 doubles as the default
 *   transparent colour; the grid renders it as `.` so an agent SEES the empty
 *   pixels rather than a wall of `0`s).
 * - `0`..`f` (lowercase hex) = colour indices 1..15 (`__gfx__` stores nibbles
 *   lowercase, so decode is case-insensitive but encode is lowercase to match
 *   what PICO-8 writes).
 *
 * The grid is 8 lines of 8 characters (one 8x8 sprite). The round-trip
 * `nibbles → grid → nibbles` is an identity for every valid sprite (asserted in
 * the tests), because `.` maps to 0 and 0 maps to `.` with no other collision.
 *
 * This codec is deliberately SEPARABLE from the cart model and the commands: it
 * only knows nibble grids and strings, so the later `gfx render` task can reuse
 * it and a test can round-trip it without a cart.
 */

/** The width/height (in pixels) of one sprite; a char grid is this square. */
export const GRID_SIZE = SPRITE_SIZE;

/** The character that renders colour index 0 (transparent) in a char grid. */
export const TRANSPARENT_CHAR = '.';

/**
 * Encodes an 8x8 grid of colour nibbles (0..15) into a char-grid string: 8
 * lines of 8 chars, `\n`-joined, no trailing newline. Index 0 → `.`; 1..15 →
 * the lowercase hex digit.
 *
 * @throws {GfxGridError} if the grid is not 8x8 or a cell is out of 0..15.
 */
export function nibblesToGrid(grid: number[][]): string {
	assertNibbleGrid(grid);
	const lines: string[] = [];
	for (let r = 0; r < GRID_SIZE; r++) {
		let line = '';
		for (let c = 0; c < GRID_SIZE; c++) line += nibbleToChar(grid[r]?.[c] ?? 0);
		lines.push(line);
	}
	return lines.join('\n');
}

/**
 * Decodes a char-grid string back into an 8x8 grid of colour nibbles (0..15),
 * the inverse of {@link nibblesToGrid}. Accepts `.` (→ 0) and hex digits
 * (case-insensitive). Blank lines / trailing whitespace-only content are
 * tolerated so an agent may paste a grid with a trailing newline; the parsed
 * content must still be exactly 8 rows of 8 cells.
 *
 * @throws {GfxGridError} if the parsed grid is not 8x8 or a char is invalid.
 */
export function gridToNibbles(text: string): number[][] {
	// Split on either newline style; drop a single trailing empty line (a paste
	// with a final newline) but keep interior blank lines so a genuine malformed
	// grid (too few rows) is caught rather than silently accepted.
	const rawLines = text.split(/\r?\n/);
	while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '')
		rawLines.pop();

	if (rawLines.length !== GRID_SIZE) {
		throw new GfxGridError(
			`char grid must have ${GRID_SIZE} rows, got ${rawLines.length}`,
		);
	}

	const grid: number[][] = [];
	for (let r = 0; r < GRID_SIZE; r++) {
		const line = rawLines[r] ?? '';
		if (line.length !== GRID_SIZE) {
			throw new GfxGridError(
				`char grid row ${r} must have ${GRID_SIZE} cells, got ${line.length}`,
			);
		}
		const row: number[] = [];
		for (let c = 0; c < GRID_SIZE; c++)
			row.push(charToNibble(line[c] as string, r, c));
		grid.push(row);
	}
	return grid;
}

/** A malformed char grid or nibble grid (wrong shape or an invalid cell/char). */
export class GfxGridError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GfxGridError';
	}
}

function nibbleToChar(n: number): string {
	return n === 0 ? TRANSPARENT_CHAR : n.toString(16);
}

function charToNibble(ch: string, r: number, c: number): number {
	if (ch === TRANSPARENT_CHAR) return 0;
	const v = Number.parseInt(ch, 16);
	if (Number.isNaN(v) || v < 0 || v > 15) {
		throw new GfxGridError(
			`invalid char "${ch}" at (${c}, ${r}); expected "${TRANSPARENT_CHAR}" or a hex digit 0-f`,
		);
	}
	return v;
}

function assertNibbleGrid(grid: number[][]): void {
	if (grid.length !== GRID_SIZE) {
		throw new GfxGridError(
			`nibble grid must have ${GRID_SIZE} rows, got ${grid.length}`,
		);
	}
	for (let r = 0; r < GRID_SIZE; r++) {
		const row = grid[r];
		if (row === undefined || row.length !== GRID_SIZE) {
			throw new GfxGridError(
				`nibble grid row ${r} must have ${GRID_SIZE} cells`,
			);
		}
		for (let c = 0; c < GRID_SIZE; c++) {
			const v = row[c] ?? 0;
			if (!Number.isInteger(v) || v < 0 || v > 15) {
				throw new GfxGridError(
					`nibble grid cell (${c}, ${r}) = ${v} out of range 0..15`,
				);
			}
		}
	}
}
