#!/usr/bin/env sh
set -eu

API_PORT="${API_PORT:-8001}"
PORT="${PORT:-3000}"

echo "[mememaster] starting API on 127.0.0.1:${API_PORT}"
cd /app/api
uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT}" &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

i=0
until curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 45 ]; then
    echo "[mememaster] ERROR: API not healthy after 45s" >&2
    exit 1
  fi
  sleep 1
done
echo "[mememaster] API healthy"

# Resolve Next standalone entry (flat vs nested package name)
WEB_DIR=""
if [ -f /app/web/server.js ]; then
  WEB_DIR=/app/web
elif [ -f /app/web/frontend/server.js ]; then
  WEB_DIR=/app/web/frontend
else
  echo "[mememaster] ERROR: server.js not found under /app/web" >&2
  ls -la /app/web || true
  ls -la /app/web/* 2>/dev/null || true
  exit 1
fi

echo "[mememaster] starting Web from ${WEB_DIR} on 0.0.0.0:${PORT}"
cd "${WEB_DIR}"
export PORT
export HOSTNAME=0.0.0.0
export INTERNAL_API_URL="http://127.0.0.1:${API_PORT}"

# Keep API child alive; exec replaces shell with node (trap still best-effort)
# Use node in foreground so Railway tracks this process
node server.js &
WEB_PID=$!

# If either dies, exit container
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 3
done

echo "[mememaster] a process exited — shutting down" >&2
kill "$API_PID" "$WEB_PID" 2>/dev/null || true
exit 1
