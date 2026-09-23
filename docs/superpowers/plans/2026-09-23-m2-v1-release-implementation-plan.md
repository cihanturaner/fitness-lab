# M2 + Workout Entry V1 Release Implementation Plan

> **For agentic workers:** executed inline in the authoring session (compressed mission,
> hard deadline 2026-09-24) with independent subagent reviews at the gates named below.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a usable local Workout Entry V1 on top of M1: planned program persistence,
import/activation, draft open/resume with immutable provenance, whole-slot substitution,
last exact performance, a thin API, the entry UI, and the user's real 12-week program.

**Architecture:** One additive migration (`0003`) adds append-only program content,
singleton activation, a provenance link table and a substitution table whose composite
foreign keys make cross-workout attachment impossible. Pure parsing/validation/adaptation
lives in `domain`; transactional workflows live in `storage`; FastAPI and a CLI are thin
outer boundaries; the React SPA uses hash routes and persists every edit immediately.

**Tech Stack:** Python 3.13, uv, FastAPI, SQLite, pytest, ruff, mypy strict; React 19,
TypeScript strict, Vite, Tailwind v4, shadcn/ui (React Aria), oxlint, Vitest, RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-m2-planned-program-workflow-design.md`

## Global Constraints

- Dependency direction `domain -> storage -> api -> web`; `domain` imports no `storage`,
  `api`, `sqlite3`, `fastapi`, and never names `load_g`.
- Units are kilograms; storage is integer grams via `kg_to_g`/`g_to_kg` only.
- Planned is not performed; opening a plan writes zero `performed_set` rows.
- Migrations are forward-only and additive; `0001`/`0002` are never edited.
- No runtime external network calls; the UI calls relative `/api`.
- Development and E2E never touch `data/fitness_lab.db` of the main checkout; always set
  `FITNESS_LAB_DB` to a scratch path.
- Every task ends with: `uv run pytest`, `uv run ruff check . && uv run ruff format --check .`,
  `uv run mypy` (backend) or `npm run typecheck && npm run lint && npm test` (web) green,
  then a commit ending with the `Co-Authored-By` trailer.

## File map

| File | Responsibility |
|---|---|
| `backend/src/fitness_lab/domain/program.py` | package format 1: artifact decoding, hashing, strict validation, `ProgramPackage` dataclasses |
| `backend/src/fitness_lab/domain/locked_program.py` | pure adapter: locked source JSON → package files + exercise manifest |
| `backend/migrations/0003_planned_program.sql` | the M2 schema, triggers, indexes |
| `backend/src/fitness_lab/storage/db.py` | + `immediate_transaction` |
| `backend/src/fitness_lab/storage/programs.py` | import, activation, program/planned reads |
| `backend/src/fitness_lab/storage/entry.py` | open/resume, unplanned create, set CRUD/reorder, lifecycle, substitution, last performance, entry aggregate |
| `backend/src/fitness_lab/api/app.py` | routes (thin) |
| `backend/src/fitness_lab/api/schemas.py` | pydantic request/response models |
| `backend/src/fitness_lab/cli.py` | `fitness-lab` console script |
| `backend/tests/test_program_package.py`, `test_locked_program.py`, `test_m2_schema.py`, `test_programs.py`, `test_entry.py`, `test_entry_api.py` | tests |
| `programs/advanced-natural-12w/{source,package}/` | preserved source artifact and generated package |
| `web/src/api/client.ts`, `web/src/api/types.ts` | typed fetch client |
| `web/src/lib/route.ts` | hash router hook |
| `web/src/features/home/HomeScreen.tsx` | program, planned sessions, unplanned start, recent workouts |
| `web/src/features/entry/*` | Workout Entry screen, slot card, set rows, pickers |
| `web/src/App.tsx` | shell + routing + system status strip |
| `e2e/tests/workout-entry.spec.ts`, `e2e/fixtures/*`, `e2e/scripts/serve-scratch.sh` | E2E on scratch DB |

---

### Task 1: Program package parsing, hashing and validation (domain)

**Files:** Create `domain/program.py`; Test `tests/test_program_package.py`.

**Interfaces (produces):**
- `PACKAGE_FORMAT = 1`, `PROGRAM_FORMAT = "fitness-lab.program"`
- `class PackageError(ValueError)` with `.issues: tuple[str, ...]`
- `decode_artifact(data: bytes, label: str) -> str` — BOM, strict UTF-8, NUL refusal
- `sha256_hex(data: bytes) -> str`
- `package_sha256(program_json_sha256: str, notes_sha256: str | None) -> str`
- dataclasses `ExerciseRef(name, equipment_label)`, `PlannedSetSpec(set_type: SetTypeCode, reps_min: int, reps_max: int | None, target_rir_min: int | None, target_rir_max: int | None, target_load_kg: Decimal | None, notes: str | None)`, `SlotSpec(key, exercise: ExerciseRef, notes, sets: tuple[PlannedSetSpec, ...])`, `WorkoutSpec(key, name, day_label, notes, slots)`, `ProgramSpec(key, name, version_label, duration_weeks, notes, workouts)`
- `ProgramPackage(spec: ProgramSpec, program_json_text: str, program_json_sha256: str, notes_text: str | None, notes_sha256: str | None, package_sha256: str)`
- `parse_program_package(program_json: bytes, notes: bytes | None) -> ProgramPackage` (raises `PackageError` listing every issue with a JSON path)

- [ ] Write failing tests: BOM refused; invalid UTF-8 refused; NUL refused; CRLF,
  trailing newline and non-ASCII preserved and `text.encode() == original`; hash equals
  `hashlib.sha256(original)`; package hash changes with notes and is stable without;
  duplicate JSON keys refused; floats refused; unknown keys refused at every level;
  wrong `format`/`format_version` refused; missing `reps_max` refused, `null` accepted;
  `reps_max < reps_min` refused; RIR half-specified or min>max refused; bool as int
  refused; bad slug and duplicate workout/slot keys refused; empty lists refused;
  `target_load_kg` `"82.5"` → `Decimal("82.5")`, `"0.0001"` refused; valid package parses
  with array order preserved.
- [ ] Run `uv run pytest tests/test_program_package.py` → fails (module missing).
- [ ] Implement `domain/program.py`.
- [ ] Run tests → pass; full gates; commit `feat(domain): program package format 1 with exact artifact hashing`.

### Task 2: M2 additive migration

**Files:** Create `migrations/0003_planned_program.sql`; Test `tests/test_m2_schema.py`;
Modify `tests/test_migrations.py`/`test_baseline_migration.py` only where they assert the
head version or table list.

**Produces:** tables `program_version`, `planned_workout`, `planned_exercise_slot`,
`planned_set`, `active_program_version`, `workout_plan_origin`,
`workout_slot_substitution`; triggers `trg_<table>_no_update`/`_no_delete` for the four
content tables, `trg_origin_no_update`, `trg_origin_no_delete`,
`trg_substitution_not_original_{insert,update}`, `trg_substitution_complete_{insert,update,delete}`.

- [ ] Write failing tests (raw SQL against `migrated_db`): each content table refuses
  UPDATE and DELETE; reps/RIR/load CHECKs; `set_type` FK; `package_sha256` unique and hex
  checked; singleton check refuses id 2; origin UPDATE and direct DELETE refused; deleting
  the workout cascades origin and substitutions; substitution to a slot of another planned
  workout fails with FOREIGN KEY constraint; substitution on an unplanned workout fails;
  substitution equal to the planned exercise refused; substitution insert/update/delete on
  a complete workout refused; `PRAGMA foreign_key_check`, `quick_check`, `integrity_check`
  clean; migrating an M1-head database containing M1 rows preserves them and adds no
  origin rows; second `migrate_to_head` applies nothing and takes no snapshot.
- [ ] Run → fail. Write the migration. Run → pass. Gates. Commit
  `feat(storage): additive M2 schema for planned programs, provenance and substitution`.
- [ ] **Gate: independent schema/migration review (subagent).** Fix Critical/Important.

### Task 3: Import, activation and program reads

**Files:** Modify `storage/db.py` (+`immediate_transaction`); Create `storage/programs.py`;
Test `tests/test_programs.py`.

**Interfaces (produces):**
- `immediate_transaction(connection) -> Iterator[Connection]` (`BEGIN IMMEDIATE`)
- `class ImportRefused(RuntimeError)`; `class ProgramStateError(RuntimeError)`
- `ProgramVersionRow(id, program_key, name, version_label, duration_weeks, package_sha256, program_json_sha256, notes_sha256, imported_at_utc)`
- `ImportResult(version: ProgramVersionRow, created: bool)`
- `import_program_package(conn, package: ProgramPackage, *, now: str | None = None) -> ImportResult`
- `activate_program_version(conn, version_id, *, now=None) -> None`; `deactivate_program(conn) -> None`
- `get_active_version(conn) -> ProgramVersionRow | None`; `list_program_versions(conn) -> tuple[ProgramVersionRow, ...]`
- `read_program_texts(conn, version_id) -> tuple[str, str | None]`
- `PlannedWorkoutRow(id, program_version_id, workout_key, sequence, name, day_label, notes)`, `PlannedSetRow(id, position, set_type, reps_min, reps_max, target_rir_min, target_rir_max, target_load_kg: Decimal | None, notes)`, `SlotRow(id, planned_workout_id, slot_key, position, exercise_id, notes, sets: tuple[PlannedSetRow, ...])`
- `list_planned_workouts(conn, version_id) -> tuple[PlannedWorkoutRow, ...]`; `get_planned_workout(conn, id) -> PlannedWorkoutRow | None`; `list_slots(conn, planned_workout_id) -> tuple[SlotRow, ...]`

- [ ] Failing tests: import writes version/workouts/slots/sets matching the spec order;
  stored text re-encodes to the original bytes; duplicate import returns the same id with
  `created=False` and `total_changes` unchanged; same JSON + other notes → new inactive
  version; missing exercise refuses listing all missing identities and writes nothing;
  retired exercise refused; import does not activate; activate/switch/deactivate; activate
  unknown id refused; zero active allowed.
- [ ] Implement, gates, commit `feat(storage): append-only program import and single active version`.

### Task 4: Draft open/resume and provenance

**Files:** Create `storage/entry.py`; Test `tests/test_entry.py`.

**Interfaces (produces):**
- `class NotFound(LookupError)`, `class Conflict(RuntimeError)`
- `Origin(planned_workout_id, planned_workout_name, workout_key, program_version_id, program_name, version_label)`
- `OpenResult(workout: Workout, created: bool)`
- `open_planned_workout(conn, planned_workout_id, *, performed_on: str, now=None) -> OpenResult`
- `create_unplanned_workout(conn, *, performed_on: str, performed_time_local=None, notes=None, now=None) -> Workout`
- `get_origin(conn, workout_id) -> Origin | None`

- [ ] Failing tests: open creates exactly one workout and zero sets and an origin row;
  second open resumes the same id; opening after completion creates a new draft; opening
  a planned workout of an inactive version with no draft → `Conflict`; with a draft →
  resumes; switching active version leaves existing draft origin unchanged; origin read
  back from the table; M1 workouts have `None` origin; two threads opening concurrently on
  separate connections produce one workout; unknown planned workout → `NotFound`.
- [ ] Implement, gates, commit `feat(storage): transactional open/resume of planned workouts with immutable origin`.
- [ ] **Gate: independent provenance/draft-opening review (subagent).**

### Task 5: Actual sets, lifecycle, substitution, last performance, aggregate

**Files:** Modify `storage/entry.py`; Test `tests/test_entry.py`.

**Interfaces (produces):**
- `add_set(conn, workout_id, *, exercise_id, set_type, load_kg, reps, rir, notes, now=None) -> PerformedSet`
- `edit_set(conn, set_id, changes: Mapping[str, object], *, now=None) -> PerformedSet` (keys ⊆ `exercise_id,set_type,load_kg,reps,rir,notes`)
- `remove_set(conn, set_id) -> None`; `reorder_sets(conn, workout_id, set_ids: Sequence[str]) -> tuple[PerformedSet, ...]`
- `complete(conn, workout_id, *, now=None) -> CompletionReport` (raises `Conflict` carrying the report on blockers)
- `reopen(conn, workout_id, *, now=None) -> Workout`
- `edit_workout(conn, workout_id, changes, *, now=None) -> Workout`; `discard_draft(conn, workout_id) -> None`
- `set_slot_exercise(conn, workout_id, slot_id, exercise_id, *, now=None) -> None`
- `LastPerformance(workout_id, performed_on, performed_time_local, sets: tuple[PerformedSet, ...])`
- `last_performance(conn, exercise_id, *, exclude_workout_id=None) -> LastPerformance | None`
- `EntryAggregate(workout, origin, slots: tuple[EntrySlot, ...], sets, exercises: dict[str, Exercise], last_performance: dict[str, LastPerformance | None])`, `EntrySlot(slot: SlotRow, substitute_exercise_id: str | None)`
- `load_entry(conn, workout_id) -> EntryAggregate`; `list_recent_workouts(conn, limit) -> tuple[WorkoutSummary, ...]`

- [ ] Failing tests: add appends dense orders; edit clears with explicit None and keeps
  omitted fields; mutations on complete refused; reorder rejects non-permutations and
  applies a permutation; delete renumbers; complete blocked (C1/C2/C4) leaves draft and
  returns blockers; complete persists C3 renumbering and status together; reopen; A/B/A
  slots substitute independently; selecting the original clears; unknown/other-workout
  slot → `NotFound`/`Conflict`; last performance ignores drafts, picks the most recent
  complete by date/time/entered order, returns only that exercise's sets in order, excludes
  the current workout, never matches a different exercise with the same name on other
  equipment; aggregate contains slots, substitution, sets and last performance.
- [ ] Implement, gates, commit `feat(storage): workout entry operations, substitution and last exact performance`.

### Task 6: HTTP API and CLI

**Files:** Create `api/schemas.py`, `cli.py`; Modify `api/app.py`, `pyproject.toml`
(`[project.scripts] fitness-lab = "fitness_lab.cli:main"`); Test `tests/test_entry_api.py`,
`tests/test_cli.py`.

- [ ] Failing API tests for every route in spec §7 including 404/409/422 paths, loads as
  strings, `origin` from persistence, open idempotency, and zero sets after open.
- [ ] Failing CLI tests: `import-program` twice prints the same version id and
  `created=false`; `activate-program`; `ensure-exercises` creates only missing identities.
- [ ] Implement, gates, commit `feat(api): thin Workout Entry API and program CLI`.

### Task 7: Locked program adapter and package

**Files:** Create `domain/locked_program.py`, `tests/test_locked_program.py`,
`programs/advanced-natural-12w/source/locked_workout_program.json` (byte copy),
`programs/advanced-natural-12w/package/{program.json,program-notes.md,exercises.json}`.

**Interfaces:** `adapt_locked_program(source: bytes, source_name: str) -> AdaptedProgram(program_json: bytes, notes_md: bytes, exercises_json: bytes)`; refuses on failed source integrity checks.

- [ ] Failing tests with a trimmed fixture and the real file when present: determinism
  (two runs byte-equal); 4 workouts, 29 slots, 81 sets; RIR mapping; slash-names split;
  integrity failure refused; output parses with `parse_program_package`.
- [ ] Implement; generate the package via CLI; commit
  `feat(program): deterministic adapter and package for the locked 12-week program`.

### Task 8: Workout Entry frontend

**Files:** web files from the file map; tests `web/src/**/*.test.tsx`.

- [ ] Typed client + types mirroring §7; hash router.
- [ ] Home: active program header, planned sessions with Open/Resume, unplanned start,
  recent workouts; empty state when no active program.
- [ ] Entry: header (name/origin, date, status, complete/reopen/discard), slot cards
  PLANNED | ACTUAL, set rows (load/reps/RIR/type/notes) saving on commit, add/delete/move,
  substitution picker, last performance, extra exercises, create exercise.
- [ ] Vitest/RTL tests with mocked fetch: home renders sessions; open navigates; entry
  renders planned vs actual separately; adding a set posts; complete surfaces blockers.
- [ ] Gates + build; commit `feat(web): Workout Entry V1`.

### Task 9: E2E on a scratch database

**Files:** `e2e/playwright.config.ts`, `e2e/scripts/serve-scratch.sh`,
`e2e/fixtures/program/*`, `e2e/tests/workout-entry.spec.ts`, `e2e/tests/m0-smoke.spec.ts`.

- [ ] Config defaults `FITNESS_LAB_DB` to a fresh scratch path, never reuses an existing
  server, seeds exercises + imports + activates the fixture program before the launcher.
- [ ] Journey: active program; planned list; open empty draft (DB shows zero sets); enter
  set; reload resumes; edit/delete/reorder; substitution; complete; reopen; last
  performance on a later session; restart the launcher on a second port with the same DB;
  data persists; every request host is 127.0.0.1; clean shutdown.
- [ ] Commit `test(e2e): Workout Entry journey on a scratch database`.

### Task 10: Whole-branch review and release

- [ ] High-rigor whole-branch review (subagent); fix Critical/Important; scoped re-review.
- [ ] Fresh full gates (backend, frontend, build, E2E on scratch).
- [ ] Rehearsal: byte-identical copy of canonical DB → `migrate_to_head` → ledger,
  checksums, FK, quick/integrity, second bootstrap no-op, M1 rows preserved, then
  exercises/import/activate on the copy and verify 4 sessions / 29 slots / 81 sets.
- [ ] Integrate into `main` (fast-forward), update `CLAUDE.md`.
- [ ] Canonical: stop nothing running, record hash/stat, migrate (snapshot taken by the
  runner, verified), verify, ensure exercises, import, activate, verify, launcher smoke
  (read-only navigation), record final hash/stat. Remove the implementation worktree.
