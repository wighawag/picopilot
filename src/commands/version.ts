import { type Cli, z } from 'incur'
import { VERSION } from '../version.js'

/**
 * Registers the trivial `version` command onto the given CLI (or command group).
 *
 * This is the skeleton's proof-of-life command: it exercises the full incur
 * pipeline (output schema, the structured envelope, TOON-by-default and `--json`
 * formatting) with no engine dependencies, so the `verify` gate has something
 * real to build and test. Later command groups mount alongside it via their own
 * `register*` helpers, called from `createCli`.
 */
export function registerVersion(cli: Cli.Cli): void {
  cli.command('version', {
    description: 'Print the picopilot version.',
    output: z.object({
      name: z.string().describe('The tool name.'),
      version: z.string().describe('The installed picopilot version.'),
    }),
    run() {
      return { name: 'picopilot', version: VERSION }
    },
  })
}
