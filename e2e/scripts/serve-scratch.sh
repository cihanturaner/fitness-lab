#!/usr/bin/env bash
# Test and preview use only: seed a SCRATCH database with a program package, then start the
# real production launcher against it. Never points at the canonical database.
#
#   FITNESS_LAB_DB=/tmp/x/fitness_lab.db FITNESS_LAB_PORT=8765 bash e2e/scripts/serve-scratch.sh
#
# FITNESS_LAB_SEED_PACKAGE overrides the package (default: the locked 12-week program).
# FITNESS_LAB_SEED_BLOCK_START (YYYY-MM-DD, optional) sets the start of the training block.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${FITNESS_LAB_DB:?set FITNESS_LAB_DB to a scratch database path}"

resolved="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$FITNESS_LAB_DB")"
case "$resolved" in
  */data/fitness_lab.db)
    echo "refusing: $resolved looks like a canonical database; use a scratch path" >&2
    exit 2
    ;;
esac

PACKAGE="${FITNESS_LAB_SEED_PACKAGE:-$REPO_ROOT/programs/advanced-natural-12w/package}"
cd "$REPO_ROOT/backend"
uv sync --quiet
uv run fitness-lab ensure-exercises "$PACKAGE/exercises.json" >/dev/null
version_id="$(uv run fitness-lab import-program "$PACKAGE" |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["version_id"])')"
uv run fitness-lab activate-program "$version_id" >/dev/null
if [ -n "${FITNESS_LAB_SEED_BLOCK_START:-}" ]; then
  uv run fitness-lab set-block-start "$FITNESS_LAB_SEED_BLOCK_START" >/dev/null
fi
echo "==> scratch database $resolved seeded with program version $version_id"

exec bash "$REPO_ROOT/scripts/start.sh" --no-open
