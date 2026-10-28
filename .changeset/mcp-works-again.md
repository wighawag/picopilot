---
"picopilot": patch
---

`picopilot --mcp` works again: it failed to start because a dependency of incur moved its stdio transport, so picopilot now uses incur 0.7.1 (one MCP tool per command, as before). Settings now reach MCP tool calls too: `picopilot.json` (the display mode, `gfx set`'s `allowMapOverlap`) is loaded by picopilot itself under `--mcp`, honouring the server's `--config` / `--no-config`; `picopilot --mcp --display <mode>` sets the server-wide display mode; and `display` is an argument of the `run`, `audio_record`, `audio_render` and `doctor` tools. On the command line, `--display` still works before or after the command name.
