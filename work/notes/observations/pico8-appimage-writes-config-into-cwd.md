---
title: The PICO-8 AppImage writes config.txt / sdl_controllers.txt / log.txt / backup/ into the CWD when launched without -home/-root_path
slug: pico8-appimage-writes-config-into-cwd
spotted: 2026-07-06
---

Noticed while live-testing `picopilot playtest` from the repo root: launching the PICO-8 AppImage (`pico8 -desktop <tmp> -x <cart>`) with no `-home`/`-root_path` makes it write its config home into the CURRENT directory (`config.txt`, `sdl_controllers.txt`, `log.txt`, `activity_log.txt`, a `backup/` with `last_run.p8`, plus `carts/`/`bbs/`/`cdata/`/`cstore/`/`plates/`). These are runtime debris that land untracked in the working tree and would be swept into a `git add -A`. The `run`/`audio record`/`playtest` shared-write discipline steers SCREENSHOTS/WAVs (`-desktop`/`-root_path`) but does not pin PICO-8's config home, so a live run from any project dir can litter it. Possible fix (out of scope here): pass `-home <tmp>` (or `-root_path`) on every launch so PICO-8's config/log also land in an isolated dir, not the user's cwd. Flagging as a signal; not fixing in the one-shot-drive-capture task.

## RESOLVED (2026-07-07)

Fixed at the source: every PICO-8 spawn now prepends `-home <isolated tmp dir>`. Added `pico8HomeDir()` + `withPico8Home()` in `engine/pico8/shell.ts` (one throwaway dir per process under the OS temp dir, created lazily, reused) and applied it in `orchestrate` (covers run/drive/export/record) and in `session-daemon-main` (the live playtest session). Verified against the real binary: with `-home` set, the whole config/data tree lands in the temp dir and the CWD stays clean; an end-to-end `picopilot run brand/logo.p8` from the repo root now leaves ZERO junk in the tree. The root `.gitignore` entries stay as belt-and-suspenders but should no longer ever trigger.
