# Root `pnpm format:check` is broken: prettier-plugin-svelte not resolvable at repo root

Spotted: 2026-07-06, running the repo-root gate before committing a skills change.

## Symptom

`pnpm format:check` (root) fails with:

```
[error] Cannot find package 'prettier-plugin-svelte' imported from <repo>/noop.js
 ELIFECYCLE  Command failed with exit code 1.
```

It also `[warn]`s on `showcase/fliprun/make-label.mjs` (a parser/plugin miss), but the hard `[error]` is the svelte plugin.

## Cause

The new `website/` package (added in the website/logo/showcase commits, e1d61f6..d3bd0f1) declares `prettier-plugin-svelte: ^3.4.1` in `website/package.json` and the root prettier config now resolves it, but the plugin is only installed under `website/node_modules`, NOT hoisted to the repo-root `node_modules` (absent there). So the root prettier invocation cannot import it and the whole `format:check` aborts before checking any file.

## Impact

The repo-root acceptance gate (`pnpm format:check && pnpm build && pnpm test`) cannot go green as-is: format:check errors out for a dependency-resolution reason, independent of any file's actual formatting. `pnpm build` and `pnpm test` are unaffected (467 tests pass). Individual files check fine via `npx prettier --check <file>` (the plugin is only needed for `.svelte` files).

## RESOLVED (2026-07-07)

Fixed by scoping, matching the repo's own pattern that root package operations exclude the website workspace (`build`/`test`/`dev` all `--filter './packages/*'`; website has its own `website:*` scripts and its own `format`/`format:check`). Added `website/` to root `.prettierignore` so root `prettier --check .` no longer descends into `website/` and picks up its svelte-plugin config. The website formats itself via its own `format` script where the plugins resolve. Also fixed a genuine style issue in `showcase/fliprun/make-label.mjs` (a plain `.mjs`, no plugin needed) that the same run surfaced. Root gate now green: `format:check` + `build` + 467 tests all pass.
