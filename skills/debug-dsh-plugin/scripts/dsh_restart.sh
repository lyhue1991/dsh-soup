#!/usr/bin/env bash
# Restart DeepSeek Harness, optionally with a CDP debug port.
# Usage: dsh_restart.sh [port]
#   - No port: plain restart (plain quit -> verify dead -> relaunch).
#   - With port: relaunch with --remote-debugging-port=<port>.
# Prints the CDP /json/list URL when the port is given.
set -u

APP_NAME="DeepSeek Harness"
APP_BIN="/Applications/$APP_NAME.app/Contents/MacOS/$APP_NAME"
PORT="${1:-}"

# 1) Quit via AppleScript, then verify EVERY process is gone. A leftover
#    host process (DSH is multi-process) silently keeps the old bundle
#    loaded and swallows --args on relaunch.
osascript -e "quit app \"$APP_NAME\"" 2>/dev/null
sleep 3
for _ in 1 2 3 4 5; do
  if [ "$(pgrep -f 'DeepSeek Harness.app/Contents/MacOS' | grep -c . || true)" = "0" ]; then
    break
  fi
  pkill -f 'DeepSeek Harness.app/Contents/MacOS' 2>/dev/null
  sleep 2
done

if [ "$(pgrep -f 'DeepSeek Harness.app/Contents/MacOS' | grep -c . || true)" != "0" ]; then
  echo "ERROR: DSH processes still alive:" >&2
  pgrep -fl 'DeepSeek Harness.app/Contents/MacOS' >&2
  exit 1
fi

# 2) Relaunch.
if [ -n "$PORT" ]; then
  # open --args only works when the app is NOT running; we just killed it.
  open -a "$APP_NAME" --args --expose-internals "--remote-debugging-port=$PORT"
  # Poll for the CDP endpoint (app takes several seconds to boot).
  for _ in $(seq 1 15); do
    sleep 2
    if curl -s -m 2 "http://127.0.0.1:$PORT/json/list" | grep -q 'url'; then
      echo "CDP ready: http://127.0.0.1:$PORT/json/list"
      exit 0
    fi
  done
  echo "ERROR: CDP did not come up on port $PORT" >&2
  exit 1
else
  open -a "$APP_NAME"
  echo "restarted (no debug port)"
fi
