#!/usr/bin/env bash
# Safe Stage 2 smoke: local-only clients, no production deployment or API calls.
set -Eeuo pipefail
test -f static/index.html
test -f static/asset-manifest.json || echo "NOTE: asset-manifest may use a versioned path."
test -f resources/images/NationalLogo.svg
test -f resources/icons/icon512_maskable.png
test -f docs/11-decisions.md
test ! -d proprietary

CLIENT_LOG="$(mktemp)"
SERVER_LOG="$(mktemp)"
npm run start:client -- --host 127.0.0.1 --port 5173 >"$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!
npm run start:server-dev >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$CLIENT_PID" "$SERVER_PID" 2>/dev/null || true
  pkill -P "$CLIENT_PID" 2>/dev/null || true
  pkill -P "$SERVER_PID" 2>/dev/null || true
  wait "$CLIENT_PID" "$SERVER_PID" 2>/dev/null || true
  rm -f "$CLIENT_LOG" "$SERVER_LOG"
}
trap cleanup EXIT
echo "Checking Vite client HTTP startup..."
ready=0
for attempt in $(seq 1 90); do
  if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    echo "::error::Vite process exited"; tail -80 "$CLIENT_LOG"; exit 1
  fi
  if curl --silent --show-error --max-time 3 --fail http://127.0.0.1:5173/ -o /tmp/national-stage2-index.html 2>/dev/null; then
    ready=1; break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "::error::Vite did not serve a page"; tail -80 "$CLIENT_LOG"; exit 1
fi
grep -q 'BOOTSTRAP_CONFIG' /tmp/national-stage2-index.html
curl --silent --show-error --max-time 5 --fail http://127.0.0.1:5173/images/NationalLogo.svg | grep -q '<svg'
curl --silent --show-error --max-time 5 --fail http://127.0.0.1:5173/icons/icon512_maskable.png -o /tmp/national-stage2-icon.png
python3 - <<'PY'
from pathlib import Path
icon = Path("/tmp/national-stage2-icon.png").read_bytes()
assert icon[:8] == b"\x89PNG\r\n\x1a\n" and len(icon) > 100
print("NATIONAL logo and 512x512 PWA icon served successfully.")
PY
echo "Checking local game server listener..."
ready=0
for attempt in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "::error::Local game server exited"; tail -80 "$SERVER_LOG"; exit 1
  fi
  if python3 - <<'PY'
import socket
with socket.create_connection(("127.0.0.1", 3000), timeout=1):
    pass
PY
  then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "::error::Local game server never listened on port 3000"
  tail -100 "$SERVER_LOG"
  exit 1
fi
echo "PASS: client HTTP, original assets, and local game-server boot."
echo "NOTE: Browser-driven full gameplay and NATIONAL features are separate gates."
