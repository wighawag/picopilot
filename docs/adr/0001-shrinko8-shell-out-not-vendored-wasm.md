# shrinko8 is consumed by shelling out to a user-installed Python `shrinko`, not vendored

picopilot needs shrinko8 for token counting, linting, minification, and cart/PNG conversion. We shell out to a user-installed Python `shrinko` (`uv pip install shrinko`) behind a well-defined adapter seam, and declare it a load-bearing dependency for the code-quality/conversion commands.

## Considered Options

- **Vendor the "WASM build" (rejected).** Verified it is NOT a standalone wasm module but the full Python source running on Pyodide (CPython-on-WASM, ~10MB+, multi-second cold start, and it drags in Pyodide/Pillow version drift). That is too heavy a tax on a tool whose whole pitch is a cheap per-iteration feedback loop.
- **Auto-detect both shell-out and WASM (rejected).** Two code paths and two test matrices for no honest gain once the WASM path was rejected on weight.
- **Port shrinko8 to TS (rejected).** Its tokenizer/minifier/cart-parser track PICO-8 versions; a port would be perpetually stale.

## Consequences

The shrinko dependency is honest (one documented line), not hidden behind a pretend-zero-install. The adapter is an explicit typed seam, so a future native-TS implementation can drop in as a zero-config replacement without touching the command layer.
