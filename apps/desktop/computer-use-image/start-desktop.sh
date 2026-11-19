#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"
Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp -ac &
xvfb_pid=$!
dbus-run-session -- startxfce4 &
desktop_pid=$!

cleanup() {
  kill "$desktop_pid" "$xvfb_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
  sleep 0.2
done

exec python3 /opt/helix/guest_agent.py
