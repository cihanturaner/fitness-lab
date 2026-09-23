# V2.1 — Product polish: visual contract

Date: 2026-09-23. Scope: frontend presentation only. No API, schema, migration, or behaviour
change. Supersedes the visual parts of `2026-09-23-v2-product-ux-note.md`; its data rules and
keyboard contract stand unchanged.

## 1. Consolidated council findings

| Council | Decisive finding | Adopted as |
| --- | --- | --- |
| Product / IA | No "today" focus; block progress is weak; forms lead instead of answers | Today band (§4), 12-segment block rail, answer-first Bodyweight/Nutrition |
| Visual design | No shell, no type scale (11–13 px everywhere), a box around everything | One 1280 px shell, six-step type scale, cards only for units you act on |
| Training UX | Cards and bordered cells make the workout a form wall; order zig-zags | Borderless training sheet, two-column top-to-bottom flow, quiet saved rows |
| Data viz / empty | Empty = one grey sentence; daily dots louder than the trend | Designed empty states everywhere; trend line strong, daily points quiet |
| Polish / a11y | Weak focus, glyph icons, developer footer, CLI copy, raw selects | 2 px focus ring, Lucide icons, status popover, plain-language copy |

Rejected on purpose: a one-exercise-per-row workout (breaks the V2 contract that a whole
session fits a 1440×900 screen); replacing native date/select inputs with custom widgets
(keyboard and test contracts depend on them; they are restyled instead); a Motion dependency
(no new deps — CSS transitions only).

## 2. Design system

Personality: a quiet, precise training notebook. Neutral paper, graphite ink, a single
slate-blue that always means *planned*. Performed numbers are full ink and carry the weight.
Boldness is spent in one place: large tabular numerals.

### Colour tokens (`web/src/index.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#f4f4f1` | page paper |
| `--card` | `#ffffff` | interactive units (day, exercise sheet, entry form, chart panel) |
| `--sunken` | `#efefeb` | input wells, recessed rest days, skeletons |
| `--foreground` | `#16191c` | ink: titles, performed numbers |
| `--muted-foreground` | `#5c6268` | labels and metadata (5.6:1 on paper) |
| `--faint` | `#7d8389` | placeholders, units, non-essential marks (3.5:1) |
| `--border` / `--border-strong` | `#e2e2dd` / `#cfcfc9` | hairlines / card edges on hover |
| `--plan` | `#2f5d86` | prescription only: targets, plan hints, 7-day trend line, focus ring |
| `--ok` / `--ok-surface` | `#2b6a47` / `#ecf4ef` | done |
| `--warn` / `--warn-surface` | `#93600f` / `#fbf3e4` | draft, needs attention |
| `--destructive` | `#a5341f` | refused / delete |

Status is a 6–8 px dot or small Lucide icon plus a word, never a coloured fill of a card.

### Type scale (Geist Variable, tabular figures on every number)

| Role | Class | px / line | Weight |
| --- | --- | --- | --- |
| Page title | `t-title` | 28 / 32, −0.02em | 600 |
| Hero metric | `t-hero` | 44 / 48 | 500 |
| Primary metric | `t-metric` | 32 / 36 | 500 |
| Stat | `t-stat` | 20 / 24 | 500 |
| Section title | `t-section` | 15 / 20, sentence case | 600 |
| Body | `t-body` | 14 / 20 | 400 |
| Metadata | `t-meta` | 13 / 18, muted | 400 |
| Microcopy | `t-micro` | 12 / 16, muted | 400 |

Nothing below 12 px. No uppercase tracked eyebrows except table column heads (12 px).
Units (`kg`, `kcal`, `g`) are set smaller and muted beside the number they qualify.

### Spacing, shape, layout

- 4 px base: 4, 8, 12, 16, 24, 32, 48. Page title → content 24; section → section 32.
- Shell: `max-w-[1360px] px-10` (content 1280 px), centred, shared by header and every page.
- Radius: 10 px cards, 6–8 px inputs and buttons. No shadows except popovers.
- Cards only for units you act on. Summaries, ledgers and stat rows sit on the paper,
  separated by hairlines.
- Icons: Lucide, 16 px (14 px inline), stroke 1.75, muted until hovered.

### States

- Focus: `outline 2px solid var(--ring)` with 2 px offset on every focusable; inputs use a
  2 px ring. Hover: surfaces darken one step (`sunken`), links go to ink.
- Disabled: 45 % opacity, no pointer. Saving: inline "Saving…" in the header; saved: a check
  and "Saved" that fades. Errors: a callout with icon, plain cause, the fix.
- Loading: skeleton blocks (sunken, pulse), not "Loading…" text alone.
- Selected / today / done / draft as in §4.

## 3. Global chrome

- Header 56 px, white, hairline bottom. Left: mark + "Fitness Lab". Nav: Week, Bodyweight,
  Nutrition, History; active = ink text with a 2 px ink bar on the header's bottom edge,
  inactive = muted, hover ink.
- Right: today's date, then a status control (dot + "Local"). It opens a small panel with
  server status, version and SQLite version. The permanent footer is removed.

## 4. Week (home)

```
Wednesday 23 September                               [▮▮▮▯▯▯▯▯▯▯▯▯]  Week 3 of 12
12-Week Advanced Natural Hypertrophy + Strength · Mon 21 – Sun 27 Sep   Start unplanned session
┌ TODAY ───────────────────────────────────────────────────────────────────────────────┐
│ In progress · Upper B            8 exercises · 21 sets             [Continue Upper B] │
└──────────────────────────────────────────────────────────────────────────────────────┘
 MON 21 ✓   TUE 22 ✓   WED 23 today   THU 24 ●draft   FRI 25   sat  sun   (7 tiles)
 Bodyweight (hero + sparkline) | Nutrition today (4 meters) | Recent training (sets)
```

- Title = today's date. Block timing is secondary: rail of 12 segments (past filled ink,
  current plan-blue, future sunken) + "Week 3 of 12"; before the block: empty rail and
  "Block starts Thu 1 Oct · in 8 days".
- Today band, first match wins: a draft anywhere this week → "In progress", Continue;
  today's session not started → "Today", Start; today's session done → "Done today", View,
  plus the next session; rest day → "Rest day" + "Next: <day> · <session>"; no program →
  heading "No active program" and plain instructions.
- Day tiles: training days take 1.35fr, rest days 0.75fr and recede (no card, sunken, "Rest").
  Today: ink date badge. Done: green check + "Done", View link. Draft: amber dot + "Draft",
  primary Resume. Not started: calm white card, outline Start.
- Summary row, three equal columns, same height:
  - Bodyweight: latest as metric, 14-day sparkline (daily faint points, 7-day line), 7-day
    average and change.
  - Nutrition today: four meters. Protein and fat always have a bar to their fixed target;
    calories and carbs get a bar only when a calorie target exists — otherwise the logged
    number and "target not set", never an empty bar.
  - Recent training: last completed session, exercise → work sets; earlier session as a link.
- Every card has a designed empty state (icon, what is missing, what creates it).

## 5. Workout entry

- Sticky header: ← Week, title, status pill (`Draft` amber / `Complete` green), date field,
  "N of M sets" progress, saving indicator; right: Details, then the primary action
  (Complete workout) or Reopen to correct.
- Body: one white sheet, exercises in two columns that flow top-to-bottom (CSS columns, so
  keyboard and visual order agree), separated by hairlines, no card per exercise.
- Exercise block order: index + name (15 px semibold) + set progress `2/3`; target line in
  plan-blue 13 px; last-performance line 13 px; then the set table.
- Set table: SET | KG | REPS | RIR | TYPE | actions, fixed widths (2 / 5 / 4 / 3.5 / 6.5 rem).
  Saved rows are borderless text-like inputs (hover well, focus ring); pending rows sit in
  sunken wells with plan-blue placeholders; warm-up rows are muted. Row actions (note, move,
  delete) are Lucide icons revealed on row hover or focus. Keyboard flow is unchanged.
- Secondary details (slot notes, substitution, session notes, start time) stay behind small
  icon buttons and "Details".

## 6. Bodyweight

- Header row: title + method line; the entry form is a compact inline row on the right side
  of the metrics, not the hero.
- Metrics row on paper: Latest (hero) · 7-day average · previous 7 days · change (arrow +
  kg + %). Unknown change: "after a week of weigh-ins on each side".
- Chart panel (8 of 12 columns, 280 px): daily = small faint points; 7-day average = 2.5 px
  plan-blue line with an end label; y-range at least 2 kg. Weigh-ins ledger (4 columns)
  beside it, scrolling, actions on hover.
- Empty: the chart frame keeps its size with a centred message: "No weigh-ins yet" / "Save
  your first morning weight above; the 7-day trend starts from it."

## 7. Nutrition

- Header: title + day navigator (‹ date › Today).
- Daily summary (7 columns): four meter rows — label, logged number (large), "of <target>",
  8 px bar with the fill in ink (plan-blue when under, ink when met), "N g to go" / "N g
  over". Unknown calorie target: calories and carbs show the logged number and "Calorie
  target not calibrated yet." / "Follows the calorie target." — no bar.
- Log form (5 columns, white card): 2×2 inputs, notes, Save day. Calorie target line and
  "Set calorie target…" below the summary.
- Last 14 days: compact ledger on paper; kcal vs target when known; protein met/under mark;
  the date cell is a real button.
- Empty day: meters show "—" and a single line on what to log.

## 8. History

- Left rail (18 rem): filter with search icon; each exercise two lines — name, then
  "3 sessions · Tue 22 Sep".
- Detail: exercise name + stat row (latest top set, change since first exposure, sessions,
  last date). Then the raw evidence table: WK | DATE | SESSION | SETS (every set as
  `kg×reps@RIR`, warm-ups muted with ʷ) | TOP SET | Δ vs previous. The top-load chart
  (with markers) follows, secondary.
- Empty: rail still lists the exercise library (muted, "no sessions yet"); main area shows
  "History begins with your first completed workout." + what will appear (dates, sets, kg,
  reps, RIR) + "Go to this week".

## 9. Verification

- Unit, typecheck, lint, build, full E2E stay green; copy changes update their assertions.
- Visual QA: `e2e/playwright.visual.config.ts` screenshots every screen, empty and populated
  scratch datasets, at 1440×900 and 1728×1117 into `artifacts/visual/<tag>/`.
