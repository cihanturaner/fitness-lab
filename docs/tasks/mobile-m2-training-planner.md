# Mobile M2 — Training week planner (task file)

Started 2026-09-24 from `main` @ `499ebd8` (after `mobile-m1-frozen`), on branch
`claude/determined-planck-8ijxxe`. Status: **M2 done.** Native iPhone: **NOT YET VERIFIED**.

## Scope

Replace the Training placeholder with a 12-week week planner and a read-only session plan.
Fixture data only. Home, `web/` and `backend/` untouched.

## Locked decisions

- D1 **Seam.** `src/data/training-source.ts#loadTrainingFacts()` → `TrainingFacts`
  (`src/data/training-facts.ts`): today, block, the program's weekly template, and recorded
  sessions. Planned set counts come only from the program; statuses, weeks and schedules are
  derived (`domain/schedule.ts`, `domain/training.ts#dayStatus`).
- D2 **Fidelity.** `fixtures/program.ts` was transcribed mechanically from
  `programs/advanced-natural-12w/package/program.json` (names, order, reps, RIR per set) with
  rest / failure / marker from each slot's notes; a test compares it with the package field by
  field. Exercise names are the package's (e.g. "Cable Lateral Raise" for the
  Cable/Machine slot). No muscle focus is authored: the package has none. `TrainingFacts.focus`
  holds only M1 Home's existing Upper B focus (reused as is); other workouts show no focus
  line (repair, `M2 FINAL REPAIR`).
- D3 **Home agreement.** The Training fixture takes `today`, the block and week 2's records
  from the Home fixture itself (Thu 8 Oct, week 2 of 12, Upper B 9 of 21). Week 1 adds Upper B
  done and Lower B shortened (16 of 19). Tests assert Home and Training agree.
- D4 **Block rules.** Weeks are Mon–Sun; week 1 contains the start date. Days before the
  start (Mon–Wed of week 1) are "outside the block", never scheduled. Navigation is clamped to
  weeks 1–12; the planner opens on today's week (week 1 before the block, 12 after).
- D5 **Statuses.** Planned / In progress / Done / Shortened / Not recorded (a past day never
  opened). Shortened is never shown as Done.
- D6 **No logging.** The selected-session card's one action is "View plan", which pushes the
  stack route `plan/[date]` (native header, back to Training). The plan screen has no inputs
  or buttons. No Start / Continue in Training.
- D8 **Entry resets the week.** Entering Training (Home's workout CTA or the tab bar) lands on
  today in the current block week (`useFocusEffect`); only returning from Training's own plan
  preview keeps the browsed week. Home is unchanged.
- D7 **Layout.** Title + block week, week navigator (‹ range ›, "Back to this week" when away),
  7-day selector (filled = selected, ring = today, dot = status, dash = rest, dimmed = outside),
  the selected day (tall card for a workout, small card for rest/outside), then one Sessions
  card listing the week's workouts; rest days fold into a single line. Same safe-area frame as
  Home (top inset on a non-scrolling view).

## Checklist

- [x] Domain: `schedule.ts` (week dates, clamp, current week, scheduled workout), `dayStatus`
- [x] Data: types, program + training fixtures, source
- [x] View model `features/training/training-view.ts` (planner + plan preview), no React
- [x] Screen + components, route `(tabs)/training.tsx`, route `plan/[date].tsx`
- [x] Tests: domain boundaries, navigation limits, selection, statuses, Home consistency,
      plan order/prescriptions, fixture fidelity, render (read-only)
- [x] Visual QA 430×932 and 375×667 (web render, simulated insets)
- [x] `mobile/src/data/**` tracked by git (checked with `git check-ignore` and `git ls-tree`)

## Verification (2026-09-24, Linux cloud container)

- `npm run typecheck` pass (also with typed routes generated) · `npm run lint` pass, 0
  warnings · `npm test` 8 suites, 87 tests pass (after the repair).
- `npx expo export --platform ios`: iOS Hermes bundle builds (2.5 MB).
- Visual QA: Metro web + Playwright/Chromium at 430×932 (59/34 pt insets simulated) and
  375×667 (20/0): Training top / scrolled / bottom, rest day, week 1, week 12, plan top/bottom,
  Home → Training. Scripted checks: no horizontal overflow, every scroll viewport starts below
  the status bar, no console errors. Fixed from QA: date eyebrow truncating at 375 pt; plan
  header status line wrapping.

## Not verified

- Native iPhone (simulator/device): SF Symbols chevrons, stack header back title,
  safe areas, press feedback, Dynamic Type, VoiceOver.

## Deferred to M3+

- Start / continue a workout, set logging (lb · reps · RIR), complete / reopen / discard,
  change exercise, per-exercise recorded progress in the plan.
- Persistence (expo-sqlite) behind `loadHomeFacts` / `loadTrainingFacts`; a real clock.
