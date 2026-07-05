#!/usr/bin/env bash
# Playability lint for a game-jam entry (catches the "invisible player" class).
#
# Greps the cart's Lua for referenced sprite ids (spr(N), sspr(N)) and asserts
# each referenced __gfx__ slot is NON-EMPTY, and for sfx(N)/music(P) warns if the
# slot is empty (silence is legal, so a warning not a failure). Emits findings to
# stdout and a machine-readable summary line `PLAYABLE-CHECK: ok|issues <n>`.
#
# Usage: check-playable.sh <picopilot-bin> [workdir] [main.lua]
set -uo pipefail
PP="$1"; WD="${2:-.}"; LUA="${3:-$WD/main.lua}"
cd "$WD" || { echo "no workdir $WD"; exit 2; }
[ -f "$LUA" ] || { echo "PLAYABLE-CHECK: issues 1"; echo "- no main.lua found ($LUA)"; exit 0; }

issues=0
is_empty_sprite() { # $1 = sprite id -> echoes "empty" or "ok"
  local g
  g="$(node "$PP" gfx show "$1" 2>/dev/null | grep -o '"[.0-9a-fA-F\\n]*"' | head -1)"
  if [ -z "$g" ]; then echo "unknown"; return; fi
  # empty iff it contains no hex digit (only dots + \n + quotes)
  if echo "$g" | grep -qE '[0-9a-fA-F]'; then echo "ok"; else echo "empty"; fi
}

# Collect referenced sprite ids from spr( and sspr( calls (first numeric arg).
sprite_ids="$(grep -oE '\b(spr|sspr)\s*\(\s*[0-9]+' "$LUA" 2>/dev/null | grep -oE '[0-9]+$' | sort -un)"
for id in $sprite_ids; do
  # ignore ids > 255 (not a sprite) and the map/tile usage
  [ "$id" -gt 255 ] && continue
  case "$(is_empty_sprite "$id")" in
    empty)
      echo "- INVISIBLE: the code calls spr($id) but sprite $id is EMPTY (all-transparent). Draw it with: node $PP gfx set $id \"<grid>\" (else the player/entity is invisible)."
      issues=$((issues+1)) ;;
  esac
done

# sfx/music referencing empty slots -> WARN only (silence is legal).
sfx_ids="$(grep -oE '\bsfx\s*\(\s*[0-9]+' "$LUA" 2>/dev/null | grep -oE '[0-9]+$' | sort -un)"
if [ -n "$sfx_ids" ]; then
  sfxbody="$(sed -n '/__sfx__/,/__music__/p' main.p8 2>/dev/null | grep -vE '^__')"
  for id in $sfx_ids; do
    [ "$id" -gt 63 ] && continue
    row="$(echo "$sfxbody" | sed -n "$((id+1))p")"
    # empty sfx row: header + all-zero notes (no non-zero after the 8-char header)
    if [ -z "$row" ] || ! echo "${row:8}" | grep -qE '[1-9a-f]'; then
      echo "- (warn) sfx($id) is called but SFX slot $id is empty (silent). Author it with sfx from-mml if you want sound."
    fi
  done
fi

if [ "$issues" -gt 0 ]; then
  echo "PLAYABLE-CHECK: issues $issues"
else
  echo "PLAYABLE-CHECK: ok"
fi
exit 0
