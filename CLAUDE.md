# fitness-lab

A personal fitness performance system for one user, intended to be used and maintained for
many years. It records planned and performed training, and supports progression decisions
over long time horizons. Real workout logging begins 1 October 2026.

## Product constraints

Single-user, local-first, local desktop only. No signup, no authentication, no multi-tenancy,
no coach/team/admin roles, no billing, no cloud backend, no remote database, no hosting, no
mobile app. Personal scope does not lower the engineering bar: migrations, tests, verification
and durable project state are still required.

No external network calls at runtime. Localhost traffic between the frontend and the API is
expected and allowed. No external services, no API keys.

## Stack (locked)

Backend: Python 3.13, uv, FastAPI, SQLite, pytest, ruff, mypy (strict).
Frontend: React 19, TypeScript strict, Vite, Tailwind CSS v4, shadcn/ui, oxlint.
Testing: Vitest, React Testing Library, Playwright.

Do not swap any of these out. If something appears infeasible, report the evidence rather
than substituting a technology.

## Architecture boundaries

Dependency direction is one-way:

    domain -> storage -> api -> web

- `domain` — pure fitness logic. No I/O, no database, no HTTP. Must not import `storage`,
  `api`, `sqlite3` or `fastapi`. Enforced by `backend/tests/test_architecture.py`.
- `storage` — SQLite access, migrations, and repositories. The only layer that touches
  the database.
- `api` — FastAPI boundary. Also serves the production React build in normal local use.
- `web` — React SPA. Calls the API on a relative `/api` path in both dev and production.

## Invariants

- Units are kilograms. There is no lb/kg conversion system.
- `planned` is not `performed`. They are distinct concepts and must stay separately modelled.
- `performed_at` is not `entered_at`. Both are recorded; neither substitutes for the other.
- SQLite database files are never committed to git.
- Opening a planned workout creates one empty draft with an immutable origin — never a
  performed set. Actual sets carry no link to prescriptions.
- Imported program content is append-only (trigger-enforced); at most one version is active.
- Development, tests and E2E never use `data/fitness_lab.db`; always a scratch
  `FITNESS_LAB_DB`.

Current design: `docs/superpowers/specs/2026-09-23-m2-planned-program-workflow-design.md`
(M2, builds on the M1 spec in the same directory).

## Repository layout

    backend/            uv project (Python pinned to 3.13 by .python-version);
                        src/fitness_lab/{domain,storage,api}, cli.py, tests/
    backend/migrations/ forward-only, numbered SQL migration files (NNNN_description.sql)
    web/                React SPA; src/components/ui holds generated shadcn components
    e2e/                Playwright end-to-end tests; scripts/serve-scratch.sh seeds a
                        scratch database and runs the real launcher against it
    programs/           program artifacts: <name>/artifact/ holds the source exactly as
                        received, <name>/package/ the generated program package
    scripts/            start.sh (normal use), dev.sh (hot reload)
    data/               SQLite database (gitignored, created on first run); also holds
                        fitness_lab.db.migrate.lock (cross-process migration lock) and
                        snapshots/ (pre-migration backups; see "Snapshots and restore" below)

## Running the app

Normal local use — builds the frontend if stale, serves it through FastAPI on
http://127.0.0.1:8000, opens the browser:

    ./scripts/start.sh

Development with hot reload (Vite on :5173 proxying `/api` to FastAPI on :8000):

    ./scripts/dev.sh

Stopping the launcher (Ctrl-C or SIGTERM) waits for the server's graceful shutdown.

## Program administration

Programs are imported and activated only from the command line (from `backend/`); the UI
never switches programs. Every command migrates first, honours `FITNESS_LAB_DB`, and prints
one JSON result:

    uv run fitness-lab adapt-locked-program ../programs/advanced-natural-12w/artifact/locked_workout_program.json ../programs/advanced-natural-12w/package
    uv run fitness-lab ensure-exercises ../programs/advanced-natural-12w/package/exercises.json
    uv run fitness-lab import-program ../programs/advanced-natural-12w/package
    uv run fitness-lab activate-program <version_id>
    uv run fitness-lab list-programs | show-program | deactivate-program

Import is idempotent (an identical package returns the existing version and writes
nothing) and never creates exercises; `ensure-exercises` creates missing identities
through the M1 exercise authority and refuses to revive retired ones.

## Snapshots and restore

Two operations take a full-file snapshot (SQLite `VACUUM INTO`) into `data/snapshots/`
before touching the database: applying pending migrations (once per run, before the
first pending migration), and `delete_complete_workout` (before every hard delete of a
completed workout). Files are named `<UTC timestamp>-<label>.db`, e.g.
`20260907T120000000000Z-pre-0003.db` (pre-migration) or
`20260907T120000000000Z-pre-delete-workout-<id>.db` (pre-deletion). Snapshots are never
pruned in M1 — they accumulate forever by design.

To restore from a snapshot: stop the app, copy the chosen file over `data/fitness_lab.db`,
then delete `data/fitness_lab.db-wal` and `data/fitness_lab.db-shm` if present (stale WAL
state must not survive under the restored file).

## Verification commands

Backend (from `backend/`):

    uv run pytest
    uv run ruff check . && uv run ruff format --check .
    uv run mypy

Frontend (from `web/`):

    npm run typecheck
    npm run lint
    npm test
    npm run build

End-to-end (from `e2e/`) — seeds a fresh scratch database with the locked program and
starts the real launcher on port 8710 (8711 for the restart test); it ignores
`FITNESS_LAB_DB` and never reuses a running server:

    npx playwright test

## Component base

shadcn/ui is installed on the **React Aria** base (`components.json` style `aria-nova`;
components wrap `react-aria-components`). Chosen because workout entry is keyboard- and
focus-intensive. Add components with `npx shadcn@latest add <name>`.

The root `tsconfig.json` carries `baseUrl` and `paths` purely because the shadcn CLI resolves
the `@/` alias from it; without them the CLI writes components into a literal `./@/` directory.

# Verification
Before implementing a non-trivial change, decide how you will verify it.
Do not report a change as done or working until that verification has run.
Report what the verification showed and any remaining uncertainty.
