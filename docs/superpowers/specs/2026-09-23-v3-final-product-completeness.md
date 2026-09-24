# V3 — Final product completeness

Date: 2026-09-23. Base: `main` at `9897516` (V2.1 visual contract accepted and unchanged).
Scope: close the gaps between the committed locked artifacts
(`programs/advanced-natural-12w/artifact/locked_workout_program.json`,
`programs/advanced-natural-12w-nutrition/artifact/locked_nutrition_tracker.json`) and the
product, and remove every misleading state. No redesign, no workout-backend replacement, no
e1RM / PR engine, no performed-set → planned-set provenance.

## 1. Five-council summary

| Council | Verdict | Decisive findings |
| --- | --- | --- |
| 1 Workout source fidelity | FIX REQUIRED (no Critical) | All 29 rows / 81 sets / order / reps / per-set RIR / failure / rest / angle / marker / substitutes preserved exactly (row-by-row script). Weeks 1–11 identical by source (`weeks_1_to_11.same_base_program`), week 12 normal (`week_12_P2.taper: false`) — repeating four templates is faithful. Program-level rules (progression, P7′, calibration, deload P1, week-12 benchmark, warm-up, plateau) reachable only from a collapsed raw block in History › Sessions. `category`, `tracking_schema`, `derived_calculations`, `ui_status_labels`, goals are dropped without declaration. History Δ is RIR-blind and mixes sessions. |
| 2 Training workflow / history | FIX REQUIRED | 2/23 sets shows "✓ Done · 23 sets". Days before a mid-week block start count as block days; after week 12 the plan is still offered. A reopened old workout's draft takes over every later week. No week navigation. History "vs previous" compares Upper B against Upper A. History week numbers come from the active block, not the workout's own. |
| 3 Nutrition / bodyweight | FIX REQUIRED (Critical) | Logging half faithful; controller half absent: no 14-day regression trend, no timing (weeks 1–2 / end of week 3 / ~14 days / wait after adjustment), no UNDER_GAIN / IN_RANGE / OVER_GAIN, no diagnostic gate, no decision records, starting rule (recent stable intake + 150) missing, target history not rendered, 7-day mean-vs-mean % shown from single weigh-ins, hero is a single weigh-in though `display_metric` is `7_day_average`. |
| 4 Data / settings / safety | FIX REQUIRED | Block start is CLI-only. No user-triggered backup. Target history invisible. Canonical DB healthy (integrity ok, migrations 0001–0004, one active version, block start 2026-10-01) but holds test data (§5). |
| 5 Product / UX | FIX REQUIRED | Partial "Done", no week navigation, pre-block tiles offered as block work, Nutrition "vs target" re-scores past days with today's target, units missing outside the History table header, sparkline claims a span it does not show. |

Conflicts resolved: council 5 advised no completion confirm and CLI-only block start; the V3
brief requires both in-app, so the brief wins. Council 3's I3 (7-day average as the hero)
overrides V2.1 §6 "Latest (hero)" because the source locks `display_metric: 7_day_average`.

## 2. Consolidated gap matrix

P0 = correctness / misleading / blocks daily use · P1 = original-plan capability missing ·
P2 = useful polish. Status: **Fix** = implemented in V3; **Doc** = documented as intentionally
non-executable (§4); **Defer** = not implemented.

| # | Gap | Source / user need | Current state | Sev | Fix | Test |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Partial session shown as full | "What did I do?" must be true | 2/23 working sets → "✓ Done · 23 sets" on Home, "Done today", Sessions "Complete 2" | P0 | Derived work-set totals (planned non-warm-up sets of the immutable origin vs recorded non-warm-up sets, totals only) on week, entry, sessions, recent. Completing below plan asks "N actual working sets recorded / M planned. Complete anyway?". Complete-short renders "Done · 2 of 23 working sets" / "Complete · shortened", never the planned count alone | domain `work_set_totals`; API week/entry/sessions/recent; Vitest confirm accept/decline/none-when-full; E2E |
| G2 | Days before a mid-week start counted as block | Week 1 = Mon–Sun week containing start (locked); start day is when the block begins | Mon 28 / Tue 29 Sep = "Week 1", Start offered | P0 | `block_phase(start, weeks, day)` → `pre_block` (day < start) / `block` / `post_block` (week > duration); per-day phase in `/api/week`; pre/post tiles recede with a quiet "Log anyway"; Today band skips them | domain phase tests (pre, first day, week 12 last day, post); API; Vitest Home |
| G3 | After week 12 the plan is still offered as block work | `block_weeks: 12` | "Block finished" header, tiles still "Start" | P0 | Same as G2 (`post_block`) | as G2 |
| G4 | Out-of-week draft hijacks later weeks | Draft semantics: one draft, resumes where it was dated | Reopened week-1 workout shows as week-2 "Draft" | P0 | Tile status uses a draft only when it is dated in that week; other open drafts listed separately (`open_drafts`) and shown in the Today band as "Unfinished · Upper A, Thu 1 Oct"; Start on such a tile says "Resume Thu 1 Oct draft" | API reopen scenario; domain; Vitest |
| G5 | No week navigation | "What did I use each week?" | Home only ever shows today's week | P0 | `#/week/YYYY-MM-DD` route, ‹ › and "This week"; non-current weeks read-only (Done → View, draft in that week → Resume, otherwise "Not logged" / "Planned"); Today band only on current week | Vitest nav; E2E |
| G6 | Block start CLI-only | Routine setting | `set-block-start` only | P0 | `PUT /api/program/block-start` (active version, real date, returns week-1 range); Settings screen with confirm and non-Monday note | API round-trip / invalid / no program; Vitest; E2E |
| G7 | History Δ compares different sessions | Week-to-week per exercise | Upper B exposure Δ vs Upper A | P0 | Δ vs previous exposure of the same session (same planned workout name; unplanned vs unplanned); "Since first session" measured from the first in-block exposure and labelled "Since week 1" when a block exists | Vitest interleaved A/B |
| G8 | History week numbers from active block | Stable history | Renumbers on new activation | P1 | Exposure week and phase from the block of the workout's own origin version; unplanned uses the active block | API two-version test |
| G9 | History not scannable set-by-set | WEEK · DATE · SESSION · SETS (kg / reps / RIR) | Chips of `80×8@2` in one cell | P1 | Working sets aligned in columns S1…Sn, each `80 kg × 8 · RIR 2`; warm-ups collapsed to a count; week label `Pre` / `1…12` / `Post`; shortened sessions marked `2/23` | Vitest |
| G10 | Units missing | Explicit units | Top set, Home recent, chart axis, ledgers | P1 | `kg`, `reps`, `RIR`, `kcal`, `g` in headers and stats | Vitest text |
| G11 | No nutrition controller | `controller_rules`, `controller_timing`, `measurement_protocol.trend_method` | Absent | P1 (Critical per council 3) | Pure `domain/nutrition_controller.py` (§3), migration 0005 `controller_event` + `diagnostic_gate_event` (append-only), `GET /api/nutrition/review`, `POST …/decision`, `POST …/gate`, Weekly review panel on Nutrition, one line on Home | ~40 domain cases incl. every `app_logic_examples` case; storage triggers; API 409 on stale/not-due |
| G12 | Diagnostic gate absent | `diagnostic_gate` | Absent | P1 | Two consecutive applied +150 under-gain corrections still under → `DIAGNOSTIC_GATE`, no third increase; 9-check audit recorded; underfeeding confirmed → +150 allowed; inputs unreliable → fix inputs first | domain + API |
| G13 | Starting rule absent | `recent_stable_intake_plus_150` | Free kcal form | P1 | "Calibrate" helper when no target exists: lifter types recent stable intake → shows +150 and carbs → records only on confirm | domain 2500 → 2650 / 383; Vitest |
| G14 | Weeks 1–2 rule absent | `controller_timing.weeks_1_2` | Form open with no guidance | P1 | Review says "no routine bodyweight-driven changes" in weeks 1–2 and lists the five exceptions; the manual target form asks for a reason in weeks 1–2 (listed exceptions or free text) | Vitest |
| G15 | Rate uses wrong estimator; single-day comparisons | `14_day_linear_regression`, `single_day_change_actionable: false` | 7-day mean vs mean %, even at 1/7 vs 1/7 | P1 | Qualified 14-day trend (% BW/week, n/14, window) replaces the % change everywhere; the kg mean-vs-mean change shows only when both sides have ≥ 4 weigh-ins | domain; Vitest |
| G16 | Display metric inverted | `display_metric: 7_day_average` | Latest weigh-in is the hero | P1 | 7-day average (n/7) is the hero on Bodyweight and Home; latest weigh-in secondary | Vitest |
| G17 | Target history invisible | append-only `calorie_target` | Fetched, never rendered | P1 | Target history table (from, kcal, Δ, carbs, reason, recorded) | Vitest |
| G18 | "vs target" re-scores the past | append-only targets | Past days compared with today's target | P0 | Per-row target from history (latest `effective_on ≤ day`) | Vitest |
| G19 | Over-target calories get a green check | Source defines no daily compliance | "✓ 450 kcal over" | P2 (misleading) | Neutral "N over" for calories / carbs / fat; check only for protein met | Vitest |
| G20 | Program rules buried | `progression`, `execution_rules`, `deload_P1`, `week_12_P2`, `calibration`, `warmup`, `plateau_logic` | Collapsed raw block in History › Sessions | P1 | Readable "Program rules" section in Settings (sections, JSON rendered as labelled lists), linked from the Week header and workout Details | Vitest |
| G21 | Undeclared dropped source keys | "No silent loss" | `category`, `tracking_schema`, etc. vanish | P1 | Declared in §4 as intentionally non-executable (the adapter is not changed: a new package hash would create a new program version on the canonical DB) | doc |
| G22 | No user backup | Operational safety | Snapshots only before migrations / deletes | P1 | `POST /api/backup` (verified `VACUUM INTO` → `data/snapshots/<ts>-manual-backup.db`), `GET /api/backups` (names + times); Settings "Back up now" | API; Vitest |
| G23 | Sessions list silently capped at 30, no week | Scan a 48-session block | `limit=30`, no week column | P2 | Sessions request 200, show Wk and "2 / 23" working sets | Vitest |
| G24 | Protocol copy incomplete | 5 conditions | 4 of 5 | P2 | Add "similar clothing" | Vitest text |
| G25 | Home sparkline span claim | Truthful captions | "Last 4 weeks" over one weigh-in | P2 | Caption says the actual span | — |
| G26 | Test data in canonical DB | Real logging 1 Oct | Present (§5) | — | Report only; deletion needs explicit approval and a verified backup | — |

Deferred on purpose (P2, not in the original contract's executable core): structured marker
flag and calibration flag on sets (need a package change → new version), waist / photo logging,
week-12 corridor outcome evaluation, exercise retirement from the UI, bodyweight/nutrition
pre-delete snapshots.

## 3. Nutrition controller (decision support only)

`backend/src/fitness_lab/domain/nutrition_controller.py` — pure. Nothing in it or behind it
writes a calorie target; only `POST /api/nutrition/review/decision` with `choice = APPLIED`
(one explicit click) appends one `calorie_target` row, in the same transaction as the
decision record.

Constants quoted from the source: band 0.10–0.25 % BW/week (`controller_rules`); very rapid
0.30; deltas +150 / −100 (`delta_kcal_per_day`); starting delta +150; trend window 14 days
(`trend_method.default`, `decision_horizon_days.min`); first decision end of week 3; interval
~14 days (every second block week); 12 block weeks; gate after 2 failed +150 corrections.

1. **Review week.** N = latest block week whose Sunday S ≤ today. N < 1 → no review
   (pre-block). N > 12 → post-block, no routine decision.
2. **Target in force** on S (latest `effective_on ≤ S`, ties by `set_at_utc`). None →
   status `UNKNOWN`, "Starting calories not calibrated yet." and the calibration helper.
3. **Adjustments** = the dates D where the target value in force changes.
4. **Trend** over [S−13, S]: not qualified when an adjustment falls strictly inside the window
   (S−13 < D < S: weigh-ins are morning, before food, so a change on D moves only later
   weights — `after_any_adjustment`) or when either 7-day half has fewer than 6 weigh-ins. A
   target changed on or after S (and not by this week's decision) blocks the week's routine
   decision; the reading itself is never rewritten by applying it. Otherwise exact least-squares slope of grams
   on day index; `pct = slope·7 / mean(grams) · 100`, rounded half-up to 0.01; classification
   uses the rounded value. The estimator is fixed for the whole block.
5. Not qualified → `INSUFFICIENT_DATA`.
6. Classify t: `< 0.10` under; `0.10 ≤ t ≤ 0.25` `IN_RANGE` / NO_CHANGE; `> 0.30` with a
   lifter-reported composition concern → `COMPOSITION_REASSESSMENT` / STRONGER_REASSESSMENT
   (no delta); `> 0.25` → `OVER_GAIN`, −100 only if **sustained**, otherwise NO_CHANGE with
   "above band once; a reduction needs a sustained trend".
7. Under-gain: count failed corrections over recorded decisions (an APPLIED +150 under-gain
   decision followed by another under-gain adds one; in-range / over-gain resets; KEPT is not
   a correction). < 2 → `UNDER_GAIN` +150. ≥ 2 → `DIAGNOSTIC_GATE` until an audit is recorded
   for week N: unreliable inputs → "fix the input problem first"; underfeeding confirmed →
   `UNDER_GAIN` +150. The count is not reset by a gate, so each further failure audits again.
8. Timing: decision due when 3 ≤ N ≤ 12, no decision recorded for N, N ≥ last decided
   week + 2, and the status is decidable (never on insufficient data or without a target).
   The week-12 review stays open until week 13 has finished. Apply re-checks status, delta
   and the exact target shown. Weeks 1–2: "no routine bodyweight-driven changes" + the five exceptions. Not due
   → status shown, no buttons, "Next routine decision: end of week K (date)".
9. Recommendation = current + delta; carbs = (kcal − 1120) / 4; protein 145 / fat 60 unchanged.

**App choices (the source leaves these undefined; fixed here, labelled in code):**
(a) a qualified trend needs ≥ 6 weigh-ins in each 7-day half of the 14-day window;
(b) "sustained" over-gain = this review week's and the previous week's qualified trends both
round above 0.25, the previous week being ≥ 3 and after the latest adjustment;
(c) underfeeding may be confirmed at the gate only when tracking method, food logging,
restaurant/unlogged intake review, weighing protocol and adherence are all confirmed
consistent and illness/travel did not disrupt data; the three "materially changed" checks are
recorded as context.

Storage (`0005_nutrition_controller.sql`, additive, append-only by trigger):
`controller_event` (one per program version and block week: window, weigh-ins, trend, status,
recommended action and delta, previous target, user choice APPLIED / KEPT, new target id,
notes) and `diagnostic_gate_event` (nine checks, result, notes). "PENDING" is the computed
state before a row exists.

## 4. Workout-source fidelity: represented, contextual, or declared non-executable

| Source | Disposition |
| --- | --- |
| `weekly_schedule`, `sessions.*` (order, sets, `rep_range`, `rir_by_set`, rest, failure, angle, marker, substitutes) | Structured (`planned_*`) or verbatim slot notes; unchanged |
| `athlete_context.block_duration_weeks`, `tracking_schema.block_start_date` / `current_week` | Structured (`duration_weeks`, `training_block`, `block_week`, now with phases) |
| `weeks_1_to_11`, `week_12_P2` normal week | Represented by repeating the same four sessions every week |
| `execution_rules`, `progression`, `plateau_logic`, `calibration`, `deload_P1`, `week_12_P2` benchmark, `warmup`, `weekly_volume`, `substitution_matrix` | Contextual: program notes rendered in Settings › Program rules. Non-executable by design: no progression / plateau / deload engine, no automatic volume change, benchmark compared manually in History (first working set of the marker, week 1 vs week 12) |
| `sessions.*.exercises[].category` | Not stored. Its only executable consequence (failure policy per row) is stored verbatim in slot notes; warm-up tiers are order-based and in program notes |
| `tracking_schema.*_log_template` (session RPE, readiness, sleep, pain, calibration exposure, progression_qualified, marker baseline, plateau / deload events) | Non-executable: free-text session and set notes carry them |
| `derived_calculations.optional_e1RM` | Non-goal (no e1RM) |
| `athlete_context.status`, `primary_goal`, `secondary_goal`, `training_days_per_week` | Descriptive, not stored (training days per week is implied by the four scheduled sessions) |
| `meta.language`, `purpose`, `ui_status_labels`, `integrity_checks` | Language/labels not adopted (the app is English); integrity checks enforced at adapt time |

Nutrition: every `controller_rules` / `controller_timing` / `diagnostic_gate` / templates rule is
implemented per §3. Waist, photos, `partitioning_override`, body fat and the week-12 corridor
stay descriptive (body fat never triggers anything; nothing in the app reads it).

Block start and decisions: review decisions are keyed by block week, so once any is
recorded the block start can no longer be moved (409 with the reason, in app and API).

## 5. Canonical data (report only)

Read-only audit of a copy: integrity ok, migrations 0001–0004, one active version
`664db312…` (12-Week Advanced Natural…, 1.0.0), block start 2026-10-01. Suspected test
records, all entered 2026-09-23:

- `workout e24438806f304697a50ed706696d60c9` — Upper A, complete, performed 2026-09-23, two
  working sets 7 kg × 8 (Cable Lateral Raise `69591387…`, Reverse Pec Deck `7221469c…`).
- `bodyweight_entry 2026-09-23` — 77000 g (77 kg).
- `nutrition_day 2026-09-23` — 888 kcal, protein 76, carbs 76, fat 76.
- `exercise 0f97f10d85684a7c944c00f382e98946` — name `x`, unused.

Nothing is deleted in V3. Removal requires explicit approval and a verified backup first.
Migration 0005 is applied by the next normal start (pre-migration snapshot is automatic).

## 6. Verification

Backend pytest / ruff / format / mypy strict; frontend typecheck / oxlint / Vitest / build;
Playwright: existing suites plus `v3-completeness.spec.ts` on its own scratch server (port
8713); visual QA screenshots on scratch data; canonical smoke read-only on a copy.

## 7. Final five-lens gate (after implementation)

One independent review of the full diff. Lens 1 PASS. Findings fixed: I1 applying a review
rewrote that week's reading (adjustment rule refined, §3.4); I2 a later view of a mid-week
week 1 read "Before the block" (week phase = today's phase for the current week, else
"block" when any day is); I3 moving the block start would misplace recorded decisions
(refused, §3); M1 "review due" on undecidable data; M2 Apply re-checks the shown target;
M3 backup requires the app's JSON request; M4 week-12 review window; M5 audit can be redone;
M6 §4 declaration. Known and out of scope: other body-less POST routes (complete, reopen)
share M3's cross-site exposure, as they did before V3.
