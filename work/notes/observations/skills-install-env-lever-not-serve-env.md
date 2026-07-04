# skills-install target is NOT governed by `cli.serve(argv, {env})`

2026-07-04

The picopilot prd + the `picopilot-skills` task state the `--install-skills`
isolation lever is "override the test process's own env via `cli.serve(argv,
{env})`". That is NOT true for incur 0.4.10: `SyncSkills.sync` / the `skills add`
built-in resolve the install target from `os.homedir()` and `process.env`
captured AT MODULE LOAD in `incur/dist/internal/agents.js` (`const home =
os.homedir()`), and `serve`'s `env` DI only feeds the Zod `envSchema` for command
handlers, never `SyncSkills`. The working in-process lever is `global: false` +
`cwd: <temp dir>` (installs under `<cwd>/.agents/skills`), which the task's
acceptance criteria also names ("and/or incur `--no-global` to a temp project
path"). Implemented via that lever; recorded here in case the prd's env-lever
wording is reused by a later task or docs.

Also: incur's `skills add` (0.4.10) has NO `--agent <name>` flag; `--agent` is a
`mcp add` flag only. The prd's VERIFIED note conflates the two.
