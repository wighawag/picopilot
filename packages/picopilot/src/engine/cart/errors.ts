/**
 * Structured errors for the cart model.
 *
 * Parsing a malformed cart throws a `CartParseError` (never an unstructured
 * crash), carrying a machine-readable `code` and a human-readable `message` so
 * the command layer can turn it into incur's `error({ code, message, ... })`
 * envelope rather than letting a raw exception escape. Region access out of
 * bounds throws a `CartRangeError` for the same reason.
 */

/** Machine-readable reason a `.p8` could not be parsed into the cart model. */
export type CartParseErrorCode =
	/** The `pico-8 cartridge ...` header line is missing or unrecognised. */
	| 'missing-header'
	/** The `version N` line is missing or malformed. */
	| 'missing-version'
	/** A `__section__` marker is present but names a section we do not model. */
	| 'unknown-section'
	/** The same `__section__` marker appears more than once. */
	| 'duplicate-section';

/** Thrown when a `.p8` text blob cannot be parsed into a {@link Cart}. */
export class CartParseError extends Error {
	readonly code: CartParseErrorCode;

	constructor(code: CartParseErrorCode, message: string) {
		super(message);
		this.name = 'CartParseError';
		this.code = code;
	}
}

/** Thrown when a gfx/map region access falls outside the addressable grid. */
export class CartRangeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CartRangeError';
	}
}
