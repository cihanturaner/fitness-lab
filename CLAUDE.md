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
- `storage` — SQLite access and (later) migrations and repositories. The only layer that
  touches the database.
- `api` — FastAPI boundary. Also serves the production React build in normal local use.
- `web` — React SPA. Calls the API on a relative `/api` path in both dev and production.

## Invariants

- Units are kilograms. There is no lb/kg conversion system.
- `planned` is not `performed`. They are distinct concepts and must stay separately modelled.
- `performed_at` is not `entered_at`. Both are recorded; neither substitutes for the other.
- SQLite database files are never committed to git.

## Repository layout

    backend/    uv project; src/fitness_lab/{domain,storage,api}, tests/
    web/        React SPA; src/components/ui holds generated shadcn components
    e2e/        Playwright end-to-end tests
    scripts/    start.sh (normal use), dev.sh (hot reload)
    data/       SQLite database files (gitignored, created on first run)

## Running the app

Normal local use — builds the frontend if stale, serves it through FastAPI on
http://127.0.0.1:8000, opens the browser:

    ./scripts/start.sh

Development with hot reload (Vite on :5173 proxying `/api` to FastAPI on :8000):

    ./scripts/dev.sh

## Verification commands

Backend (from `backend/`):

    uv run pytest
    uv run ruff check . && uv run ruff format --check .
    uv run mypy

Frontend (from `web/`):

    npm run typecheck
    npm run lint
    npm test

End-to-end (from `e2e/`) — starts the real launcher itself, so the app need not be running:

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
