#!/usr/bin/env sh
set -eu

API_PORT="${API_PORT:-8001}"
# Railway public port
PORT="${PORT:-3000}"

echo "[mememaster] starting API on 127.0.0.1:${API_PORT}"
cd /app/api
uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT}" &
API_PID=$!

# wait until API answers (max ~30s)
i=0
until curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "[mememaster] API failed to become healthy" >&2
    kill "$API_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
echo "[mememaster] API healthy"

echo "[mememaster] starting Web on 0.0.0.0:${PORT}"
cd /app/web
export PORT
export HOSTNAME=0.0.0.0
# Next rewrites use this internal API
export INTERNAL_API_URL="http://127.0.0.1:${API_PORT}"
exec node server.js
