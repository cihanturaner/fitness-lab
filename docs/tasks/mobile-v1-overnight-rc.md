# Mobile V1 — overnight release candidate (task ledger)

Started 2026-09-24 from `claude/wizardly-planck-46kmvf` @ `a67f060` (M2.5), on branch
`claude/sweet-mendel-xic1f2` (fast-forwarded to `a67f060`). Frozen reference tags:
`mobile-m2-frozen` (= `c3c4c16`), `web-v3.3.1-frozen`. Never merge `main`, never tag.
Native iPhone: **NOT YET VERIFIED** for anything in this file unless stated.

## Milestone queue

| # | Milestone | Status | Commit |
| --- | --- | --- | --- |
| M0 | Finalize M2.5 visual calibration (anatomy redraw, compact Home hero) | done | see log |
| M3 | Real workout logger (lb → reps → RIR) | done | see log |
| M4 | Nutrition + bodyweight + Quick Add | done | see log |
| M5 | History (day-first) + Settings | done | see log |
| M6 | Local SQLite persistence (expo-sqlite), Clock | done | see log |
| M6b | Versioned export (read-only tool) / mobile import | done | see log |
| VP | Integrated visual consistency pass | done | see log |
| RC | Blocking review + final gates | done | `3763b5c` |

Order note: persistence (M6) is built as the repository boundary *during* M3 so the logger
is real from the start; the M6 commit adds migrations tests, cold-restart and the Clock.

## Locked requirements (distilled from the frozen web/backend; evidence gathered by councils)

### Training (backend `storage/entry.py`, `domain/placement.py`, migration 0008)
- Workout statuses: `draft` | `complete`. Opening a planned workout returns the existing
  draft for that origin or creates one empty draft with an immutable origin (planned
  workout); never creates sets. `performed_on` = the day it was opened.
- Complete: blocked with no sets (C1) or a set without reps (C2); missing load/RIR are
  advisories only. Sets renumbered densely on complete. Shortened = non-warm-up recorded
  (incl. extra work) < non-warm-up planned of the origin; the app asks
  "X actual working sets recorded / Y planned. Complete anyway?" and afterwards says
  "Saved as a shortened session: X of Y planned working sets recorded." Never shown as Done.
- Reopen: complete → draft; nothing else changes. A complete workout cannot be edited
  without reopening (every set/substitution write requires a draft).
- Discard: drafts only; deletes the workout with its sets, origin, substitutions,
  placements; the plan is untouched. (Desktop takes a file snapshot first when sets exist;
  mobile: confirmation naming the exercises; see decisions.)
- Sets: `load_g` (int ≥ 0, entered as lb ≤ 2 decimals, g = round-half-up(lb × 453.59237)),
  `reps` (int ≥ 0, required), `rir` (int, optional), `set_type` stored `working`, no
  user-facing set type, `entered_at`/`updated_at`. Add/edit/delete draft-only; delete
  renumbers. Web limits: load ≤ 9999.99 lb, reps 0–9999.
- Slot identity: every set logged in a planned slot records that slot
  (`performed_set_slot`); `slot = null` = extra work. Legacy rows without a placement fall
  to the first slot (by position) performed as their exercise. Never group by exercise id.
- Change (substitution): per workout + slot, draft-only; approved substitutes parsed from
  the slot's notes (`Approved substitutes:` line, split `", "`, `" if "` → condition), the
  planned exercise itself dropped; a typed exercise (collapse whitespace; all-lowercase →
  title case after space - / (; ≤ 80 chars). "Back to <planned>" deletes the row. Sets
  already in the slot as the old exercise become extra work. Only this workout changes.
- Previous performance: most recent *complete* workout containing that exact exercise, all
  its sets of that exercise in order ("Last: none yet" when none).
- Progress: planned = non-warm-up planned sets of the origin; actual = non-warm-up sets.

### Nutrition / bodyweight (backend `domain/nutrition.py`, `domain/bodyweight.py`)
- Nutrition day: one per date, protein/carbs/fat integer grams 0–1500, each nullable, at
  least one present. Calories derived P×4 + C×4 + F×9; missing macro ⇒ day incomplete.
  Future dates refused.
- Macro target: append-only, effective-dated (latest `effective_on` ≤ date; ties by
  latest set time); whole grams 0–1500, derived kcal 1–10000. No target until the lifter
  records one. First-target form pre-fills P 145 / F 60, carbs blank (source has no carbs
  default). "From today; earlier days keep the targets they had."
- Weeks 1–2 exception prompt when changing an *established* target (one in force before
  today) during the early phase: options "GI intolerance", "obvious logging error",
  "illness", "clearly falling trend", "implementation mistake"; note
  `Weeks 1–2 exception: <item>`.
- Bodyweight: one per date, 20–300 kg, ≤ 2 decimals, stored integer grams. 7-day average
  = mean of entries in the 7 days ending on the date, shown with n/7. Change of the average
  only when both 7-day windows have ≥ 4 weigh-ins.
- Nutrition controller: decision support only; omitted from mobile V1 (never writes on its
  own; omission breaks no invariant). Early phase for the exception prompt computed from
  the block: block started and fewer than 3 full block weeks finished.

### History / Settings
- History: day timeline newest first; a day appears with a *completed* workout, a
  weigh-in or a nutrition log. Workout: name, "Shortened" when short, "N of M working
  sets", per slot `"{lb} lb × {reps} @ RIR {rir|—}"`; changed slot "Performed: X" /
  "Planned: Y". Bodyweight kg; nutrition kcal · P · C · F (partial) vs target that day.
- Settings: block start (Week 1 = Mon–Sun week containing it; days before are pre-block;
  "Recorded workouts keep their dates; only their week numbers follow the new start."),
  macro target, program + rules in Turkish (source `web/src/features/settings/program-notes.tr.md`),
  data export/import.

### Export schema facts (backend migrations 0001–0008)
- `workout(id, performed_on, performed_time_local, status, notes, entered_at_utc,
  updated_at_utc)`; `workout_plan_origin(workout_id, planned_workout_id)`;
  `planned_workout(workout_key, name, program_version_id)`;
  `planned_exercise_slot(slot_key, position, exercise_id, notes)`;
  `performed_set(id, workout_id, exercise_id, set_order, set_type, load_g, reps, rir, notes,
  entered_at_utc, updated_at_utc)` (no performed_at column);
  `performed_set_slot(set_id, slot_id NULL = extra)`;
  `workout_slot_substitution(workout_id, slot_id, exercise_id)`; `exercise(id, name, …)`;
  `bodyweight_entry(measured_on, bodyweight_g)`; `nutrition_day(logged_on, protein_g,
  carbs_g, fat_g)`; `macro_target(id, effective_on, protein_g, carbs_g, fat_g, notes,
  set_at_utc)`; `training_block(program_version_id, start_on)`; `schema_migrations` head 8.
- Read-only open: `file:…?mode=ro&immutable=1` only when no non-empty `-wal`; otherwise
  copy db+wal+shm to a scratch dir and read the copy. `PRAGMA query_only=1`.
  Never import `fitness_lab` (its paths migrate).

## Decisions

- D2 Bodyweight change of the 7-day average needs ≥ 4 weigh-ins in each window (desktop
  `MIN_COMPARABLE`); the M1 test that compared sparse windows was updated to the desktop rule
  (frozen desktop outranks the accepted mobile fixture).
- D3 Logger keys a session by (date, workout key): opening the scheduled workout of a day
  returns that day's draft (else its latest completed workout) or creates one empty draft on
  Start. Today and past in-block days can be started; future days show the plan only.
- D4 Discarding a draft that holds sets keeps a JSON copy in `discarded_workout` (the desktop
  snapshots the file instead); nothing is lost silently.
- D5 In-app confirmation dialogs (not `Alert`) so they behave identically on iOS and the web
  preview and are testable.
- D6 Web preview uses expo-sqlite's web build (wasm; `metro.config.js`), so browser QA runs
  the real SQL path. Tests use sql.js (dev dependency only) behind the same `Db` interface.
- D7 Nutrition controller (weekly review, recommendations) is not in mobile V1: it is decision
  support only and never writes by itself. The early-weeks exception prompt is kept, with the
  controller's own phase rule (block started, fewer than 3 full block weeks finished).
- D8 Quick Add is a form sheet sized to content (plain View). Keyboard behaviour inside the
  iOS sheet is a physical-iPhone check.
- D9 Import onto a device with data never merges: it is refused unless the lifter chooses
  "Replace all data", which keeps the replaced data as a V1 export in `replaced_data` first.
- D10 Import accepts the desktop program when its program.json sha matches the bundle
  (`exact`) or, failing that, when every referenced slot has the same key, position and planned
  exercise (`compatible`, recorded in import_log); anything else is refused.
- D1 Muscle focus: the program package states none. Only the existing accepted mobile
  focus (Upper B: back, chest, shoulders, triceps, biceps — M1 fixture) is used; other
  workouts draw a neutral figure. Needs an authoritative source from the user to extend.

## Commits (branch `claude/sweet-mendel-xic1f2`, from `a67f060`)

| Commit | What |
| --- | --- |
| `69fcc1f` | M0 — anatomy redraw, compact Home hero |
| `45dd73e` | M3 — workout logger + SQLite persistence core (schema v1, repositories, store, Clock) |
| `9cfb19d` | M4 — Nutrition, Bodyweight, Quick Add, honest Progress cards |
| `797bbb1` | M5 — day-first History, Settings (block, target, Turkish program, about) |
| `503f422` | M6 — persistence journeys (J1 phases, J2, J7 cold restart), schema + fixture guards |
| `2f26577` | M6b — read-only desktop exporter, V1 format, mobile import/export |
| `225e09d` | Visual consistency pass |
| `8d93a93` | Jest per-test budget 20 s (cold-cache first test) |
| `553a4ec` | Day rollover while the app stays open |
| `9c41a64` | Ledger: commit list |
| `3763b5c` | RC blocker B1: queue every write, double-tap guards (+ review nits) |

## DONE criteria

The mission's 30-point RC definition; status in "RC checklist" below.

## Checks completed

- M0 (2026-09-24): anatomy redrawn — full muscle coverage (neck, traps, deltoids, pecs,
  serratus, obliques, 4-row rectus, biceps, forearms, quad heads + adductors + patella,
  tibialis, calves; back: traps, rotator cuff, lats, erectors, obliques, triceps, glute
  medius/maximus, hamstring heads, gastrocnemius heads, soleus), each plate radially shaded
  (lit upper-left), trained plates in the emerald ramp. Home hero compacted: figure
  ≤ 236 pt (was ≤ 290), progress on one line (sets · bar · %), 50 pt CTA, tighter header /
  strip. Progress heading moved from y≈730 to y≈630 (430×932, web, no inset); CTA still on
  the 375×667 first screen. typecheck, lint (0 warnings), jest 98/98.

## Blockers

- RC review blocker B1 (fixed): overlapping writes could join another write's open
  transaction (shared depth counter) and be rolled back with it; plain writes did not queue;
  double taps could save a set twice. Fix: every repository write goes through the
  transaction queue, no joining; in-flight guards on set entry and on hero buttons
  (Start / Finish). Regression test fails on the old code, passes on the fix.
- Reviewer's temporary probe `mobile/src/__race_tmp.test.ts` was swept into `553a4ec` by
  `git add -A` while it existed for about a second; removed in the fix commit (no history
  rewrite).

## RC checklist (final, at `3763b5c`)

Clean clone of the branch: `npm ci` ok · typecheck ok · lint 0 warnings · jest 20 suites /
282 tests (cold transform cache) · `npx expo export --platform ios` ok (Hermes 3.2 MB; no
sql.js or fixtures inside) · exporter unittest 8/8 (Python 3.11 and 3.13) · all 121+ files
under mobile/src and tools tracked (root `data/` rule handled by `mobile/.gitignore`
`!/src/data/`) · `git diff mobile-m2-frozen..HEAD -- web backend` empty · blocking review:
1 blocker found and fixed, 0 open.

Journeys: J1 (fresh / pre-block / rest / post-block) RTL · J2 RTL + browser · J3 RTL (Training
→ logger for today/past, plan for future) · J4 RTL + browser · J5 RTL + browser · J6 RTL +
browser · J7 RTL (reopen from file bytes) + browser reload · J8 RTL + browser (file chooser).

## Physical iPhone verification needed (not verified here)

1. Install a development build (`npx expo run:ios` or EAS development profile — the app now
   uses expo-sqlite, expo-file-system, expo-document-picker, expo-sharing).
2. Safe areas: Dynamic Island / home indicator around every tab and the floating bar.
3. Logger keyboard: number / decimal pads, the "Next · Log set" bar above the keyboard,
   scrolling the open row above the keyboard, one-hand reach of the ✓ button.
4. Quick Add form sheet: sizes to content; the kg / macro fields stay above the keyboard.
5. SF Symbols for every icon (incl. new: ellipsis, trash, arrow.left.arrow.right,
   square.and.arrow.up/down, scope, list.bullet.rectangle).
6. Anatomy SVG (radial gradients, mirrored halves) and the calorie half-ring on iOS.
7. Dynamic Type at larger sizes; VoiceOver order on Home, logger rows, Nutrition, History.
8. Cold restart on device keeps data; app open across midnight rolls to the new day.
9. Export → share sheet → Files; import that file back into a fresh install.
10. Real import: stop the desktop app, run
    `python3 tools/export/fitness_lab_export.py --db data/fitness_lab.db --out ~/Desktop/fitness-lab-export-v1.json`,
    AirDrop/Files it to the iPhone, Settings › Your data › Import a file; check History.
11. Performance feel while logging; haptics (none are implemented yet).
12. Final design approval against the reference screenshots.
