# picopilot carries what incur's MCP transport drops: top-level flags, the config file, and per-call options

incur makes one command definition a CLI and an MCP server, but its MCP transport (checked in 0.4.10 and 0.7.1) runs each tool call with no global flags and without loading the config file. So under `picopilot --mcp`, an incur global such as `--display` and every `picopilot.json` setting (the display mode, `gfx set`'s `allowMapOverlap`) silently did nothing. We decided to keep incur and close the gap in picopilot rather than fork it or drop MCP: the commands keep one definition for both transports, and the gap is three small pieces in `src/cli.ts` and `commands/pico8-env.ts`.

- **Top-level flags are captured before incur parses argv.** `createCli` wraps `serve`: it takes `--display <v>` out of argv wherever it appears (before or after the command name, or next to `--mcp`) and resolves it in the root middleware. On `--mcp` it is the server-wide default for every call.
- **A setting an MCP client should be able to choose per call is a command option, not an incur global.** `display` is an option of the four commands that use it, so it appears in their tool input schemas. Its precedence is per-call option > top-level `--display` > `PICOPILOT_DISPLAY` > `picopilot.json` > `auto`.
- **Under `--mcp`, picopilot loads `picopilot.json` itself** (honouring the server's `--config <path>` and `--no-config`), and the middleware hands the tree to commands as the `mcpConfig` var. An option that can come from the config has NO zod default, so an absent value stays distinguishable and the command falls back to `mcpConfigOption(...)` (then to its real default). `gfx set --allow-map-overlap` follows this; a new config-backed option must too.

## Considered Options

- **Patch or fork incur (rejected for now).** The proper fix (pass globals and config defaults through `Mcp.callTool`) belongs upstream in wevm/incur and is worth proposing; until it lands, a fork is a maintenance burden for three small workarounds.
- **Document "under MCP only the env var works" (rejected).** It was the first answer, but MCP is how agents use picopilot, so a setting that silently does nothing there is the failure this project exists to remove.

## Consequences

- Fixing this showed that `picopilot --mcp` did not start at all on 0.4.10: incur's `^2.0.0-alpha.2` range on `@modelcontextprotocol/server` now resolves to releases that moved `StdioServerTransport`. picopilot moves to incur 0.7.1, which pins a working version and imports the stdio subpath. 0.7.1 defaults MCP to progressive discovery (search and call meta-tools); picopilot sets `mcp.tools.discovery: 'direct'`, one tool per command as before, because its surface is small and the skills name commands directly.
- `src/mcp.process.test.ts` drives a real `picopilot --mcp` over stdio, so these guarantees (and the server starting at all) are tested, not assumed.
