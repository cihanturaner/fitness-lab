#!/usr/bin/env bash
# Development mode: Vite dev server (hot reload) proxying /api to FastAPI.
#
# Never the real database: every reload re-runs migrations, so a half-written migration
# saved during development would otherwise be applied to canonical data for good.
# FITNESS_LAB_DB defaults to data/dev/fitness_lab.db (gitignored, like all of data/).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export FITNESS_LAB_DB="${FITNESS_LAB_DB:-$REPO_ROOT/data/dev/fitness_lab.db}"
resolved="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$FITNESS_LAB_DB")"
case "$resolved" in
  */data/fitness_lab.db)
    echo "refusing: $resolved is the canonical database; dev.sh uses a dev database" >&2
    exit 2
    ;;
esac
mkdir -p "$(dirname "$resolved")"
# Hand the backend exactly the path that was checked (it runs from backend/, where a
# relative path would resolve differently).
export FITNESS_LAB_DB="$resolved"

if python3 -c 'import socket; socket.create_connection(("127.0.0.1", 8000), 0.5)' 2>/dev/null; then
  echo "port 8000 is already in use (the app or another dev server?); stop it first" >&2
  exit 3
fi

(cd backend && uv sync --quiet)
[ -d web/node_modules ] || (cd web && npm ci --silent)

echo "==> dev database: $resolved"
# exec: the background job is uv itself, so stopping it cannot orphan the API server.
(cd backend && exec uv run uvicorn fitness_lab.api.app:app --host 127.0.0.1 --port 8000 --reload) &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd web && npm run dev
