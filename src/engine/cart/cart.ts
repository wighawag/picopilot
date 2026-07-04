import { CartParseError } from './errors.js'

/**
 * The section names picopilot models in a text-format `.p8` cart. These are the
 * markers PICO-8 writes (`__lua__`, `__gfx__`, ...); `__label__` is the cart
 * label image, also hex.
 */
export const CART_SECTION_NAMES = ['lua', 'gfx', 'gff', 'label', 'map', 'sfx', 'music'] as const

/** A recognised `.p8` section name (without the surrounding `__`). */
export type CartSectionName = (typeof CART_SECTION_NAMES)[number]

const KNOWN_SECTIONS = new Set<string>(CART_SECTION_NAMES)

/**
 * One parsed section of a cart, kept as three verbatim pieces so re-joining
 * them reproduces the original bytes exactly:
 *
 * - `marker`: the section-marker line INCLUDING its line terminator, e.g.
 *   `"__gfx__\n"` or `"__gfx__\r\n"`.
 * - `body`: everything from after the marker line up to (not including) the
 *   next marker, verbatim (its own trailing newline(s) live here).
 *
 * The public API exposes the section body as a string via {@link Cart.getSection}
 * / {@link Cart.setSection}; the `marker` is internal book-keeping so callers
 * never have to reason about newline style to keep the round-trip identical.
 */
interface CartSection {
  readonly name: CartSectionName
  marker: string
  body: string
}

/**
 * Matches a whole line that is a section marker: `__name__` optionally followed
 * by a `\r` (CRLF) and the line's `\n`, anchored so a `__x__` appearing mid-line
 * (e.g. inside Lua) is never mistaken for a marker. The trailing newline is
 * captured into the match so the marker line, terminator included, is preserved.
 */
const SECTION_MARKER = /^__([a-zA-Z0-9]+)__[^\S\r\n]*(\r?\n|$)/gm

/**
 * The in-memory model of a text-format `.p8` cart: the load-bearing seam every
 * cart-touching command (init, gfx, tokens, verify) reads and writes through.
 *
 * Design contract:
 *
 * - **Round-trip is identity.** `Cart.parse(text).serialize() === text`, byte
 *   for byte, for any well-formed cart, regardless of newline style or trailing
 *   newline. Achieved by preserving the header, each marker line, and each
 *   section body verbatim, and never normalising whitespace on the way through.
 * - **Sections are independently addressable.** {@link getSection} /
 *   {@link setSection} read and replace one section without disturbing the
 *   others (or the header).
 * - **gfx/map are addressable as regions, not opaque strings.** The `__gfx__`
 *   and `__map__` hex bodies are exposed as row/pixel grids (see `gfx.ts` /
 *   `map.ts`) so the gfx codec and the 0x1000 overlap check can target specific
 *   sprites/map rows.
 */
export class Cart {
  /**
   * The raw text before the first section marker (the `pico-8 cartridge ...`
   * line, the `version N` line, and any trailing blank lines), preserved
   * verbatim so it round-trips exactly.
   */
  readonly header: string

  private readonly sections: CartSection[]

  private constructor(header: string, sections: CartSection[]) {
    this.header = header
    this.sections = sections
  }

  /**
   * Parses a `.p8` text blob into a {@link Cart}.
   *
   * Malformed input throws a {@link CartParseError} with a machine-readable
   * `code` (missing header/version, unknown or duplicate section) rather than
   * crashing, so the command layer can surface a structured failure.
   */
  static parse(text: string): Cart {
    if (!/^pico-8 cartridge/.test(text)) {
      throw new CartParseError(
        'missing-header',
        'not a .p8 cart: expected a "pico-8 cartridge ..." header on the first line',
      )
    }
    if (!/^pico-8 cartridge[^\n]*\r?\nversion\s+\d+/.test(text)) {
      throw new CartParseError(
        'missing-version',
        'malformed .p8 cart: expected a "version N" line after the header',
      )
    }

    const markers: { name: string; marker: string; start: number; bodyStart: number }[] = []
    SECTION_MARKER.lastIndex = 0
    for (let m = SECTION_MARKER.exec(text); m !== null; m = SECTION_MARKER.exec(text)) {
      markers.push({
        name: m[1] as string,
        marker: m[0],
        start: m.index,
        bodyStart: m.index + m[0].length,
      })
    }

    const header = markers.length > 0 ? text.slice(0, markers[0]?.start) : text

    const sections: CartSection[] = []
    const seen = new Set<string>()
    for (let i = 0; i < markers.length; i++) {
      const cur = markers[i]
      if (cur === undefined) continue
      if (!KNOWN_SECTIONS.has(cur.name)) {
        throw new CartParseError(
          'unknown-section',
          `unknown .p8 section "__${cur.name}__" (known: ${CART_SECTION_NAMES.map((n) => `__${n}__`).join(', ')})`,
        )
      }
      if (seen.has(cur.name)) {
        throw new CartParseError('duplicate-section', `duplicate .p8 section "__${cur.name}__"`)
      }
      seen.add(cur.name)
      const bodyEnd = markers[i + 1]?.start ?? text.length
      sections.push({
        name: cur.name as CartSectionName,
        marker: cur.marker,
        body: text.slice(cur.bodyStart, bodyEnd),
      })
    }

    return new Cart(header, sections)
  }

  /** The names of the sections present in this cart, in file order. */
  sectionNames(): CartSectionName[] {
    return this.sections.map((s) => s.name)
  }

  /** True if the cart contains the named section. */
  hasSection(name: CartSectionName): boolean {
    return this.sections.some((s) => s.name === name)
  }

  /**
   * Returns the raw body text of a section (everything after the marker line,
   * verbatim including its own newlines), or `undefined` if the section is not
   * present. The gfx/map region helpers build on this.
   */
  getSection(name: CartSectionName): string | undefined {
    return this.sections.find((s) => s.name === name)?.body
  }

  /**
   * Replaces one section's body in place, leaving every other section and the
   * header untouched. If the section is not yet present it is appended (with a
   * `__name__\n` marker in the file's dominant newline style).
   *
   * The body is written verbatim; callers that want a trailing newline must
   * include it. Region-level helpers (gfx/map) go through here.
   */
  setSection(name: CartSectionName, body: string): void {
    const existing = this.sections.find((s) => s.name === name)
    if (existing !== undefined) {
      existing.body = body
      return
    }
    this.sections.push({ name, marker: `__${name}__${this.newline()}`, body })
  }

  /**
   * Serializes the cart back to a `.p8` text blob. For an unmodified cart this
   * is byte-identical to the text it was parsed from.
   */
  serialize(): string {
    let out = this.header
    for (const s of this.sections) {
      out += s.marker + s.body
    }
    return out
  }

  /**
   * The dominant newline style of the file, inferred from the header, used only
   * when APPENDING a brand-new section marker (existing markers keep their own
   * terminator verbatim). Defaults to `\n`.
   */
  private newline(): string {
    return /\r\n/.test(this.header) ? '\r\n' : '\n'
  }
}
