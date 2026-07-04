import type { Cli } from 'incur'
import { createCli } from './cli.js'

export { createCli } from './cli.js'
export { VERSION } from './version.js'

/**
 * The default CLI instance, exported for `incur gen` (typed CTAs) and for
 * embedding picopilot as a Fetch API handler / MCP server.
 */
const cli: Cli.Cli = createCli()

export default cli
