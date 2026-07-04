import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { type Cli, z } from 'incur'
import { scaffoldFiles } from '../engine/scaffold/index.js'

/**
 * Registers `picopilot init`, the scaffolder that turns a fresh folder into an
 * agent-ready PICO-8 cart (US #1, #2).
 *
 * INSTRUCT-not-mutate (US #2): by default `init` writes ONLY inside the target
 * cart folder, the `main.p8` (`__lua__` = `#include main.lua`), the editable
 * `main.lua`, the curated `AGENTS.md` reference, and `picopilot.json`. It does
 * NOT run `git init` and does NOT write to shared agent skill dirs; it PRINTS a
 * skills-discovery tip and a `git init` tip instead. The global skills install
 * is the opt-in `init --install-skills`, a SEPARATE task, so the default is a
 * good citizen of `~/.claude` / agent dirs and of the user's VCS choice.
 */
export function registerInit(cli: Cli.Cli): void {
  cli.command('init', {
    description:
      'Scaffold an agent-ready PICO-8 cart (main.p8 + main.lua + AGENTS.md + picopilot.json).',
    args: z.object({
      dir: z
        .string()
        .default('.')
        .describe('Target cart folder (created if missing). Defaults to the current directory.'),
    }),
    output: z.object({
      dir: z.string().describe('The absolute path of the scaffolded cart folder.'),
      files: z.array(z.string()).describe('The cart-relative names of the files written.'),
      tips: z
        .array(z.string())
        .describe('One-line next-step tips (skills discovery + git init). NOT actions init took.'),
    }),
    examples: [
      { description: 'Scaffold in the current folder' },
      { description: 'Scaffold into a new folder', args: { dir: 'my-game' } },
    ],
    run({ args, error }) {
      const targetDir = isAbsolute(args.dir) ? args.dir : resolve(process.cwd(), args.dir)

      const files = scaffoldFiles()

      // Refuse rather than clobber: `init` is for a fresh cart. Overwriting an
      // existing main.p8/main.lua would silently destroy the agent's work, so a
      // pre-existing scaffold file is a structured refusal, not a surprise write.
      const clash = files.find((f) => existsSync(join(targetDir, f.name)))
      if (clash !== undefined) {
        return error({
          code: 'already-initialised',
          message: `refusing to overwrite existing ${clash.name} in ${targetDir}; init is for a fresh cart folder`,
          exitCode: 1,
        })
      }

      mkdirSync(targetDir, { recursive: true })
      for (const f of files) {
        writeFileSync(join(targetDir, f.name), f.content)
      }

      // INSTRUCT, do not mutate: these are printed tips, not actions init took.
      const tips = [
        "Skills: make your agent discover picopilot's skills with `npx picopilot skills add` (or symlink them yourself); run `picopilot init --install-skills` to install them globally.",
        'Version control: this folder is not a git repo. Run `git init` yourself if you want one. `init` deliberately does not touch VCS.',
      ]

      return {
        dir: targetDir,
        files: files.map((f) => f.name),
        tips,
      }
    },
  })
}
