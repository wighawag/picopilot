import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Cli, z } from 'incur'

import { Cart, CartParseError, GfxSheet, spriteAliasesMap } from '../engine/cart/index.js'
import { decideOverlap, GfxGridError, gridToNibbles, nibblesToGrid } from '../engine/gfx/index.js'

/**
 * The exit code for the `map-overlap` refusal. Chosen as 1 (a plain failure),
 * matching every other picopilot structured refusal (`cart-not-found`,
 * `already-initialised`, `verify-failed`): the refusal is a "you asked for
 * something I won't do" failure, not a distinct capability-gap the way `verify`'s
 * `gate-incapable` (exit 2) is. What makes it safe is not a special exit code
 * but that it is NON-ZERO (an agent must not read it as done) AND the sprite's
 * bytes are left untouched.
 */
export const MAP_OVERLAP_EXIT = 1

/** Resolves a cart argument to an absolute path (relative to cwd). */
function resolveCart(cart: string): string {
  return isAbsolute(cart) ? cart : resolve(process.cwd(), cart)
}

/**
 * Loads + parses a cart from `cartPath`, returning either the parsed cart and
 * its source text or a structured reason the caller turns into an `error(...)`.
 * Keeps the fs + parse boilerplate out of both command handlers.
 */
function loadCart(
  cartPath: string,
): { ok: true; cart: Cart; text: string } | { ok: false; code: string; message: string } {
  if (!existsSync(cartPath)) {
    return { ok: false, code: 'cart-not-found', message: `no cart at ${cartPath}` }
  }
  const text = readFileSync(cartPath, 'utf8')
  try {
    return { ok: true, cart: Cart.parse(text), text }
  } catch (e) {
    if (e instanceof CartParseError) {
      return {
        ok: false,
        code: 'cart-parse-failed',
        message: `cart at ${cartPath} does not parse (${e.code}): ${e.message}`,
      }
    }
    throw e
  }
}

/**
 * Builds the `gfx` command group: `gfx show` (read a sprite as a char grid) and
 * `gfx set` (write a char grid back into `__gfx__`, with the map-overlap
 * smart-refuse). Returned as its own `Cli` so it mounts under the root as a
 * group, which also gives the `gfx.set.options.allowMapOverlap` config path its
 * `picopilot.json` reads through (incur keys config by command path).
 */
function buildGfxGroup(): Cli.Cli {
  const gfx = Cli.create('gfx', {
    description: 'Read and write sprites as a readable char grid (the pixel-art EDIT surface).',
  })

  gfx.command('show', {
    description:
      'Render a sprite from __gfx__ into a readable char grid (. = transparent, 0-f = the 16 colours). CTAs to `gfx set`.',
    args: z.object({
      sprite: z.coerce.number().int().min(0).max(255).describe('The sprite index 0-255 to render.'),
      cart: z
        .string()
        .default('main.p8')
        .describe('The .p8 cart to read. Defaults to main.p8 in the current folder.'),
    }),
    output: z.object({
      sprite: z.number().describe('The sprite index that was rendered.'),
      grid: z
        .string()
        .describe('The char grid: 8 lines of 8 chars, . = transparent, 0-f = colours 1-15.'),
      aliasesMap: z
        .boolean()
        .describe('True for sprites 128-255, which alias the shared map region (see `gfx set`).'),
    }),
    examples: [
      { description: 'Show sprite 1 of main.p8', args: { sprite: 1 } },
      { description: 'Show sprite 3 of a specific cart', args: { sprite: 3, cart: 'game.p8' } },
    ],
    run({ args, error, ok }) {
      const cartPath = resolveCart(args.cart)
      const loaded = loadCart(cartPath)
      if (!loaded.ok) {
        return error({ code: loaded.code, message: loaded.message, exitCode: 1 })
      }

      const sheet = GfxSheet.fromBody(loaded.cart.getSection('gfx'))
      const grid = nibblesToGrid(sheet.getSprite(args.sprite))

      // The read → fix → write loop: `gfx show` always CTAs to `gfx set` so an
      // agent that sees a broken sprite is led straight to the edit surface.
      return ok(
        {
          sprite: args.sprite,
          grid,
          aliasesMap: spriteAliasesMap(args.sprite),
        },
        {
          cta: {
            description: 'Edit the grid, then write it back with:',
            commands: [
              {
                command: `gfx set ${args.sprite}`,
                description: 'Write an edited char grid back into __gfx__.',
              },
            ],
          },
        },
      )
    },
  })

  gfx.command('set', {
    description:
      'Write a char grid back into a sprite in __gfx__. Sprites 128-255 alias the shared map region: a write that would clobber existing data is refused unless authorised (--allow-map-overlap / allowMapOverlap config).',
    args: z.object({
      sprite: z.coerce.number().int().min(0).max(255).describe('The sprite index 0-255 to write.'),
      grid: z
        .string()
        .describe('The char grid: 8 lines of 8 chars, . = transparent, 0-f = colours 1-15.'),
      cart: z
        .string()
        .default('main.p8')
        .describe('The .p8 cart to write. Defaults to main.p8 in the current folder.'),
    }),
    options: z.object({
      allowMapOverlap: z
        .boolean()
        .default(false)
        .describe(
          'Authorise overwriting existing shared-region data when writing sprites 128-255 (ADR-0004). Also settable as allowMapOverlap in picopilot.json.',
        ),
    }),
    output: z.object({
      sprite: z.number().describe('The sprite index that was written.'),
      cart: z.string().describe('The absolute path of the cart that was written.'),
      aliasesMap: z
        .boolean()
        .describe('True for sprites 128-255, which alias the shared map region.'),
      overwroteSharedData: z
        .boolean()
        .describe('True when this write overwrote existing shared-region data (authorised).'),
      note: z
        .string()
        .optional()
        .describe('An advisory note (e.g. the shared-region aliasing) when relevant.'),
    }),
    examples: [
      {
        description: 'Write an edited grid into sprite 1',
        args: {
          sprite: 1,
          grid: '........\n........\n........\n........\n........\n........\n........\n........',
        },
      },
    ],
    run({ args, options, error, ok }) {
      const cartPath = resolveCart(args.cart)

      // Decode the incoming grid FIRST: a malformed grid is a caller error and
      // must never touch the cart. (No bytes change on a bad grid.)
      let nibbles: number[][]
      try {
        nibbles = gridToNibbles(args.grid)
      } catch (e) {
        if (e instanceof GfxGridError) {
          return error({
            code: 'invalid-grid',
            message: `the char grid is malformed: ${e.message}`,
            exitCode: 1,
          })
        }
        throw e
      }

      const loaded = loadCart(cartPath)
      if (!loaded.ok) {
        return error({ code: loaded.code, message: loaded.message, exitCode: 1 })
      }

      const sheet = GfxSheet.fromBody(loaded.cart.getSection('gfx'))

      // The overlap decision reads the target sprite's CURRENT __gfx__ pixels
      // (the shared-bank bytes at risk), NOT __map__ (ADR-0004). The flag and
      // the picopilot.json config both feed `options.allowMapOverlap` (incur
      // resolves argv > config > default), so both authorisation paths converge
      // here.
      const decision = decideOverlap(sheet, args.sprite, options.allowMapOverlap)

      if (decision.kind === 'refused') {
        // The silent-corruption guard: REFUSE and DO NOT write. The cart file is
        // never opened for writing on this path, so the sprite's __gfx__ bytes
        // stay byte-identical. Structured envelope (code + detail + remedy) with
        // a nonzero exit so an agent stops rather than treating exit-0 as done.
        return error({
          code: 'map-overlap',
          message: `sprite ${args.sprite} aliases the shared map region and its current __gfx__ pixels hold data (${decision.nonZeroPixels} non-zero); refusing to silently overwrite it. Remedy: pass --allow-map-overlap, set allowMapOverlap in picopilot.json, or target a sprite 0-127.`,
          exitCode: MAP_OVERLAP_EXIT,
          cta: {
            description: 'To proceed anyway (this overwrites the shared data):',
            commands: [
              {
                command: `gfx set ${args.sprite} --allow-map-overlap`,
                description: 'Re-run authorising the shared-region overwrite.',
              },
            ],
          },
        })
      }

      // Allowed: write the sprite and persist. Preserve every other section by
      // committing through the cart model (only __gfx__ changes).
      sheet.setSprite(args.sprite, nibbles)
      sheet.commit(loaded.cart)
      writeFileSync(cartPath, loaded.cart.serialize())

      const overwroteSharedData =
        decision.kind === 'allowed-shared' && decision.reason === 'authorised'
      const note =
        decision.kind === 'allowed-shared'
          ? decision.reason === 'authorised'
            ? `sprite ${args.sprite} aliases the shared map region; overwrote existing shared data (authorised).`
            : `sprite ${args.sprite} aliases the shared map region; it was empty, so the write is safe.`
          : undefined

      return ok({
        sprite: args.sprite,
        cart: cartPath,
        aliasesMap: spriteAliasesMap(args.sprite),
        overwroteSharedData,
        note,
      })
    },
  })

  return gfx
}

/**
 * Registers the `gfx` command group (`gfx show` / `gfx set`) on the root CLI.
 *
 * `gfx` is a shrinko-FREE command group (ADR-0002): it reads/writes `__gfx__`
 * entirely through the cart model + the TS char-grid codec, so it works with
 * shrinko absent and never spawns a child process. `gfx set` carries the
 * gfx/map overlap smart-refuse (ADR-0004): a write to a shared-bank sprite
 * (128-255) whose current pixels hold data is refused unless authorised, so
 * picopilot never SILENTLY destroys shared-region data.
 */
export function registerGfx(cli: Cli.Cli): void {
  cli.command(buildGfxGroup())
}
