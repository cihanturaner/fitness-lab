# V3.2 — Simplify the product

Date: 2026-09-24. Supersedes V3.1 only where stated here; the emerald / mint visual identity,
tokens and macro colours of V3.1 stay as they are.

This is a simplification pass. It adds no analytics, no PR engine, no nutrition logic and no
schema change.

## 1. Navigation

Six sections, in this order: **Home · Training · Bodyweight · Nutrition · History · Settings**.

| Route | Screen |
| --- | --- |
| `#/` | Home |
| `#/training`, `#/training/<date>` | Training (the week containing `<date>`) |
| `#/week/<date>` | pre-V3.2 link, still opens that week on Training |
| `#/workouts/<id>` | a workout; the nav marks **Training** |

A workout's Back link returns to the screen it was opened from (Home, Training, History or
All sessions; Home when opened directly). Discarding a draft returns there too.

## 2. Home answers three questions, nothing else

1. What do I do today? 2. What is my workout status? 3. What are my key current numbers?

- **Today hero** (the one emerald surface): a status badge (Today, In progress, Done today,
  Shortened, Unfinished draft, Before the block, Block complete), the session name, one meta
  line, and the one primary action — Start workout / Continue workout / Review session / Open
  draft. "Start unplanned session" stays as a quiet secondary. A shortened session is badged
  **Shortened** ("Completed with 9 of 23 working sets"), never "Done today".
- **Next** is small context at the hero's right (name, date, plan size) and links to Training.
  It is not shown when it would repeat today's answer.
- **Three compact cards**: Bodyweight (7-day average, sparkline, latest, 14-day trend),
  Nutrition today (macro-split kcal ring, three macro bars; only the notes that matter:
  nothing logged, target not calibrated, weekly review due), Recent training (the latest
  completed session, its working-set total or shortfall, its first three exercises).
- The header is the date and one line of context ("Block week 3 of 12"). No Monday–Sunday
  strip, no week navigation, no block rail, no sessions ring.

## 3. Training holds the week planner

Everything the V3 week screen had: block week title, ‹ previous / This week / next › week
navigation, the Monday–Sunday schedule with completed / shortened / draft / rest / future /
pre- and post-block states, Start / Resume / View / Log again / Log for <day> / Log anyway,
unscheduled sessions, and block progress (the 12-segment rail plus "N of M sessions done this
week"). A quiet "Start an unplanned session" link sits under the current week.

## 4. No set type in the lifter's workflow

- A set row is **Set · lb · Reps · RIR**. There is no type column, dropdown or prompt.
  Enter (or leaving the row) saves it; the cursor moves to the next row's load, which carries
  the previous load, selected. A full session is logged as lb → Tab → reps → Tab → RIR → Enter.
- Every set entered in the UI is stored as `working`. The API does the same for a
  `POST /api/workouts/{id}/sets` that omits `set_type`; an explicit type (or explicit `null`)
  is still honoured, so imports, captures and existing rows keep their meaning. The
  `set_type` column, completion rule C4 and warm-up exclusion from working-set totals are
  unchanged.
- Legacy evidence only: a stored warm-up keeps its muted set number ("(warm-up)" for screen
  readers) because it never counts toward the plan; History still counts warm-ups ("+1
  warm-up"). The back-off marker is gone from Last and History. A legacy set with no recorded
  type blocks completion (C4, "Set type not recorded"); the error offers one explicit action,
  "Record it as working set", instead of a type control.

## 5. Motion (clearly perceptible, never flashy)

| What | Motion |
| --- | --- |
| Screen / route change | the whole screen fades in and rises 6 px, 210 ms (no per-child stagger) |
| Loading placeholder | appears only after 120 ms, so a fast load never flashes |
| Nav indicator | slides between items, 200 ms |
| Card hover | 2 px lift onto the raised shadow, 140 ms |
| Button press | scale 0.96, 100 ms (`:active` and React Aria's `[data-pressed]`) |
| Set saved | a check pops over the set number, 220 ms, holds, fades at ~0.95 s; the row washes emerald |
| Bars / rings | fill in 300–320 ms; later changes glide 300 ms |
| Accordion | 220 ms |
| Day / selected states | colour and shadow transitions, 150–200 ms |

Nothing loops, nothing bounces beyond a single settle, and `prefers-reduced-motion` makes every
one of these instant (the global rule in `index.css`).

## 6. Desktop maturity

Large surfaces are less round: cards 14 px, the hero 18 px, day tiles and panels 12 px. Pills
remain only for status badges, the selected segment of compact controls and meaningful badges
("loads in lb", set counts). Links and actions that were pills are text links or 6–10 px
buttons. The set grid has a hairline header rule, right-aligned numeric columns with a small
gutter between wells, and a fixed four-column layout.

## Verification

- Backend: `test_a_set_entered_without_a_type_is_a_working_set`.
- Web unit: Home (hero states, three cards only, no planner), Training (all week states and
  navigation), App (six-item nav, old week links, Back target), Entry (no type control,
  keyboard-only multi-row entry, legacy untyped-set repair).
- E2E `v32-simplification` (port 8715, own scratch database): Home vs Training at 1440×900 and
  1728×1117, a full 18-set Lower A logged from the keyboard with every set stored `working`,
  and measured motion timings. Screenshots in `artifacts/v32/`.
