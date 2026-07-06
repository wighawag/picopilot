/**
 * The detached daemon process ENTRY (ADR-0011, prd US #6). `playtest start`
 * spawns this file (via `process.execPath [+ execArgv] <this> <configJson>`, so
 * it re-uses the exact loader the parent ran under, dev `tsx` or built `dist`) as
 * a DETACHED background process that owns the live driven PICO-8 for the session's
 * lifetime. It just decodes its JSON config and hands off to {@link daemonMain};
 * all the logic lives in `session-daemon-main.ts` (so it stays unit-testable).
 */

import {daemonMain} from './session-daemon-main.js';

daemonMain(process.argv.slice(2));
