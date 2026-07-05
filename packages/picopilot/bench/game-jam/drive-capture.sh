#!/usr/bin/env bash
# Drive-capture: screenshot an entry during LIVE gameplay by transforming its
# input calls to a harness-driven channel, so the judge sees real play (not the
# title screen). Spike-verified (btn/btnp shadowing + serial 0x804 frame-synced +
# btnp-edge reconstruction, see work/notes/findings when promoted).
#
# HOW: on a THROWAWAY copy of the cart we PREPEND a shim that redefines global
# btn/btnp to read a per-frame held-buttons byte piped over serial stdin (0x804),
# reconstructing btnp edges from the level signal; we insert __drv_poll() at the
# top of the cart's _update; and we pipe a scripted input byte-stream (one byte
# per frame, bit i = button i held). The entry's own main.p8 is untouched.
#
# Usage: drive-capture.sh <pico8-bin> <workdir> <shotdir> [inputspec]
#   inputspec: comma list of "frame:buttonbit" presses (default: a generic
#   "press O every 15 frames" that starts most title screens + drives one-button
#   games). buttonbit: 0=L 1=R 2=U 3=D 4=O/Z 5=X.
set -uo pipefail
PICO8="$1"; WD="$2"; SHOTDIR="$3"; INPUTSPEC="${4:-generic}"
mkdir -p "$SHOTDIR"
[ -f "$WD/main.lua" ] || { echo "drive-capture: no main.lua"; exit 0; }
[ -x "$PICO8" ] || command -v "$PICO8" >/dev/null || { echo "drive-capture: no pico8"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The drive shim (prepended). One held-buttons byte per frame from serial 0x804.
cat > "$TMP/drive.lua" <<'LUA'
-- picopilot drive shim (auto-injected; throwaway). Redefines btn/btnp to read a
-- harness-piped per-frame held-buttons byte (serial 0x804), reconstructing btnp
-- edges. Lets the harness drive an arbitrary cart into live gameplay headless.
__drv_held=0 __drv_prev=0
function __drv_poll()
 __drv_prev=__drv_held
 local n=serial(0x804,0x4300,1)
 if n>0 then __drv_held=peek(0x4300) end
end
function btn(i,p) return (__drv_held & (1<<i))!=0 end
function btnp(i,p) return (__drv_held & (1<<i))!=0 and (__drv_prev & (1<<i))==0 end
LUA

# Append the cart's Lua with __drv_poll() inserted at the top of its _update.
if grep -q 'function _update()' "$WD/main.lua"; then
  sed 's/function _update()/function _update()\n __drv_poll()/' "$WD/main.lua" >> "$TMP/drive.lua"
elif grep -q 'function _update60()' "$WD/main.lua"; then
  sed 's/function _update60()/function _update60()\n __drv_poll()/' "$WD/main.lua" >> "$TMP/drive.lua"
else
  # no _update we can hook; just append (drive won't tick, but boot still shots)
  cat "$WD/main.lua" >> "$TMP/drive.lua"
fi

# Capture tab: shoot a few frames spread across the (driven) run, then sentinel.
# Shoot SOON after the start press (frame 3) so we catch active play before any
# death/retry churn, then a couple more spread out.
cat >> "$TMP/drive.lua" <<'LUA'

-->8
__cap_u=_update __cap_t=0
function _update()
 __cap_u() __cap_t+=1
 if __cap_t==12 then extcmd("set_filename","play0") extcmd("screen") end
 if __cap_t==22 then extcmd("set_filename","play1") extcmd("screen") end
 if __cap_t==34 then extcmd("set_filename","play2") extcmd("screen") end
 if __cap_t==38 then printh("__PICOPILOT_DONE__") stop() end
end
LUA

cat > "$TMP/drive.p8" <<'P8'
pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
#include drive.lua
P8

# Build the input byte-stream (120 frames, one held-byte each).
python3 - "$INPUTSPEC" > "$TMP/input.bin" <<'PY'
import sys
spec=sys.argv[1] if len(sys.argv)>1 else "generic"
N=120; f=[0]*N
def press(at,bit):
    if 0<=at<N: f[at]|=(1<<bit)
if spec=="generic":
    # Generic one-button driver, tuned to REACH play and stay there briefly:
    # press O(4) once to START (frame 3), then a FEW gentle, well-spaced presses
    # (single-frame = clean btnp edges) so a one-button game acts without dying
    # instantly. Also hold O across a short window for "hold-to-thrust" games,
    # and nudge right(1) in case it is a directional runner. Kept sparse so we
    # capture live play (frames 12/22/34) before any death/retry churn.
    press(3,4)                              # start
    for t in (16,24,30): press(t,4)         # a few actions during the capture window
    for t in range(18,23): press(t,4)       # a short hold (thrust games)
    press(20,1)                             # a little right (runners)
else:
    # explicit "frame:bit,frame:bit,..." list
    for tok in spec.split(","):
        tok=tok.strip()
        if not tok: continue
        a,b=tok.split(":"); press(int(a),int(b))
sys.stdout.buffer.write(bytes(f))
PY

# Run headless, piping the input; screenshots go to SHOTDIR via -desktop.
( cd "$TMP"
  timeout --signal=KILL 30 env -u DISPLAY "$PICO8" -desktop "$SHOTDIR" -x drive.p8 < input.bin >/dev/null 2>&1
) || true

n=$(ls "$SHOTDIR"/play*.png 2>/dev/null | wc -l)
echo "drive-capture: $n gameplay screenshot(s) in $SHOTDIR"
