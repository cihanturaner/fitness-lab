# V3.3 — Daily use finalization

Date: 2026-09-24. Supersedes V3.2 only where stated; the V3.1/V3.2 visual identity,
navigation and motion stay as they are. No PR detection, e1RM, food database, analytics or
new dashboard.

## 1. Change an exercise for this workout only

- Every planned exercise of a **draft** workout has a secondary **Change** action (text button
  in the exercise header). It opens an inline "Change exercise" panel: the slot's **approved
  substitutes**, a search over **other existing exercises**, and "Back to <planned>" when the
  slot was changed. Complete workouts are reopened first (unchanged M1 lifecycle).
- Storage is the existing `workout_slot_substitution` (one row per workout and slot). The
  planned slot, its program version, the package and every other workout (earlier or later
  occurrences) are untouched; the next occurrence opens on the planned exercise.
- Approved substitutes are read from the slot's locked notes (`Approved substitutes: A, B.`,
  written verbatim from the source `substitution_matrix` by the adapter). A trailing source
  condition ("Lying Leg Curl if unavailable/intolerant") is shown beside the name.
  `PUT /api/workouts/{id}/slots/{slot}/approved-substitute {name}` accepts only a name on that
  slot's list, finds the exercise identity by the M1 identity rule (name, no equipment) or
  creates it once, and substitutes — one transaction. A retired identity is refused.
- Both identities stay visible: the workout shows "Planned: X · changed for this workout",
  History shows "Planned: X" under the performed exercise, and exercise history marks an
  exposure "in place of X".

## 2. Macro targets (migration 0007)

- A target is **protein / carbohydrate / fat in grams**; its calories are derived, P × 4 +
  C × 4 + F × 9 (`domain.nutrition.MacroTargets`). There is no separately entered calorie
  target.
- `macro_target` is append-only and effective-dated: the target in force on a date is the row
  with the latest `effective_on` on or before it (ties: latest `set_at_utc`, then rowid). A
  change is effective from its date on; earlier days keep — and are judged by — the target in
  force on them (`NutritionDay.target`, History's "target N").
- Migration 0007 converts every pre-V3.3 `calorie_target` row into a `macro_target` row with
  the same id by the source's own rule of that era (145 P, 60 F, carbohydrate
  (kcal − 1120) / 4 half-up, exactly as V3.2 displayed it), keeps the original row and links it
  (`from_calorie_target_id`, shown as "set as N"), then closes `calorie_target` to inserts.
  `controller_event` is rebuilt with the same rows so an applied decision references its
  `macro_target`; `previous_calorie_target_kcal` no longer carries the locked 1120 floor.
- The first target form offers the source's locked 145 g protein and 60 g fat and the source's
  starting rule (recent stable intake + 150 kcal; carbohydrate the remainder).
- The controller stays decision support. A calorie recommendation (+150 / −100 kcal) is shown
  with the current macro targets and the exact proposed target: protein and fat unchanged,
  carbohydrate moved by the change / 4 rounded half-up (+38 g / −25 g), as the source's
  `primary_macro_adjusted: carbohydrate` says. Only an explicit **Apply** records it; the
  weeks 1–2 exception rule is unchanged.

## 3. History is day by day

- `#/history` is a newest-first timeline, one card per date ("THU 24 SEP") holding only what
  was recorded that day: complete workouts (name, **Shortened** when fewer non-warm-up sets
  than planned, "N of M working sets", each exercise's sets as lb × reps @ RIR, "Planned: X"
  for a changed exercise), bodyweight, and nutrition (kcal · P · C · F and that day's target).
  Filters: All · Training · Bodyweight · Nutrition. "Earlier days" pages by date.
  `GET /api/history/days?kind=&before=&limit=`.
- Exercise history is secondary: the **Exercises** tab (`#/history/exercises`) and every
  exercise name in the timeline (`#/history/<exerciseId>`). Sessions stay a third tab.

## 4. Program rules in Turkish

Settings › Program rules shows `web/src/features/settings/program-notes.tr.md`, a
source-faithful Turkish translation of the package's `program-notes.md`, only when the active
notes' sha256 equals the translated source (`TURKISH_SOURCE_SHA256`); any other program's
notes are shown as imported. Exercise names, session names, numbers, RIR, P1/P2/P7′, the e1RM
formula and the source status codes are verbatim; booleans read evet / hayır. Unit tests pin
the source hash, every heading, every number per section, JSON shapes and exercise names.

## 5. Discard draft

"Discard draft" sits in the workout header of every draft. An empty draft asks a light
confirmation; a draft with sets asks inside the page, naming what was recorded, and a
safety snapshot is taken before the delete (existing `discard_draft`). Only the workout goes;
the planned session and the program stay. The screen returns to where it was opened from, and
Home / Training re-read on arrival.

## Verification

- Backend: `test_v33.py` (approved and arbitrary substitution with the real locked package,
  plan unchanged, next occurrence restored, refusals, discard both ways, targets across a
  restart, day timeline, filters, paging), `test_macro_targets_migration.py` (0007 over legacy
  targets and decisions), macro-target storage / API / controller tests.
- Web unit: Change panel, discard confirmations, macro target form, per-day targets, weekly
  review proposal, day timeline, Turkish rules fidelity.
- E2E `v33-daily-use` (port 8716, own scratch database); screenshots in `artifacts/v33/` at
  1440×900 and 1728×1117.
