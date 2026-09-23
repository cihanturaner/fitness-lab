# V2 — Product UX, Bodyweight, Nutrition, History (implementation note)

Status: locked for implementation, 2026-09-23. Builds on M1 and M2; every invariant stands.
The backend training model (workouts, performed sets, program versions, drafts, provenance,
substitutions, last performance, completion/reopen, snapshots) is **unchanged**.

Scope: five screens — Week (home), Workout, Bodyweight, Nutrition, History. Logging and
visibility only: no nutrition controller, no automatic calorie changes, no regression trend,
no body-fat logic, no PR/e1RM, no recommendations.

## 1. Migration `0004_bodyweight_nutrition.sql` (additive only)

| Table | Columns and rules |
|---|---|
| `bodyweight_entry` | `measured_on` TEXT PK (canonical `YYYY-MM-DD`); `bodyweight_g` INTEGER NOT NULL, 20 000–300 000 (exact integer grams, M1 unit philosophy); `notes` nullable, non-blank; `entered_at_utc`, `updated_at_utc`. One entry per date. |
| `nutrition_day` | `logged_on` TEXT PK; `calories_kcal` 0–15 000, `protein_g`, `carbs_g`, `fat_g` 0–1 500 — integers, each nullable (a partly logged day is truthful), at least one present; `notes`; stamps. One row per date. |
| `calorie_target` | `id` PK; `effective_on` date; `calories_kcal` 1 120–10 000; `notes`; `set_at_utc`. **Append-only** (UPDATE/DELETE abort by trigger): the history of explicit user decisions, the raw material for a later controller. The target in force on a date is the row with the latest `effective_on ≤ date` (ties: latest `set_at_utc`, then `rowid`). No row = not calibrated. |
| `training_block` | `program_version_id` PK → `program_version` RESTRICT; `start_on` date; `set_at_utc`. State (replaceable), set from the CLI only, like activation. |

Nothing existing is altered, rebuilt or backfilled.

## 2. Domain rules (pure, TDD)

- **Bodyweight input**: plain decimal kg, ≤ 2 decimals, 20–300 kg → integer grams.
- **7-day average** for reference date R: mean of the entries dated in [R−6, R]; the
  previous average uses [R−13, R−7]. Each reports its entry count (n/7) — no
  interpolation, no minimum. Change = current − previous (kg) and ÷ previous (%), from the
  exact means, rounded half-up to 0.01 only for display. Missing window → null.
- **Chart series**: per calendar date, the day's weight (or null) and the trailing 7-day
  mean of entries in [d−6, d] (null when that window is empty).
- **Nutrition targets** (source: `programs/advanced-natural-12w-nutrition/artifact/locked_nutrition_tracker.json`,
  sha256 `dc06a4d4…c44d459`): protein 145 g, fat 60 g, locked. Calorie target unknown
  until the user sets one; carbohydrate target = (calories − 1120) / 4, rounded half-up
  to whole grams (2650 → 383, the source's own example); unknown while calories are.
  The app never sets or changes calories itself.
- **Block week**: week 1 is the Monday–Sunday week containing `start_on`; week n is
  `(monday(d) − monday(start_on)) / 7 + 1`. Before the block → "starts on …"; after
  `duration_weeks` → "block finished".
- **Session status for a week** (per planned workout): an open draft → `draft`
  (Resume); else a complete workout with this origin performed in the week → `complete`;
  else `not_started` (Open). Weekday comes from the planned workout's `day_label`.

## 3. HTTP API (additions; loads/weights as decimal strings)

| Route | Purpose |
|---|---|
| `GET /api/week?date=` | block, week bounds, 7 days with planned sessions + status, unplanned workouts that week |
| `GET /api/bodyweight?date=&days=` | entries, summary (latest, 7-day avg, previous, change kg/%), chart series |
| `PUT /api/bodyweight/{date}` / `DELETE` | upsert one day / remove a mistaken day |
| `GET /api/nutrition?date=` | that day's log, targets in force, last 14 days, target history |
| `PUT /api/nutrition/{date}` / `DELETE` | upsert / remove a day's log |
| `POST /api/nutrition/calorie-targets` | append an explicit calorie target decision |
| `GET /api/history/exercises` | exercises with completed exposures |
| `GET /api/exercises/{id}/history` | completed exposures, chronological, sets in `set_order`, block week |
| `GET /api/history/recent?limit=` | recent completed sessions with their exercises (home) |

History reads only `complete` workouts' `performed_set` rows: no aggregation tables.

## 4. CLI

`uv run fitness-lab set-block-start YYYY-MM-DD [VERSION_ID]` (default: active version).

## 5. Frontend

Hash routes `#/`, `#/workouts/{id}`, `#/bodyweight`, `#/nutrition`, `#/history`,
`#/history/{exerciseId}`, `#/sessions`. Workout Entry becomes one compact block per
exercise (name; `Target …` and `Last …` lines; SET/KG/REPS/RIR/TYPE grid; `+ Set`), with
slot notes and substitution behind small affordances. Pending rows are UI-only: nothing is
written until the lifter saves a row (leaving it or Enter) with valid reps; the set type is
never taken from the plan (the first set of an exercise needs a choice, later rows offer the
previous row's); the next row may start with the previous row's load, which is not counted
as typed input. The unsaved-input registry and completion guard are unchanged.
