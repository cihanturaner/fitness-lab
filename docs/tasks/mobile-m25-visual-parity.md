# Mobile M2.5 — Home + Training visual parity (task file)

Started 2026-09-24 from `main` @ `c3c4c16` (= `mobile-m2-frozen`), on branch
`claude/wizardly-planck-46kmvf`. Status: **M2.5 done.** Native iPhone: **NOT YET VERIFIED**.

## Scope

A presentation-only redesign of the existing mobile Home and Training screens toward three
reference screenshots supplied with the task (a third-party fitness app: Home, Nutrition,
Profile). Only Home, Training, the shared primitives they need, the floating tab bar and a
new anatomy component changed.

Not changed: domain calculations, program facts, fixtures, week navigation, session
statuses, prescriptions, the plan screen's layout, `web/`, `backend/`. No logging,
persistence, SQLite, nutrition/history screens, auth or network. M1/M2 behaviour is intact
(every M1/M2 behavioural test still passes unchanged; the only edited assertion is the
`SelectedWorkout` shape, which gained a `focus` field).

## Reference-driven decisions

- R1 **Composition taken from the references:** compact personal header → one-row date
  strip with today as a filled pill → one large white workout card (name in capitals,
  status top-right, front/back anatomy as the centerpiece, full-width CTA anchored at the
  bottom) → "Progress" with small two-up stat cards → floating white pill tab bar with a
  separate round "+" button.
- R2 **Not taken:** brand, logo, blue palette, avatar/greeting ("Hey Max"), trophy/streak
  counters, "Ask Max" chat box, Social/Explore tabs, 3-D/realistic figure artwork, pencil
  edit button, food photos. Fitness Lab keeps its mint/emerald identity and its own tabs
  (Home, Training, Nutrition, History + Quick Add; Settings from the Home gear).
- R3 **Header.** The dashboard-size date title (28 pt heavy + eyebrow) became a compact
  23 pt bold title with the block week under it and the Settings gear on the right — no
  invented profile data.
- R4 **Date strip.** No tiles: plain numbers (ink on training days, faint on rest days), a
  5 pt status mark under each training day, today as a 42 pt emerald pill ("Thu 8").
- R5 **Hero.** Workout name 23 pt capitals in emerald, status chip top-right, meta line;
  anatomy sized by `useAnatomyHeight()` (≤ 290 pt, ≤ 66 % of screen width, and small
  enough that the CTA stays on a 375 × 667 first screen); focus named in text under the
  figures; sets / % / "Up next" kept but secondary; 52 pt CTA in spaced capitals.
- R6 **Progress.** Four equal stat cards in two rows (Calories · Macros, This week ·
  Bodyweight): tinted icon + 15 pt title on top, the figure pushed to the bottom. Values and
  captions are the same view-model strings as before (calories still derived from macros).
- R7 **Tab bar.** Fully rounded 68 pt pill (radius = height / 2), selected tab as an
  emerald-100 capsule with emerald icon/label, 23 pt icons, separate 68 pt round Quick Add,
  a single soft `shadow.dock`. Safe-area placement (`barBottom`) and `tabBarClearance()`
  unchanged in form.
- R8 **Training** uses the same language: compact title, one white pill week navigator
  (‹ range / "This week" or "Back to this week" ›), day capsules on the page instead of
  white tiles (filled = selected, ring = today), the selected workout as the same hero card
  as Home (anatomy only when a focus is stated, 0.84 × Home's size) with "View plan" as its
  one CTA, then a lighter Sessions list (date badge, name + plain status, detail, thin bar;
  no chevrons, because a row selects a day rather than navigating).
- R9 **Tokens.** Paper lightened `#EDF3EF` → `#F1F5F3` (near-white mint-grey); card shadow
  softened; new `shadow.dock`; anatomy tones (`body`, `bodyPlate`, `bodyFloor`,
  `muscleLight`, `muscleDeep`); new text styles `screenTitle`, `workoutName`, `section`,
  `cardTitle`, `stat`, `cta`, `day`. Existing styles unchanged, so the plan screen only
  picks up the lighter paper.
- R10 **Shared primitives** (in `src/ui/`): `StatusChip` (moved from Training, now a
  rounded pill with a `plain` variant for list rows), `StatCard`/`StatValue`, `HeroButton`,
  `anatomy/*`. Removed: `CardHeading`, Home's `NutritionCard`/`summary-cards`,
  `muscle-art.ts` (the old image seam).
- R11 **Placeholder tabs** (Nutrition, History) use `screenTitle` instead of `largeTitle`,
  so the title does not jump between tabs. Nothing else on them changed.

## Anatomy approach

- `src/ui/anatomy/anatomy-art.ts` — original artwork: a neutral silhouette (head, neck,
  torso, arm, hand, leg, foot) plus flat, segmented muscle plates, each tagged with a
  `MuscleGroup` or `null` (forearms, obliques, lower back — shape only, never highlighted).
  Front: traps (back), deltoids, pecs, biceps, abs, quads, calves. Back: traps + lats
  (back), rear deltoids, triceps, glutes, hamstrings, calves. Only the left half is authored
  in a 200 × 440 box; the renderer mirrors it, so the figure is exactly symmetric. Paths
  were hand-authored and iterated against Chromium renders — nothing traced or copied.
- `anatomy-figure.tsx` — `react-native-svg` (added: `15.15.4`, the version pinned by SDK
  57's `bundledNativeModules.json`, included in Expo Go): silhouette in `body`, plates in
  `bodyPlate` with white separation strokes, stated groups in a vertical emerald gradient.
  Hidden from assistive technology (`accessibilityElementsHidden` /
  `no-hide-descendants`).
- `muscle-focus.tsx` — figure + the focus in text, and the area's accessibility label
  ("Focus: Back, Chest, …"). With no stated focus the body stays neutral and the text says
  "No muscle focus stated for this workout".
- **Facts only.** Highlights come only from `HomeFacts.todayWorkout.focus` and
  `TrainingFacts.focus`, which hold M1's Upper B focus and nothing else. Upper A, Lower A,
  Lower B show no highlights (Training draws no figure for them; Home would draw a neutral
  one). Nothing is inferred from exercise names.

## Checklist

- [x] Tokens, typography, shared primitives
- [x] Anatomy component + artwork + seam note in `mobile/CLAUDE.md`
- [x] Home: header, date strip, workout hero, Progress cards
- [x] Training: title, week navigator, day selector, selected workout, Sessions list
- [x] Floating tab bar
- [x] Focused tests: anatomy highlights exactly the stated plates / neutral when none /
      hidden from a11y / every group drawable / artwork is left-half only; Home and Training
      draw only a stated focus
- [x] Visual QA at 430 × 932 and 375 × 667; side-by-side with the references

## QA checklist and result (2026-09-24, Linux cloud container)

Metro web (`npx expo start --web`) + Playwright/Chromium, device scale 2, safe-area insets
simulated (430 × 932: 59 / 34 pt; 375 × 667: 20 / 0 pt) with the status-bar and
home-indicator bands drawn over each shot. Scripted on every shot: no horizontal overflow,
the scroll viewport starts below the status bar, no console errors.

| Screen | 430 × 932 | 375 × 667 |
| --- | --- | --- |
| Home top / mid-scroll / bottom | pass | pass |
| Workout hero (CTA on first screen) | pass | pass (CTA ends 9 pt above the tab bar) |
| Progress cards (last card clears the bar) | pass | pass |
| Bottom nav | pass | pass |
| Home: workout without stated focus, rest day (temporary source swap, reverted) | pass | — |
| Training week 2 top / scrolled / bottom | pass | pass |
| Training selected workout, rest day | pass | pass |
| Training week 1 (before-block days, shortened ≠ done) | pass | pass |
| Training week 12 (next disabled) | pass | pass |
| Plan screen top / bottom (regression only) | pass | pass |

Fixed during QA: Sessions detail truncated at 375 pt (status moved onto the name row, chevron
dropped); Bodyweight caption truncated at 375 pt (split into lines); workout name and section
headings reduced after the side-by-side; figure enlarged on large phones while keeping the
375 × 667 CTA on screen. Known: the hero's "Up next" line truncates at 375 pt (full text
remains in the element).

### Reference parity

1. Top spacing — comparable: content starts right under the status bar, no banner.
2. Date strip — one row, ~42 pt pill for today like the reference's; adds a 5 pt status mark.
3. Hero proportions — one dominant white card, radius 28, full width; it carries progress
   and "Up next" in addition, so it is a little taller than the reference's.
4. Anatomy — front/back pair centred, ≈ 285 pt tall at 430 pt (the reference's is somewhat
   larger and darker); ours is flat mint with emerald highlights.
5. CTA — full width at the card's bottom, spaced capitals, 52 pt (reference ≈ 44 pt).
6. Progress density — two-up small cards, icon + title top, figure bottom — as the
   reference; four cards instead of two, because Home already showed four facts.
7. Nav — floating white pill + separate round "+", selected capsule, labels under icons —
   matches.
8. Typography — 23 pt title / 23 pt workout name / 20 pt section / 26 pt stat; the
   reference's are slightly smaller still.
9. Whitespace — compact gutters (20 pt) and 12–16 pt card gaps, like the reference.
10. Hierarchy — workout identity → anatomy → progress → CTA → Progress cards.

## Verification

- `npm run typecheck` pass · `npm run lint` pass (0 warnings) · `npm test` 9 suites,
  98 tests pass (89 before; +9 focused tests).
- `npx expo export --platform ios`: Hermes bundle builds (2.7 MB; `dist/` not committed).
- `git diff mobile-m2-frozen..HEAD -- web backend`: empty.

## Not verified (needs a physical iPhone or simulator)

- `react-native-svg` rendering on iOS (gradient fill via `url(#id)`, mirrored group
  transform) — verified in jest and on web only.
- SF Symbols for the new icons (`flame.fill`, `chart.pie.fill`, `calendar`,
  `scalemass.fill`), their weights and optical sizes in the tab bar and cards.
- Real safe areas (Dynamic Island, home indicator) around the floating bar; the
  `boxShadow` rendering of the dock and CTA; press feedback; Dynamic Type at larger sizes
  (the capitals workout name is one line); VoiceOver reading order of the hero and the
  stat cards.

## Deferred

- M3 workout logger; nutrition and history screens; persistence (expo-sqlite); a real clock.
- Muscle focus for Upper A, Lower A, Lower B: needs an authoritative source first.
- Finer anatomy (forearm/adductor detail, a female figure) if ever wanted.
- Dark mode (still light only).
