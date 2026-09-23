#!/usr/bin/env bash
# Normal local use: build the frontend if it is stale, start FastAPI, open the
# app. One process, one port. Ctrl-C stops it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${FITNESS_LAB_HOST:-127.0.0.1}"
PORT="${FITNESS_LAB_PORT:-8000}"
OPEN_BROWSER=1
FORCE_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    --force-build) FORCE_BUILD=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT"

# Refuse a port someone already listens on: otherwise the health check could be
# answered by that other server (maybe on another database) and the browser opened on it.
if python3 -c 'import socket, sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), 0.5)' \
     "$HOST" "$PORT" 2>/dev/null; then
  echo "port ${PORT} on ${HOST} is already in use; is fitness-lab already running?" >&2
  echo "stop that process first (lsof -nP -iTCP:${PORT} -sTCP:LISTEN shows it)" >&2
  exit 3
fi

needs_build() {
  [ "$FORCE_BUILD" -eq 1 ] && return 0
  [ -f web/dist/index.html ] || return 0
  # Rebuild when any tracked frontend input is newer than the built entry point.
  [ -n "$(find web/src web/public web/index.html web/package.json web/package-lock.json \
            web/vite.config.ts web/components.json web/tsconfig*.json \
            -newer web/dist/index.html -print -quit 2>/dev/null)" ]
}

echo "==> backend dependencies"
(cd backend && uv sync --quiet)

if [ ! -d web/node_modules ]; then
  echo "==> frontend dependencies"
  (cd web && npm install --silent)
elif [ web/package-lock.json -nt web/node_modules/.package-lock.json ]; then
  # Never reinstall behind the lifter's back (it needs the network); say so instead.
  echo "warning: web/package-lock.json changed since the last install; run 'npm ci' in web/" >&2
fi

if needs_build; then
  echo "==> building frontend"
  (cd web && npm run build)
else
  echo "==> frontend build is up to date"
fi

# A per-launch identity the server reports on /api/health, so "ready" is only ever
# declared for the server this script started.
FITNESS_LAB_LAUNCH_ID="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
export FITNESS_LAB_LAUNCH_ID

echo "==> starting fitness-lab on http://${HOST}:${PORT}"
# exec: the background job IS the uv process (which forwards signals to uvicorn), not a
# subshell around it. Killing a subshell would orphan the server, still holding the port
# and the database open.
(cd backend && exec uv run uvicorn fitness_lab.api.app:app --host "$HOST" --port "$PORT") &
SERVER_PID=$!

stop_server() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    # Wait for uvicorn's graceful shutdown so the database connection is closed cleanly.
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap stop_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ours() {
  kill -0 "$SERVER_PID" 2>/dev/null &&
    curl -sf "http://${HOST}:${PORT}/api/health" 2>/dev/null |
      grep -q "\"launch_id\":\"${FITNESS_LAB_LAUNCH_ID}\""
}

for _ in $(seq 1 60); do
  ours && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited before becoming healthy" >&2
    exit 1
  fi
  sleep 0.5
done

if ! ours; then
  echo "server did not become healthy in time" >&2
  exit 1
fi

echo "==> ready: http://${HOST}:${PORT}"
[ "$OPEN_BROWSER" -eq 1 ] && open "http://${HOST}:${PORT}"

wait "$SERVER_PID"
