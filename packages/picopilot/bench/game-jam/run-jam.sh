#!/usr/bin/env bash
# picopilot game-jam benchmark harness.
#
# Gives a `pi` agent a THEME + a TIME BUDGET, drives it fully autonomously in a
# turn-loop, STEERS it with "time remaining" reminders between turns (no
# subagent tool, no interrupt: pure `pi` session continuation), and at the
# deadline captures objective Tier-0/1 playability artifacts + runs a judge.
#
# Usage:
#   ./run-jam.sh [--theme <t>] [--minutes <n>] [--model <m>] [--workdir <dir>] [--no-judge]
#
# Defaults: a random theme from themes.txt, 50 minutes, an isolated temp workdir.
# Prints a results summary and leaves everything under the workdir.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PICOPILOT_BIN="$(cd "$HERE/../../dist" && pwd)/bin.js"

THEME=""
MINUTES=50
MODEL=""
WORKDIR=""
DO_JUDGE=1
# Steering thresholds: fractions of the budget ELAPSED at which to inject a
# "time remaining" reminder between turns. Tuned to nudge toward a playable
# slice early, then triage, then stop-polishing.
STEER_AT_FRAC=(0.25 0.5 0.75 0.9 0.97)

while [ $# -gt 0 ]; do
  case "$1" in
    --theme) THEME="$2"; shift 2 ;;
    --minutes) MINUTES="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --no-judge) DO_JUDGE=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v pi >/dev/null || { echo "FATAL: 'pi' not on PATH" >&2; exit 1; }
[ -f "$PICOPILOT_BIN" ] || { echo "FATAL: picopilot not built ($PICOPILOT_BIN). Run pnpm build." >&2; exit 1; }

# Pick a theme if not given.
if [ -z "$THEME" ]; then
  THEME="$(grep -vE '^\s*(#|$)' "$HERE/themes.txt" | shuf -n1)"
fi

SLUG="$(echo "$THEME" | tr ' A-Z' '-a-z' | tr -cd 'a-z0-9-')"

# Workdir: a PERSISTENT, named dir under bench/out/ (so entries are never lost
# and runs are comparable), unless the caller overrides it.
if [ -z "$WORKDIR" ]; then
  WORKDIR="$HERE/../out/${SLUG}-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$WORKDIR/bench-artifacts"
WORKDIR="$(cd "$WORKDIR" && pwd)"
ART="$WORKDIR/bench-artifacts"

# Resolve the PICO-8 binary so `picopilot playtest`/`run` can find it. picopilot
# reads PICO8_PATH (else `pico8` on PATH), so export a resolved path for the
# capture subprocesses; a missing binary surfaces as the structured
# pico8-not-found, not a crash.
if [ -z "${PICO8_PATH:-}" ]; then
  if [ -x "$HOME/.AppImages/pico-8/pico8" ]; then
    PICO8_PATH="$HOME/.AppImages/pico-8/pico8"
  else
    PICO8_PATH="$(command -v pico8 2>/dev/null || echo pico8)"
  fi
  export PICO8_PATH
fi

SID="jam-${SLUG}-$(date +%s)"
MODEL_ARGS=()
[ -n "$MODEL" ] && MODEL_ARGS=(--model "$MODEL")

echo "=================================================================="
echo " picopilot GAME JAM  |  theme: '$THEME'  |  budget: ${MINUTES}m"
echo " workdir: $WORKDIR"
echo " session: $SID"
echo "=================================================================="

# Build the initial jam prompt (substitute theme / minutes / picopilot path).
PROMPT="$(sed -e "s|__THEME__|$THEME|g" -e "s|__MINUTES__|$MINUTES|g" -e "s|__PICOPILOT__|$PICOPILOT_BIN|g" "$HERE/prompt.md")"

START=$(date +%s)
DEADLINE=$(( START + MINUTES * 60 ))
mins_left() { echo $(( (DEADLINE - $(date +%s) + 59) / 60 )); }
secs_left() { echo $(( DEADLINE - $(date +%s) )); }

# The per-turn time budget for a single `pi` invocation. We cap each turn so the
# harness regains control to steer + to enforce the deadline. The agent keeps
# working across turns via session continuation.
TURN_CAP_SECS=420   # 7 min max per turn (steer points are finer-grained than this via elapsed checks)

# Session file locator (pi writes under ~/.pi/agent/sessions/<proj>/<ts>_<id>.jsonl).
find_session() { grep -rl "$SID" "$HOME/.pi/agent/sessions/" 2>/dev/null | head -1; }

run_turn() { # $1 = message; runs one bounded pi turn in the workdir
  local msg="$1" sfile
  sfile="$(find_session)"
  ( cd "$WORKDIR"
    if [ -z "$sfile" ]; then
      timeout "$TURN_CAP_SECS" pi -p --session-id "$SID" "${MODEL_ARGS[@]}" --approve "$msg"
    else
      timeout "$TURN_CAP_SECS" pi -p --session "$sfile" "${MODEL_ARGS[@]}" --approve "$msg"
    fi
  ) 2>&1 | tail -40
}

# --- The jam loop: initial brief, then steer between turns until the deadline ---
echo ">>> [t=0] launching the agent on the jam..."
run_turn "$PROMPT"

declare -A FIRED
for frac in "${STEER_AT_FRAC[@]}"; do FIRED["$frac"]=0; done

while [ "$(secs_left)" -gt 0 ]; do
  elapsed=$(( $(date +%s) - START ))
  frac_elapsed=$(awk "BEGIN{print $elapsed/($MINUTES*60)}")
  # Find the next steer threshold we have crossed but not yet fired.
  msg=""
  for frac in "${STEER_AT_FRAC[@]}"; do
    if [ "${FIRED[$frac]}" = "0" ] && awk "BEGIN{exit !($frac_elapsed >= $frac)}"; then
      FIRED["$frac"]=1
      ml=$(mins_left)
      if awk "BEGIN{exit !($frac >= 0.9)}"; then
        msg="TIME REMAINING: ~${ml} minute(s). STOP adding features NOW. Make sure main.p8 BOOTS and is PLAYABLE (responds to input, has a goal/win-lose). Run \`node $PICOPILOT_BIN verify\` and \`node $PICOPILOT_BIN run\` to confirm, then finalise JAM.md. A rough playable game scores; a broken one scores zero."
      else
        msg="TIME REMAINING: ~${ml} minute(s) of ${MINUTES}. Checkpoint: is main.p8 a PLAYABLE vertical slice right now? If not, cut scope and get there before polishing. Keep \`verify\` green."
      fi
      break
    fi
  done
  if [ -n "$msg" ]; then
    echo ">>> [t=${elapsed}s, ~$(mins_left)m left] STEERING the agent..."
    run_turn "$msg"
  else
    # No new steer point; give the agent a plain continue turn to keep working.
    echo ">>> [t=${elapsed}s, ~$(mins_left)m left] continue..."
    run_turn "Keep going on the jam. ~$(mins_left) minute(s) left."
  fi
done

echo ">>> [DEADLINE] time is up. Capturing the entry..."

# --- Tier-0/1 objective capture (playability, automated) ---
cd "$WORKDIR"
HAVE_CART=0; [ -f main.p8 ] && HAVE_CART=1
echo "{\"haveCart\": $HAVE_CART, \"theme\": \"$THEME\", \"minutes\": $MINUTES}" > "$ART/entry.json"

if [ "$HAVE_CART" = "1" ]; then
  echo ">>> verify (static gate)..."
  node "$PICOPILOT_BIN" verify --format json > "$ART/verify.json" 2>&1 || true
  node "$PICOPILOT_BIN" tokens --format json > "$ART/tokens.json" 2>&1 || true

  # Auto-instrument a COPY of the cart so the judge ALWAYS gets gameplay
  # screenshots, even if the entry did not self-screenshot. We force the cart
  # toward its play state and shoot a few frames, then discard the copy (the
  # entry's own main.p8 is untouched).
  instrument_and_run() { # $1 = input-string-or-empty, $2 = shotdir
    local input="$1" shotdir="$2" tmp="$ART/_probe"
    rm -rf "$tmp"; mkdir -p "$tmp" "$shotdir"
    cp main.p8 "$tmp/main.p8" 2>/dev/null
    [ -f main.lua ] && cp main.lua "$tmp/main.lua"
    cat >> "$tmp/main.lua" <<'LUA'

-->8
-- picopilot game-jam capture harness (auto-injected; throwaway).
__jam_u=_update
__jam_t=0
function _update()
 if __jam_u then __jam_u() end
 __jam_t+=1
 if __jam_t==20 then extcmd("set_filename","f0") extcmd("screen") end
 if __jam_t==70 then extcmd("set_filename","f1") extcmd("screen") end
 if __jam_t==120 then extcmd("set_filename","f2") extcmd("screen") end
 if __jam_t==125 then printh("__PICOPILOT_DONE__") end
end
LUA
    local args=(run "$tmp/main.p8" --shot-dir "$shotdir" --format json)
    [ -n "$input" ] && args+=(--input "$input")
    ( cd "$tmp" && node "$PICOPILOT_BIN" "${args[@]}" )
  }
  echo ">>> boot + screenshot check (fresh, auto-instrumented)..."
  instrument_and_run "" "$ART/shots-fresh" > "$ART/boot.json" 2>&1 || true
  rm -rf "$ART/_probe"
  # LIVE-gameplay capture: `picopilot playtest` transforms a throwaway copy of
  # the entry (btn/btnp -> serial 0x804, harness-owned frame loop) and drives it
  # title->play, so the judge sees real gameplay (not the title screen). The
  # drive logic now lives in ONE tested place (engine/pico8 drive-transform,
  # ADR-0011); the bespoke drive-capture.sh is superseded.
  echo ">>> live-gameplay capture (picopilot playtest, ADR-0011)..."
  ( cd "$WORKDIR" && node "$PICOPILOT_BIN" playtest main.p8 --shot-dir "$ART/shots-play" --format json ) > "$ART/drive.json" 2>&1 || true
  grep -oE '"exitReason"[: ]+"[a-z]*"' "$ART/drive.json" 2>/dev/null | head -1 || true

  echo ">>> playability lint (invisible-player / empty-sprite check)..."
  bash "$HERE/check-playable.sh" "$PICOPILOT_BIN" "$WORKDIR" > "$ART/playable.txt" 2>&1 || true
  grep 'PLAYABLE-CHECK' "$ART/playable.txt" || true
else
  echo "!!! no main.p8 produced, the entry is empty."
fi

# --- Tier-2 judge (subjective rubric, an independent pi agent) ---
if [ "$DO_JUDGE" = "1" ] && [ "$HAVE_CART" = "1" ]; then
  echo ">>> judging..."
  JPROMPT="$(sed -e "s|__THEME__|$THEME|g" -e "s|__MINUTES__|$MINUTES|g" "$HERE/judge.md")"
  ( cd "$WORKDIR"
    timeout 600 pi -p --session-id "judge-$SID" "${MODEL_ARGS[@]}" --approve "$JPROMPT"
  ) 2>&1 | tee "$ART/verdict.txt" | tail -60
fi

echo "=================================================================="
echo " JAM COMPLETE  |  theme: '$THEME'"
echo " entry:     $WORKDIR/main.p8   (JAM.md: $([ -f "$WORKDIR/JAM.md" ] && echo yes || echo MISSING))"
echo " artifacts: $ART"
echo " verify:    $(grep -oE '"status"[: ]+"[a-z-]*"' "$ART/verify.json" 2>/dev/null | head -1)"
echo " tokens:    $(grep -oE '"tokens"[: ]+[0-9]+' "$ART/tokens.json" 2>/dev/null | head -1)"
echo " booted:    $(grep -oE '"exitReason"[: ]+"[a-z]*"' "$ART/boot.json" 2>/dev/null | head -1)"
echo " shots:     fresh=$(ls "$ART/shots-fresh"/*.png 2>/dev/null | wc -l) gameplay=$(ls "$ART/shots-play"/*.png 2>/dev/null | wc -l)"
echo " playable:  $(grep -oE 'PLAYABLE-CHECK: (ok|issues [0-9]+)' "$ART/playable.txt" 2>/dev/null | head -1)"
echo "=================================================================="
