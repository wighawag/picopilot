/**
 * The PICO-8 engine seam: launch + capture over the user's PICO-8 binary
 * (ADR-0006, native `pico8 -x` path). Barrel re-export so the command layer and
 * later PICO-8-gated features (`audio render`, `export`) import from one place.
 *
 * - `adapter`:  the `Pico8Adapter` interface, `Pico8Result`, the structured
 *               `pico8-not-found` value, and the run-report shapes.
 * - `sentinel`: the pure sentinel-watch core (CI-testable without the binary).
 * - `shell`:    the v1 adapter shelling out to native `pico8 -x`, with an
 *               injectable spawn seam for isolation-testing.
 */
export * from './adapter.js';
export * from './harness.js';
export * from './sentinel.js';
export * from './shell.js';
