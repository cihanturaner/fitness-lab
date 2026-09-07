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

needs_build() {
  [ "$FORCE_BUILD" -eq 1 ] && return 0
  [ -f web/dist/index.html ] || return 0
  # Rebuild when any tracked frontend input is newer than the built entry point.
  [ -n "$(find web/src web/index.html web/package.json web/vite.config.ts \
            -newer web/dist/index.html -print -quit 2>/dev/null)" ]
}

echo "==> backend dependencies"
(cd backend && uv sync --quiet)

if [ ! -d web/node_modules ]; then
  echo "==> frontend dependencies"
  (cd web && npm install --silent)
fi

if needs_build; then
  echo "==> building frontend"
  (cd web && npm run build)
else
  echo "==> frontend build is up to date"
fi

echo "==> starting fitness-lab on http://${HOST}:${PORT}"
(cd backend && uv run uvicorn fitness_lab.api.app:app --host "$HOST" --port "$PORT") &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -sf "http://${HOST}:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited before becoming healthy" >&2
    exit 1
  fi
  sleep 0.5
done

if ! curl -sf "http://${HOST}:${PORT}/api/health" >/dev/null 2>&1; then
  echo "server did not become healthy in time" >&2
  exit 1
fi

echo "==> ready: http://${HOST}:${PORT}"
[ "$OPEN_BROWSER" -eq 1 ] && open "http://${HOST}:${PORT}"

wait "$SERVER_PID"
