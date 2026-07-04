/**
 * PICO-8's FIXED 16-colour palette (index → RGB), the single source of truth for
 * the `gfx render` PNG encoder.
 *
 * These are the stable, widely-reproduced PICO-8 0..15 palette constants,
 * transcribed verbatim from `work/notes/findings/pico8-api-reference.md` (the
 * same table the scaffolded `AGENTS.md` reference cites). Do NOT re-invent these
 * values: if a future PICO-8 version alters them, revise the finding, the
 * scaffold reference, and THIS table together.
 *
 * Index 0 doubles as PICO-8's default transparent colour; `gfx render` renders it
 * as its RGB (black) so the PNG shows the actual pixels a `spr()` with no
 * transparency would draw. (Transparency is a draw-time concern, not a property
 * of the spritesheet bytes, so the JUDGE surface renders every index opaquely.)
 */

/** One palette entry: the colour index and its RGB triple. */
export interface PaletteColor {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

/**
 * The 16 PICO-8 palette RGB triples, indexed 0..15. Frozen so no caller can
 * mutate the shared source of truth.
 */
export const PICO8_PALETTE: readonly PaletteColor[] = Object.freeze([
	{r: 0, g: 0, b: 0}, // 0  black
	{r: 29, g: 43, b: 83}, // 1  dark-blue
	{r: 126, g: 37, b: 83}, // 2  dark-purple
	{r: 0, g: 135, b: 81}, // 3  dark-green
	{r: 171, g: 82, b: 54}, // 4  brown
	{r: 95, g: 87, b: 79}, // 5  dark-grey
	{r: 194, g: 195, b: 199}, // 6  light-grey
	{r: 255, g: 241, b: 232}, // 7  white
	{r: 255, g: 0, b: 77}, // 8  red
	{r: 255, g: 163, b: 0}, // 9  orange
	{r: 255, g: 236, b: 39}, // 10 yellow
	{r: 0, g: 228, b: 54}, // 11 green
	{r: 41, g: 173, b: 255}, // 12 blue
	{r: 131, g: 118, b: 156}, // 13 lavender
	{r: 255, g: 119, b: 168}, // 14 pink
	{r: 255, g: 204, b: 170}, // 15 peach
] as const);

/** The RGB triple for colour index 0..15. Throws for an out-of-range index. */
export function paletteColor(index: number): PaletteColor {
	const c = PICO8_PALETTE[index];
	if (c === undefined) {
		throw new RangeError(`palette index ${index} out of range 0..15`);
	}
	return c;
}
