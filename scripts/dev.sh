#!/usr/bin/env bash
# Development mode: Vite dev server (hot reload) proxying /api to FastAPI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

(cd backend && uv sync --quiet)
[ -d web/node_modules ] || (cd web && npm install --silent)

(cd backend && uv run uvicorn fitness_lab.api.app:app --host 127.0.0.1 --port 8000 --reload) &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM

cd web && npm run dev
