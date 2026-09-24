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

- Bodyweight is kilograms. Every workout load is entered and shown in POUNDS (at most
  0.01 lb) and stored as integer grams (`load_g`, `target_load_g`: a physical mass, so no
  recorded set is ever reinterpreted). The one conversion is `domain/units.py` (lb↔g, exact
  Decimal, 453.59237 g/lb) at the API boundary (`load_lb`); there is no selectable unit system.
- `planned` is not `performed`. They are distinct concepts and must stay separately modelled.
- `performed_at` is not `entered_at`. Both are recorded; neither substitutes for the other.
- SQLite database files are never committed to git.
- Opening a planned workout creates one empty draft with an immutable origin — never a
  performed set. Actual sets carry no link to prescriptions (no set → `planned_set` link).
  Since V3.3.1 a set may record the planned *slot* it was entered in (`performed_set_slot`,
  migration 0008; `slot_id` NULL = extra work), so two slots performed as the same exercise
  never merge; sets are never grouped by `exercise_id` alone (`domain/placement.py`). Sets
  recorded before 0008 keep the old rule (first slot performed as their exercise).
- Imported program content is append-only (trigger-enforced); at most one version is active.
- Development, tests and E2E never use `data/fitness_lab.db`; always a scratch
  `FITNESS_LAB_DB`.
- Bodyweight is exact integer grams, one entry per date. Nutrition is one log per date of
  integer macro grams. A day's calories are never entered or stored: they are derived,
  protein × 4 + carbs × 4 + fat × 9 (`domain/nutrition.day_calories`; an unrecorded macro
  adds nothing and the day is marked incomplete). Calories typed before V3.1 are kept in the
  closed, append-only `nutrition_entered_calories` table (migration 0006). A nutrition
  target (V3.3) is protein / carbs / fat in grams, append-only and effective-dated
  (`macro_target`); its calories are derived the same way and never entered. There is no
  target until the lifter records one; each day is judged by the target in force on it. The
  source's protein 145 g / fat 60 g are only the defaults offered. Pre-V3.3 calorie-only
  targets live on, closed, in `calorie_target` (converted by migration 0007). The app never
  sets or changes a target itself.
- Changing an exercise (V3.3 "Change") is a `workout_slot_substitution` of one workout: the
  program, its slots and every other occurrence keep the planned exercise. Approved
  substitutes are read from the slot's locked notes.
- A workout row in the UI is not a set until the lifter saves it. The lifter never chooses a
  set type (V3.2): a row is set · lb · reps · RIR and is stored as `working`; the API stores a
  set created without `set_type` as `working`. The column, rule C4 and warm-up exclusion
  from working-set totals stay, so legacy rows keep their meaning.
- A session is "shortened" when its recorded non-warm-up sets are fewer than the planned
  non-warm-up sets of its origin (totals only, never matched set by set). Completing one asks
  first, and no screen shows it as a full "Done".
- Block phases are exact to the day: before the start date is pre-block (even inside week 1),
  after the last block week is post-block. History weeks come from each workout's own
  program version's block.
- The nutrition controller (`domain/nutrition_controller.py`) is decision support only. A
  target changes only by an explicit Apply on a due review (or a manual target); a calorie
  recommendation moves carbohydrate only (source `primary_macro_adjusted`);
  `controller_event` and `diagnostic_gate_event` are append-only. Its three app choices (≥ 6
  weigh-ins per 7-day half, "sustained" = two consecutive weekly trends above 0.25, gate
  reliability checks) are documented in the V3 spec and must stay fixed for a block. In
  block weeks 1–2 a manual change asks for one of the source's exceptions only when it changes
  an established target (one in force before today); setting up the first target never does.

Current design: `docs/superpowers/specs/2026-09-24-v3-3-1-patch.md` (V3.3.1: Change to a
typed new exercise, independent slots, the macro target as a setting, Settings › Program in
Turkish, History with the day timeline as its only primary view) over
`docs/superpowers/specs/2026-09-24-v3-3-daily-use-finalization.md` (V3.3:
Change exercise for one workout, macro targets with effective-dated history, day-by-day
History, Turkish program rules, discard draft) over
`docs/superpowers/specs/2026-09-24-v3-2-simplification.md` (V3.2: Home is
only today + three summary cards, the week planner lives on Training, no set-type control,
perceptible motion timings, less rounding — it keeps V3.1's visual identity) over
`docs/superpowers/specs/2026-09-24-v3-1-units-macros-premium-ui.md` (V3.1:
pound loads, macro-derived calories, the emerald visual language and motion system — it
supersedes V2.1's visual tokens; follow it for any UI change) over
`docs/superpowers/specs/2026-09-23-v3-final-product-completeness.md` (V3:
block phases, week navigation, shortened sessions, History by set, nutrition controller,
Settings, source-fidelity declarations) over
`docs/superpowers/specs/2026-09-23-v2-1-product-polish.md` (V2.1: per-screen hierarchy and
copy rules; its grey tokens are superseded by V3.1) over
`docs/superpowers/specs/2026-09-23-v2-product-ux-note.md` (V2: Week,
Workout, Bodyweight, Nutrition, History), on top of
`docs/superpowers/specs/2026-09-23-m2-planned-program-workflow-design.md` (M2) and the M1
spec in the same directory. The authoritative nutrition source is
`programs/advanced-natural-12w-nutrition/artifact/locked_nutrition_tracker.json`.

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

Development with hot reload (Vite on :5173 proxying `/api` to FastAPI on :8000). It runs
against `data/dev/fitness_lab.db` (or `FITNESS_LAB_DB`) and refuses the canonical file,
because every reload re-runs migrations:

    ./scripts/dev.sh

Stopping the launcher (Ctrl-C or SIGTERM) waits for the server's graceful shutdown. Both
scripts refuse to start when their port is already in use, and `start.sh` only reports
"ready" once `/api/health` echoes its own per-launch `launch_id`, so the browser can never
be opened on some other server (or database) holding the port. The API answers only
requests addressed to `127.0.0.1` or `localhost` (DNS-rebinding guard), so
`FITNESS_LAB_HOST` must stay a loopback name.

## Program administration

Programs are imported and activated only from the command line (from `backend/`); the UI
never switches programs. Every command migrates first, honours `FITNESS_LAB_DB`, and prints
one JSON result:

    uv run fitness-lab adapt-locked-program ../programs/advanced-natural-12w/artifact/locked_workout_program.json ../programs/advanced-natural-12w/package
    uv run fitness-lab ensure-exercises ../programs/advanced-natural-12w/package/exercises.json
    uv run fitness-lab import-program ../programs/advanced-natural-12w/package
    uv run fitness-lab activate-program <version_id>
    uv run fitness-lab list-programs | show-program | deactivate-program
    uv run fitness-lab set-block-start 2026-10-01    # week 1 = the Mon-Sun week containing it

The block start is also set in the app (Settings), which is the ordinary way. Settings also
shows the program and its rules (read-only) and takes a verified manual backup
(`<timestamp>-manual-backup.db` in `data/snapshots/`).

Import is idempotent (an identical package returns the existing version and writes
nothing) and never creates exercises; `ensure-exercises` creates missing identities
through the M1 exercise authority and refuses to revive retired ones.

## Snapshots and restore

Besides the manual backup in Settings, three operations take a full-file snapshot (SQLite `VACUUM INTO`) into `data/snapshots/`
before touching the database: applying pending migrations (once per run, before the
first pending migration), `delete_complete_workout` (before every hard delete of a
completed workout), and discarding a draft that holds sets (it may be a reopened,
formerly complete workout). Files are named `<UTC timestamp>-<label>.db`, e.g.
`20260907T120000000000Z-pre-0003.db` (pre-migration),
`20260907T120000000000Z-pre-delete-workout-<id>.db` (pre-deletion) or
`…-pre-discard-workout-<id>.db` (pre-discard). Every snapshot is read back (`quick_check`)
before the operation proceeds. Snapshots are never
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

End-to-end (from `e2e/`) — seeds fresh scratch databases with the locked program and
starts the real launcher on port 8710 (V1 journey; 8711 for the restart test) and 8712
(V2 daily-use journey, its own database, block started two Mondays ago), 8713 (V3
completeness journey, its own database, block started three Mondays ago), 8714 (V3.1
pounds / macros / reduced-motion journey, its own database), 8715 (V3.2 Home / Training /
keyboard-only set entry / motion journey, its own database), 8716 (V3.3 change exercise /
discard / macro targets / day History / Turkish rules journey, its own database) and 8717
(V3.3.1 typed exercise / independent slots / target setting / Turkish Program / day-only
History journey, its own database); it ignores
`FITNESS_LAB_DB` and never reuses a running server:

    npx playwright test

Visual QA (from `e2e/`, not part of the suite above) — screenshots every screen from an empty
and a seeded scratch database at 1440×900 and 1728×1117 into `artifacts/visual/<VISUAL_TAG>/`:

    VISUAL_TAG=check npx playwright test -c playwright.visual.config.ts

`VISUAL_BROWSER=webkit` renders the same screens in WebKit (needs the matching WebKit build
installed by `npx playwright install webkit`).

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
