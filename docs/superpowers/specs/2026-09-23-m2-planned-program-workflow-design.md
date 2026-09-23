# M2 — Planned Program Workflow and Workout Entry V1 Design

Status: approved for implementation (compressed design gate, 2026-09-23).
Release target: usable local V1 no later than 2026-09-24; real logging starts 2026-10-01.
Builds on: `2026-09-07-m1-domain-persistence-design.md` (M1). Every M1 invariant stands.

## 1. Purpose and scope

M2 adds the **planned** side of training and the first product screen, Workout Entry.
The lifter can see the active 12-week program, open a planned session as an empty draft,
record what actually happened next to what was prescribed, substitute a whole exercise
slot, see the last exact performance of an exercise, complete, reopen and correct.

In scope: program package parsing/hashing/validation, one additive migration, program
import and activation, immutable workout plan provenance, draft open/resume, whole-slot
substitution, last exact performance, a thin HTTP API, the Workout Entry frontend, a
command-line tool for import/activation, the deterministic adapter for the user's locked
program artifact, and release verification.

Out of scope (not built): dashboard, charts, e1RM, PR engine, progression engine,
adherence scoring, nutrition, bodyweight, calendar, notifications, auth, cloud, mobile, PWA.

## 2. Binding invariants (additions to M1)

1. **Planned is never performed.** Opening a plan creates exactly one `workout` row and
   zero `performed_set` rows. No code path copies a planned set into actual evidence.
2. **Imported program content is append-only.** `program_version`, `planned_workout`,
   `planned_exercise_slot` and `planned_set` reject every `UPDATE` and `DELETE` by trigger.
3. **At most one active program version, zero allowed.** Activation is state kept apart
   from content, in a singleton table.
4. **Provenance is immutable.** A workout's planned origin is set once, at creation, and
   can never be changed or cleared (trigger-enforced); it disappears only with its workout.
5. **Drafts never rebind.** A draft keeps its origin when the active version changes.
6. **Unplanned workouts are first-class.** No origin row means "not planned" — not missing.
7. **Extra actual work is legal.** Any exercise and any number of sets may be recorded in
   any workout, planned or not.
8. **No performed_set → planned_set link.** Actual sets carry no pointer to prescriptions.
9. **Kilograms, exact.** Target loads use M1's integer-gram storage and `kg_to_g`.

## 3. Adaptation note: provenance lives in a link table

The mission brief describes "nullable immutable planned-workout provenance on `workout`".
M1 §17 contracts that `workout` and `performed_set` are never altered and that plan
attachment is an association table. M2 honours M1: provenance is the table
`workout_plan_origin (workout_id PRIMARY KEY → workout, planned_workout_id → planned_workout)`.
Semantically this *is* a nullable, immutable attribute of the workout — absent row = NULL —
and every read returns it as `workout.origin`. It is stored without rebuilding or altering
the table that holds irreplaceable data.

## 4. Schema (migration `0003_planned_program.sql`, additive only)

```
program_version ─┬─< planned_workout ─< planned_exercise_slot ─< planned_set
                 │                           │  (exercise_id → exercise)
active_program_version (singleton)           │
                                             │
workout ──(1:0..1)── workout_plan_origin ────┘ (planned_workout_id)
   └──< workout_slot_substitution  (workout_id, planned_workout_id) → origin
                                    (slot_id,    planned_workout_id) → slot
```

### 4.1 `program_version` (content, immutable)

| Column | Rule |
|---|---|
| `id` | TEXT PK, domain `uuid4().hex` |
| `program_key` | non-blank slug from `program.key`; versions of one program share it |
| `name` | non-blank |
| `version_label` | nullable, non-blank when present |
| `duration_weeks` | nullable integer ≥ 1 |
| `package_format` | integer, `1` |
| `package_sha256` | UNIQUE, 64 lowercase hex — identity of the exact package |
| `program_json_sha256` | 64 lowercase hex over the exact original bytes |
| `program_json_text` | exact decoded text (re-encodes to the original bytes) |
| `notes_sha256`, `notes_text` | both NULL or both present (`program-notes.md`) |
| `imported_at_utc` | UTC ISO-8601 |

### 4.2 `planned_workout` (content, immutable)

`id` PK; `program_version_id` → `program_version` RESTRICT; `workout_key` slug;
`sequence` ≥ 1 (array order); `name` non-blank; `day_label` nullable; `notes` nullable.
UNIQUE `(program_version_id, workout_key)`, UNIQUE `(program_version_id, sequence)`.

### 4.3 `planned_exercise_slot` (content, immutable)

`id` PK; `planned_workout_id` → `planned_workout` RESTRICT; `slot_key` slug;
`position` ≥ 1; `exercise_id` → `exercise` RESTRICT; `notes` nullable.
UNIQUE `(planned_workout_id, slot_key)`, UNIQUE `(planned_workout_id, position)`,
UNIQUE `(id, planned_workout_id)` (composite FK target for substitution).
The slot — not the exercise — is the identity of an occurrence, so A/B/A in one session
is three distinct slots even when two reference the same exercise.

### 4.4 `planned_set` (content, immutable) — rep-based only

| Column | Rule |
|---|---|
| `slot_id` | → `planned_exercise_slot` RESTRICT |
| `position` | ≥ 1, UNIQUE per slot |
| `set_type` | NOT NULL → `set_type(code)` (a prescription is always classified) |
| `reps_min` | NOT NULL, ≥ 1 |
| `reps_max` | NULL = open-ended/AMRAP; else ≥ `reps_min`. Exact: equal. Range: greater |
| `target_rir_min`, `target_rir_max` | both NULL or both set, `min ≤ max`; exact RIR: equal |
| `target_load_g` | nullable integer grams ≥ 0 (M1 unit semantics) |
| `notes` | nullable |

No duration, distance, tempo, rest or percentage fields.

### 4.5 `active_program_version` (state)

`singleton INTEGER PK CHECK (singleton = 1)`, `program_version_id` NOT NULL → RESTRICT,
`activated_at_utc`. Zero rows = no active version. Activation is `INSERT … ON CONFLICT`
replace of the single row; deactivation deletes it.

### 4.6 `workout_plan_origin` (provenance, immutable)

`workout_id` PK → `workout` ON DELETE CASCADE; `planned_workout_id` NOT NULL →
`planned_workout` RESTRICT; `created_at_utc`; UNIQUE `(workout_id, planned_workout_id)`.
Triggers: any `UPDATE` aborts; a `DELETE` aborts while the workout row still exists
(so only the workout's own deletion — draft discard or M1's guarded complete delete —
removes it; verified: the parent row is already gone when the cascade fires).

### 4.7 `workout_slot_substitution` (actual-side decision)

PK `(workout_id, slot_id)`; `planned_workout_id`; `exercise_id` → `exercise` RESTRICT;
`created_at_utc`, `updated_at_utc`.
- FK `(workout_id, planned_workout_id)` → `workout_plan_origin` ON DELETE CASCADE.
- FK `(slot_id, planned_workout_id)` → `planned_exercise_slot(id, planned_workout_id)`.
Together these make a cross-workout attachment structurally impossible: the slot's
planned workout must equal the workout's origin, and unplanned workouts (no origin row)
cannot hold substitutions at all.
Triggers: insert/update abort when `exercise_id` equals the slot's planned exercise
(selecting the original clears instead); insert/update/delete abort while the workout is
`complete` (reopen first). Cascade deletion of a deleted workout is unaffected.

Nothing is backfilled. Existing M1 workouts have no origin row and are unplanned.

## 5. Program package

A package is `program.json` plus optional `program-notes.md`, read as raw bytes.

### 5.1 Artifact preservation (both files)

Reject a UTF-8 BOM; decode strict UTF-8 (reject invalid sequences); reject NUL bytes; do
not normalise line endings; keep trailing newline and non-ASCII as-is. SHA-256 is
computed over the exact original bytes; the stored text re-encodes byte-identically.

### 5.2 Hashes

`program_json_sha256 = sha256(program.json bytes)`,
`notes_sha256 = sha256(program-notes.md bytes)` or none.
`package_sha256 = sha256("fitness-lab.program-package.v1\nprogram.json <hex>\nprogram-notes.md <hex|->\n")`.
Exact duplicate import (same `package_sha256`) returns the existing version with zero
writes. Same JSON with different notes has a different package hash and imports as a new,
inactive version.

### 5.3 `program.json` format 1 (strict: unknown keys, duplicate keys, floats refused)

```json
{
  "format": "fitness-lab.program",
  "format_version": 1,
  "program": {"key": "slug", "name": "…", "version_label": "1.0.0", "duration_weeks": 12, "notes": "…"},
  "workouts": [
    {"key": "upper_a", "name": "Upper A", "day_label": "Monday", "notes": "…",
     "slots": [
       {"key": "upper_a.01",
        "exercise": {"name": "Smith Flat Bench Press", "equipment_label": null},
        "notes": "…",
        "sets": [
          {"set_type": "working", "reps_min": 5, "reps_max": 8,
           "target_rir_min": 2, "target_rir_max": 2, "target_load_kg": null, "notes": null}
        ]}
     ]}
  ]
}
```

Rules: keys match `^[a-z0-9][a-z0-9_.-]*$` and are unique in scope; names non-blank;
optional strings non-blank when present; integers are real integers (bool refused);
`reps_max` key is **required** (explicit `null` for open-ended) so a forgotten maximum can
never silently become AMRAP; `target_load_kg` is a decimal string or null (M1 `kg_to_g`
exactness); every list non-empty; order in arrays defines `sequence`/`position`.

### 5.4 Import

`import_program_package` runs in one `BEGIN IMMEDIATE` transaction: duplicate check, then
exercise resolution by exact normalised `(name, equipment_label)` identity (M1 §5.3) —
**import never creates exercises**; missing or retired identities refuse the whole import
listing every offender — then append-only inserts. Import does not activate.

## 6. Workflows

### 6.1 Open / resume a planned workout — `open_planned_workout`

One `BEGIN IMMEDIATE` transaction (serialises concurrent openers across processes):
1. Load the planned workout; unknown → not found.
2. Find an existing **draft** whose origin is this planned workout (latest `entered_at_utc`,
   then `id`); if found, return it with `created = false`. Works for inactive versions.
3. Otherwise the planned workout's version must be the active version, else refuse.
4. Create one M1 draft (`new_draft_workout`) and its origin row. Zero performed sets.
A retry after success resumes. A completed earlier occurrence does not block a new one,
so the same template is performed across all 12 weeks.

### 6.2 Unplanned workout

`new_draft_workout` + `insert_workout`, no origin row.

### 6.3 Actual sets (drafts only)

Create appends at `max(set_order)+1` under any exercise; edit replaces the supplied fields
(explicit `null` clears); delete uses M1 `delete_performed_set` (renumbers); reorder takes
the complete permutation of the workout's set ids and rewrites `set_order` via M1's
offset-pass renumbering. All set mutations on a `complete` workout are refused (409):
correction goes through reopen, exactly as M1 §6.

### 6.4 Complete / reopen / correct

Complete: M1 `complete_workout` (C1–C4) and, in the same transaction, persistence of C3's
renumbering and the status. Blockers return 409 with the report. Reopen: M1
`reopen_workout`. Workout metadata (`performed_on`, `performed_time_local`, `notes`) is
editable via M1 `update_workout`. A draft may be discarded (M1 `delete_draft_workout`);
deleting a complete workout stays storage-only (M1 guarded path), not exposed over HTTP.

### 6.5 Whole-slot substitution

`set_slot_exercise(workout, slot, exercise)`: if `exercise` is the slot's planned exercise,
delete the substitution row (clear); else upsert. Schema guarantees origin = slot's
planned workout and refuses complete workouts. Slots substitute independently.

### 6.6 Last exact performance

`last_performance(exercise_id, exclude_workout_id)`: the most recent `complete` workout
(order: `performed_on` DESC, `performed_time_local` DESC NULLS LAST, `entered_at_utc` DESC,
`id` DESC) holding at least one set of exactly that `exercise_id`, excluding the workout
being edited; returns that workout's sets for the exercise in `set_order`. No fuzzy
matching, no substitution-family merging, no calculations.

### 6.7 Displaying actual work against slots (derived, not stored)

Actual sets are grouped by `exercise_id`. A slot's *effective exercise* is its substitute
or its planned exercise. Each exercise group is shown under the first slot (by position)
whose effective exercise matches; later slots with the same effective exercise point to
it; groups matching no slot are shown as extra exercises. This is presentation only and
follows directly from invariant 8.

## 7. HTTP API (JSON, relative `/api`, loads as decimal strings)

| Method & path | Purpose |
|---|---|
| `GET /api/program/active` | active version (or null) + planned workouts with draft/complete counts |
| `GET /api/planned-workouts/{id}` | full prescription (slots, exercises, sets) |
| `POST /api/planned-workouts/{id}/open` | open/resume → `{workout_id, created}` |
| `POST /api/workouts` | create unplanned draft |
| `GET /api/workouts` | recent workouts (for resume and correction) |
| `GET /api/workouts/{id}/entry` | Workout Entry aggregate: workout, origin, slots with prescriptions and substitution, actual sets, exercises, last performance per exercise |
| `PATCH /api/workouts/{id}` | correct date/time/notes |
| `DELETE /api/workouts/{id}` | discard a draft |
| `POST /api/workouts/{id}/sets` | create actual set |
| `PATCH /api/sets/{id}` | edit actual set |
| `DELETE /api/sets/{id}` | delete actual set |
| `PUT /api/workouts/{id}/set-order` | reorder (full permutation) |
| `PUT /api/workouts/{id}/slots/{slot_id}/exercise` | set/clear substitution |
| `POST /api/workouts/{id}/complete` / `reopen` | lifecycle |
| `GET/POST /api/exercises` | catalogue; create via M1 `create_exercise` |
| `GET /api/exercises/{id}/last-performance` | last exact performance |

Errors: 404 unknown ids, 409 lifecycle/state conflicts, 422 validation. The provenance
returned is always read back from `workout_plan_origin`, never echoed from the request.

## 8. Command-line tool (`uv run fitness-lab …`)

`adapt-locked-program SRC OUT_DIR`, `ensure-exercises MANIFEST`, `import-program DIR`,
`activate-program VERSION_ID`, `deactivate-program`, `list-programs`. Every command runs
`migrate_to_head` first and honours `FITNESS_LAB_DB`.

## 9. Locked 12-week program adapter

Source: `locked_workout_program.json` (sha256 `81a7d4bc…d7b24e`), preserved unchanged and
copied byte-identically into `programs/advanced-natural-12w/artifact/`; the generated package lives in `programs/advanced-natural-12w/package/`. The adapter is pure
and deterministic:
- 4 sessions → 4 planned workouts in weekly order; `day_label` from the schedule.
- Each exercise row → one slot; `sets` × one planned `working` set; `rep_range` → reps
  min/max; `rir_by_set` `"2"` → 2..2, `"0-1"` → 0..1; no target load.
- Marker, failure policy, rest and angle become slot notes; the program's approved
  substitutes are listed in slot notes.
- Names containing an equipment alternative (`Cable/Machine Lateral Raise`,
  `Smith/Machine Hip Thrust`) are **not** merged into one identity: the slot plans the
  first-named variant and the second variant is created as its own exercise so a whole-slot
  substitution records the truth.
- The source's own `integrity_checks` (29 rows, 81 work sets, per-session sets, 8/21
  failure rows, 3 markers) must pass or the adapter refuses.
- Outputs `program.json`, `program-notes.md` (source hash, non-structural guidance) and
  `exercises.json` (identities to ensure before import).

## 10. Frontend — Workout Entry V1

Hash routes: `#/` (program + planned sessions + unplanned start + recent workouts) and
`#/workouts/{id}` (entry). Reload restores the route and re-reads server state; every edit
is persisted immediately, so a draft survives refresh and restart. Each slot card shows
PLANNED (exercise, prescribed sets with reps/RIR/load, notes, last exact performance,
substitution control) beside ACTUAL (set rows with load, reps, RIR, set type; add, edit,
delete, move up/down). Extra exercises can be added from the catalogue or created.
Complete shows blockers/advisories; complete workouts are read-only until reopened.
Visual language: restrained laboratory instrument — neutral surfaces, tabular numerals,
one accent, no gamification.

## 11. Verification

Backend pytest (schema constraints and triggers, package parsing, import idempotency,
open/resume concurrency, provenance immutability, substitution structure, last
performance, API), ruff, format, strict mypy; frontend typecheck, lint, Vitest, build;
Playwright against a scratch database through the real launcher, including restart and an
external-request audit; migration rehearsal on a byte-identical copy of the canonical
database; then the controlled canonical migration and a non-destructive smoke.

## 12. Risks and decisions recorded

- Program activation is CLI-only in V1 (deliberate: a mis-click cannot switch programs).
- Two drafts from one planned workout can exist only via reopening a completed one; open
  resumes the most recently started.
- Week numbering and schedule adherence are not modelled; the 12-week template is
  performed repeatedly. Deload/week-12 rules remain guidance in program notes.
- Nutrition is the next milestone after V1.
