# V3.3 — Daily use finalization (task file)

Started 2026-09-24 from HEAD `2d5e98c` (V3.2). Scratch databases only; the canonical
`data/fitness_lab.db` is never written by development, tests or E2E.

## Requirements

1. **Change exercise for this workout** — every slot in an active (draft) Workout Entry has a
   secondary "Change" action: approved substitutes (from the slot's locked notes) and any
   other existing exercise. Affects only that workout (`workout_slot_substitution`); the
   locked package, next week's plan and future occurrences stay as planned. Planned and
   performed identities are both kept and shown (History: "Planned X · Performed Y").
2. **Macro targets** — P / C / F grams are the targets; target kcal = P×4 + C×4 + F×9.
   No independent calorie target. Effective-dated, append-only history; old days are judged
   by the targets in force on them. Controller stays decision support: a calorie
   recommendation is shown with the current macro targets and applied only by an explicit
   action.
3. **Day-by-day History** — default History is a newest-first timeline, one card per date
   holding training / bodyweight / nutrition present on it; filters All · Training ·
   Bodyweight · Nutrition; shortened and substituted work explicit. Exercise history stays as
   a secondary view (click an exercise name).
4. **Program Rules in Turkish** — every heading and all content of Settings › Program rules,
   source-faithful (numbers, names, RIR, rules unchanged).
5. **Discard draft** — light confirmation for an empty draft, stronger one when sets exist;
   removes only the workout instance; Home / Training update immediately.
6. **Effective-dated targets** — see 2.

## Findings (repository evidence)

- Substitution already exists end to end in the backend (`workout_slot_substitution`,
  `entry.set_slot_exercise`, `PUT /api/workouts/{id}/slots/{slot}/exercise`) and behind a
  small icon + `<select>` in `ExerciseBlock`. Approved substitutes exist only as text in slot
  notes ("Approved substitutes: A, B.") and mostly are not exercise identities yet.
- Draft discard already exists (`entry.discard_draft`, snapshot before discarding a draft
  with sets; `DELETE /api/workouts/{id}`), hidden inside the Workout "Details" panel.
- Calorie target model: `calorie_target` (append-only, kcal only, 1120–10000); protein 145 /
  fat 60 hard-coded in `domain/nutrition.py`; carbs = (kcal − 1120)/4.
  `controller_event.new_calorie_target_id` → `calorie_target(id)` and
  `previous_calorie_target_kcal` CHECK 1120–10000.
- Source (`locked_nutrition_tracker.json`): `controller_rules[*].primary_macro_adjusted =
  "carbohydrate"`, `automatic_apply: false`. So a calorie recommendation moves carbohydrate;
  that is the source's own rule, not an invented one.
- Canonical DB (byte copy inspected, sha256 0ce9f5d6…): 0 calorie targets, 0 controller
  events, 1 nutrition day, 4 bodyweights, 3 workouts (1 draft), 0 substitutions. A V3.2
  server was listening on 127.0.0.1:8000 during the work (not touched).
- Program rules come from `program-notes.md` of the imported package (notes_sha256
  `2080af04…`). Changing the package would create a new program version, so the Turkish
  text lives in the web app and is shown only when the active notes hash matches.

## Decisions (inferred, recorded)

- D1 Macro targets: new append-only `macro_target` table (migration 0007). Legacy
  `calorie_target` rows are converted once, in the migration, by the source's own rule
  (P 145, F 60, C = round-half-up((kcal − 1120)/4)) with a link to the original row; the
  original rows stay untouched and `calorie_target` is closed to new rows.
- D2 `controller_event` is rebuilt (same rows) so an APPLIED decision references the new
  macro target; legacy links are kept; `previous_calorie_target_kcal` no longer requires the
  locked 1120 floor (targets are the lifter's P/C/F now).
- D3 Controller Apply: new target = current P and F unchanged, carbs + round-half-up(Δkcal/4)
  (`primary_macro_adjusted: carbohydrate`); shown before applying, applied only on click.
- D4 Approved substitute that is not an exercise identity yet is created (find-or-create by
  identity) server-side, only when it is on that slot's approved list; retired identities
  are refused, never revived.
- D5 Turkish rules: exercise names, enum-like source codes (FINAL_PATCHED_LOCKED, P1, P2,
  P7′, RIR, ROM, e1RM) stay verbatim; everything else is translated.

## Status

| Item | Status |
| --- | --- |
| Task file | done |
| Backend: macro targets + migration 0007 | done |
| Backend: approved substitutes + day history API | done |
| Web: Change exercise | done |
| Web: discard draft | done |
| Web: nutrition targets (+ controller proposal shown before Apply) | done |
| Web: day History (exercise history secondary) | done |
| Web: Turkish Program Rules (translated by a subagent, verified by tests + manual read) | done |
| E2E V3.3 journey (port 8716) + existing journeys updated | done |
| Visual QA 1440×900 / 1728×1117 (`artifacts/v33/`) | done |
| Canonical migration rehearsal (byte copy) | done |
| Blocking review | done: no blocking issues; 2 minor edge cases fixed (History paging state on filter switch; Apply now also checks the exact shown macros) |

## Tests

- Backend: `test_v33.py`, `test_macro_targets_migration.py`, macro-target storage/API/controller
  tests; full suite, ruff, format, strict mypy.
- Web: Change panel, discard (light / strong), macro target form, starting rule, per-day
  targets, weekly-review proposal, day timeline (grouping, order, filters, paging), exercise
  history "in place of", Turkish rules fidelity (hash, headings, numbers per section, JSON
  shapes, exercise names).
- E2E: complete suite incl. `v33-daily-use`.

## Canonical rehearsal (2026-09-24)

Byte copy of `data/fitness_lab.db` (sha256 0ce9f5d6…, identical): 0007 applied through the real
runner; pre-migration snapshot quick_check/integrity_check ok and equal to the pre-state; every
table except the rebuilt `controller_event` (0 rows before and after) unchanged;
foreign_key_check empty; quick_check ok; integrity_check ok. The API read every existing
workout, History and Nutrition on the migrated copy. The canonical file was not written (hash
unchanged). It migrates on the next `./scripts/start.sh` (automatic `pre-0007` snapshot).

## Unresolved / notes

- The source's weeks 1–2 rule still applies to a manual target change once a target exists
  (an exception must be chosen) — unchanged V3 behaviour.
- A V3.2 server was running on 127.0.0.1:8000 against the canonical DB during the work; it must
  be restarted to serve V3.3.
