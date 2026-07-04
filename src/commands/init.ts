import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { type Cli, z } from 'incur'
import { scaffoldFiles } from '../engine/scaffold/index.js'
import {
  type InstallSkillsOptions,
  type InstallSkillsResult,
  installSkills,
} from '../engine/skills/index.js'

/**
 * Injects the skills installer `init --install-skills` calls (defaults to the
 * real {@link installSkills}). This is the shared-write isolation SEAM, mirroring
 * how `tokens`/`verify` inject their shrinko adapter: a test passes an installer
 * that redirects the target to a temp dir (via `global: false` + a temp `cwd`),
 * so the load-bearing install test can assert the real agent skill dirs are
 * byte-untouched without ever performing a real global write.
 */
export type SkillsInstaller = (options: InstallSkillsOptions) => Promise<InstallSkillsResult>

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
 *
 * The opt-in `init --install-skills` (US #2, #20) IS the shared write: it runs
 * incur's skills install (which defaults to a GLOBAL write into `~/.agents/skills`
 * + detected agent dirs) so the discipline skills are auto-discovered. It is the
 * only picopilot path that touches a shared location, so the installer is an
 * injected seam and its target is fully redirectable for isolation-testing.
 *
 * @param installer injects the skills installer (defaults to the real global
 *   install); tests pass one that redirects the target to a temp dir.
 */
export function registerInit(cli: Cli.Cli, installer: SkillsInstaller = installSkills): void {
  cli.command('init', {
    description:
      'Scaffold an agent-ready PICO-8 cart (main.p8 + main.lua + AGENTS.md + picopilot.json).',
    args: z.object({
      dir: z
        .string()
        .default('.')
        .describe('Target cart folder (created if missing). Defaults to the current directory.'),
    }),
    options: z.object({
      installSkills: z
        .boolean()
        .default(false)
        .describe(
          "Opt in to INSTALLING picopilot's skills into your agent's skill dirs (a GLOBAL write). Default off: init only PRINTS how to discover them.",
        ),
      global: z
        .boolean()
        .default(true)
        .describe(
          'With --install-skills, install GLOBALLY (default). Pass --no-global to install into THIS project (./.agents/skills) instead.',
        ),
    }),
    output: z.object({
      dir: z.string().describe('The absolute path of the scaffolded cart folder.'),
      files: z.array(z.string()).describe('The cart-relative names of the files written.'),
      tips: z
        .array(z.string())
        .describe('One-line next-step tips (skills discovery + git init). NOT actions init took.'),
      installedSkills: z
        .array(z.string())
        .optional()
        .describe('Skills installed by --install-skills (absent unless the flag was passed).'),
      wiredAgents: z
        .array(z.string())
        .optional()
        .describe('Agents whose skill dirs --install-skills wired up (absent unless flagged).'),
    }),
    examples: [
      { description: 'Scaffold in the current folder' },
      { description: 'Scaffold into a new folder', args: { dir: 'my-game' } },
      {
        description: "Scaffold and install picopilot's skills globally",
        options: { installSkills: true },
      },
    ],
    async run({ args, options, error }) {
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

      // Default init is INSTRUCT-not-mutate: it never touches a shared dir. Only
      // the explicit --install-skills opt-in performs the shared write.
      if (!options.installSkills) {
        return {
          dir: targetDir,
          files: files.map((f) => f.name),
          tips,
        }
      }

      // The one shared write: install picopilot's skills. A project install
      // (--no-global) lands under this cart folder; a global install lands in
      // the real agent skill dirs. Failures surface structured, not as a crash,
      // so the scaffold that already succeeded is not masked by an install slip.
      let install: InstallSkillsResult
      try {
        install = await installer({
          cli,
          global: options.global,
          cwd: options.global ? undefined : targetDir,
        })
      } catch (e) {
        return error({
          code: 'install-skills-failed',
          message: `scaffold succeeded in ${targetDir}, but installing skills failed: ${
            e instanceof Error ? e.message : String(e)
          }. Discover them manually instead: run \`picopilot skills add\` or symlink the skills yourself.`,
          exitCode: 1,
        })
      }

      // Printed-instructions fallback (US #2): if no known non-universal agent
      // was detected, the canonical `.agents/skills` install still happened (the
      // universal-agent path), but a specific agent may not read it, so tell the
      // user how to wire it manually rather than pretending every agent is set.
      const wiredAgents = install.agents.map((a) => a.agent)
      const fallbackTip =
        wiredAgents.length === 0
          ? `Installed to ${install.paths[0] ?? '.agents/skills'}. No known agent skill dir was detected to wire directly; if your agent does not auto-discover .agents/skills, symlink these skills into its skills dir.`
          : `Wired agents: ${wiredAgents.join(', ')}.`

      return {
        dir: targetDir,
        files: files.map((f) => f.name),
        tips: [...tips, `Skills installed: ${install.skills.join(', ')}. ${fallbackTip}`],
        installedSkills: install.skills,
        wiredAgents,
      }
    },
  })
}
