# V3.1 — Macro-derived calories, pound loads, premium visual language

Date: 2026-09-24. Builds on V3 (`2026-09-23-v3-final-product-completeness.md`). No V3 semantics
change: planned ≠ performed, shortened sessions, block phases, the nutrition controller and the
append-only calorie target are untouched.

## 1. Nutrition: macros are the source of truth

A day's log is its macros (integer grams, each nullable; at least one recorded). Calories are
**derived, never entered or stored**, with the Atwater general factors:

    calories = protein_g × 4 + carbs_g × 4 + fat_g × 9

- `domain/nutrition.day_calories()` is the one implementation; the web mirrors it in
  `web/src/lib/macros.ts` only for the live total while typing (the server's value is what
  is shown once saved).
- An unrecorded macro contributes 0, and the day reports `calories_complete: false`, shown
  as "partial" in lists and explained on the day. A recorded 0 is a value.
- `PUT /api/nutrition/{day}` accepts `protein_g`, `carbs_g`, `fat_g`, `notes` only; a body
  carrying `calories_kcal` is refused (422), so no client can reintroduce a typed total.
- `GET /api/nutrition` returns each day with `calories_kcal` (derived) and `calories_complete`.
- The calorie **target** (append-only `calorie_target`), the carbohydrate target
  (calories − 1120) / 4 and the controller are unchanged. The controller never read logged
  calories (it uses the bodyweight trend), so its decisions cannot shift.

### Migration 0006 (`0006_macro_derived_calories.sql`)

Real data existed: the canonical 2026-09-24 row held a typed 1222 kcal against macros
22 P / 21 C / 33 F (469 kcal derived). Nothing typed is destroyed:

1. Every row with a typed `calories_kcal` is copied into `nutrition_entered_calories`
   (typed value, macros beside it, derived kcal, original timestamps, archive time). That
   table is closed and append-only by trigger (no insert, update or delete after 0006).
2. `nutrition_day` is rebuilt without `calories_kcal`; every macro, note and timestamp is
   kept. A day with calories but no macro cannot be derived: it leaves `nutrition_day` and
   survives only in the archive (`derived_kcal` NULL). The canonical database had none.
3. The runner's pre-migration snapshot (`…-pre-0006.db`) is taken first, as for every
   migration.

## 2. Workout loads are pounds

Storage was already a physical unit — integer **grams** (`performed_set.load_g`,
`planned_set.target_load_g`) — with an exact kg↔g layer. So no data is converted: the unit
layer gains exact lb↔g, and the API speaks pounds.

- `domain/units.lb_to_g` / `g_to_lb` / `format_lb`: Decimal arithmetic with the exact
  0.45359237 kg pound; input at most 0.01 lb, rounded once, half-up, to the whole gram.
  Rounding moves a value by ≤ 0.5 g (0.0011 lb), under half of 0.01 lb, so **every entered
  pound value reads back exactly** (tested for all 0.00–1000.00 lb).
- API: `load_kg` → `load_lb` in set requests/responses, `target_load_kg` → `target_load_lb`.
  A request still sending `load_kg` is refused (422): a number can never be read in the
  wrong unit.
- A set recorded before V3.1 (kilograms, e.g. 33000 g) reads as its true weight in pounds
  (72.75 lb); reading never rewrites it. This is the "auditable conversion": the stored mass
  is unchanged and the rendering is deterministic.
- Unchanged and still kilograms: bodyweight everywhere; the program package format
  (`target_load_kg`, all null in the locked program) and the M1 emergency capture contract
  (`"units": "kg"`, validator only, no importer) — both are explicit file formats that
  name their unit.
- Every workout surface says lb: the set grid column, the "loads in lb" console badge,
  "Last (lb)", History ("185 lb × 6 @ RIR 2", "+5 lb", "Top load per session · lb"),
  Recent training ("lb × reps @ RIR"), validation copy ("load must be pounds").

## 3. Visual language (supersedes the V2.1 grey tokens)

Personality: premium consumer training product — calm mint atmosphere, one emerald family.

- **Tokens** (`web/src/index.css`): mint paper `#edf3ef` with a faint emerald radial wash,
  white cards `.surface` (22 px radius, layered green-tinted shadow, no grey outline), wells
  `.well` (14 px) inside cards, ink `#0f1f19`, emerald 50–900 scale, primary `#1b684f`.
  Macro colours: protein `#1d7a58`, carbs `#b0842c`, fat `#3e6e9b`. Planned stays a quiet
  steel-blue (`--plan`), so planned ≠ performed remains visible.
- **Type**: Geist; numbers heavier and tighter than words, tabular figures (hero 52–64 px).
- **One bold surface**: the Today hero (`.hero-surface`, emerald gradient) — everything else
  is white on mint.
- **Status on Week tiles**: today elevated with an emerald ring and glow; done = emerald pill
  and filled date; shortened = amber pill with a half-filled mark; draft = dashed emerald
  outline; rest/outside the block = translucent; future = plain white.
- **Workout**: a floating sticky console bar (ring of working sets, status pill, "loads in
  lb"); one card per exercise, glowing while it holds the cursor; saved set numbers settle
  into emerald dots; the active pending row is tinted.
- **Nutrition**: the calorie ring is split into macro-coloured segments; the log form is an
  equation — each macro × its factor, a composition bar, "Calories from macros" total.

## 4. Motion

CSS only (no motion library was present; none added). 120–320 ms ease-out
(`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`), nothing loops:

| Effect | Where |
| --- | --- |
| `.enter` staggered rise (320 ms, 45 ms apart) | each screen's sections |
| sliding emerald nav indicator (300 ms) | app bar |
| `.lift` hover/focus rise | Week summary cards, day tiles |
| `.press` scale 0.97 | buttons, pills |
| `.fill-in` bar growth, width glide | meters, session progress |
| ring sweep / segment sweep | Today ring, calorie rings, console ring |
| `useTweenedNumber` / `AnimatedNumber` (300 ms) | calories, macros, set counts |
| `.just-saved` wash + `.confirm` check | a set saved this visit |
| `.draw` line draw-in, `.fade-late` points | Trend chart, sparkline |
| `.accordion-body` grid-rows 0fr→1fr | Settings program rules |

`prefers-reduced-motion: reduce` zeroes every duration and delay (global rule), and
`useTweenedNumber` returns the exact value immediately. Verified in e2e
(`tests/v31-units-motion.spec.ts`) and unit tests (`src/lib/motion.test.ts`).
