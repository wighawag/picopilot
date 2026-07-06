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

## Likely fix (not applied here — flagging, not papering over)

A root `pnpm install` to hoist/link `prettier-plugin-svelte` into root `node_modules`, or move the plugin to a root devDependency, or scope the svelte prettier plugin config to the website workspace so the root run does not require it. Needs a decision by whoever owns the website package + the root format config; not fixed in the skills change that surfaced it (that change's own files are prettier-clean, verified per-file).
