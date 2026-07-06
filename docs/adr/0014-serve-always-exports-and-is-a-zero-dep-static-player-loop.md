# `picopilot serve` ALWAYS exports first and serves over a zero-dep static server

`picopilot serve <cart>` is the "play this cart in a browser" loop: it takes a CART path (not a pre-built dir), ALWAYS runs the standalone export first into an isolated temp dir, then serves that dir over a minimal, zero-dependency `node:http` static file server and prints the local URL. It exists to close the fast round-trip (cart to playable page) with no extra dependency; a real browser is where the game actually plays, so `serve` is distinct from `run` (native headless capture) and from `export` (which PRODUCES a bundle at a chosen dest for the showcase).

## Considered Options

- **`serve <dir>` over a pre-built export (rejected).** Making the user export separately, then serve a directory, is two steps for the common "let me just play this cart" case. Since `serve`'s whole point is the round-trip, it takes a cart and always exports; the standalone bundle it plays is the same one `export` produces.
- **Add a static-server dependency (e.g. `sirv`, `serve`) (rejected).** A ~40-line `node:http` handler (resolve `/` to `index.html`, a path-traversal guard, a small MIME map, stream the file) is enough to PLAY an export locally and keeps the package lean, consistent with the repo's minimal-dependency posture. It is deliberately not a production server.

## Consequences

- **`serve` hard-requires PICO-8** (because it always exports), returning the same structured `pico8-not-found` value + nonzero exit as `run`/`export` when absent, and never binding a socket if the export fails. Absence is the CI-testable boundary via injected adapter + server-factory seams (the fake server never opens a real socket).
- **No `~/Desktop` / user-path pollution, and no temp leak.** The export lands in a fresh `mkdtemp(os.tmpdir())` dir, never a user path. It is removed immediately on any early error, and on the serving path a one-shot cleanup (injected `CleanupRegistrar`, defaulting to `process` SIGINT/SIGTERM/exit handlers) reaps it when the long-lived server is interrupted (verified: the dir is gone after a real SIGTERM).
- The server binds `127.0.0.1` only, resolves `/` to `index.html`, guards path traversal against the root, and serves `.html`/`.js`/`.wasm`/`.png` with correct content types (verified end-to-end against a real PICO-8 export: `/` returns the 42 KB html, `/index.js` the 1.67 MB runtime, `../../etc/passwd` returns 404). `--port 0` yields an OS-assigned free port, reported back in the URL.
