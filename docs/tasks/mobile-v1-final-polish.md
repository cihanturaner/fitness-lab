# Fitness Lab Mobile V1 — Final Polish + Overnight RC Audit

## Mission
Work from the existing visual-candidate branch and turn it into the final **cloud-verifiable Mobile V1 release candidate**.

This is **not** a feature-build task and **not** a product rewrite.

Remaining work:
1. one last targeted visual-polish pass on **Home + Training + anatomy + top chrome + floating nav**;
2. a limited shared-system consistency sweep;
3. a focused release-candidate audit of the already-built V1;
4. browser-based state/journey verification;
5. final gates and a concise physical-iPhone checklist.

Do not reopen working architecture or domain logic unless a confirmed regression requires a minimal fix.

## Starting point
Repository: `fitness-lab`

Create a **new branch** from:
- branch: `claude/mobile-v1-final-visual-parity`
- HEAD: `e4972c6`

Do not modify the source branch directly.
Do not merge `main`.
Do not tag a release.

## Canonical visual inputs
The **three attached reference screenshots** are the canonical visual target.
The attached current physical-iPhone Fitness Lab screenshots are the BEFORE state.

Use the references for:
- composition
- hierarchy
- density
- whitespace rhythm
- hero-card proportions
- anatomy presence
- date/week chrome
- typography scale
- CTA placement
- Sessions hierarchy
- floating-nav proportions
- overall premium consumer-fitness polish

Do **not** copy their brand, logo, blue palette, proprietary artwork, avatar/user identity, fake data, or fake features.
Fitness Lab remains emerald/mint.

## Locked behavior
Treat current RC behavior as locked unless a reproducible regression is found.

Do not change:
- program data
- block-date math
- week/day scheduling
- workout status semantics
- exercise names
- sets/reps/RIR/rest/failure rules
- SQLite schema/repositories
- import/export behavior
- macro derivation
- bodyweight rules
- navigation semantics
- logger behavior

Do not touch `web/` or `backend/`.
Do not add product features.

# Phase A — Final visual polish

## A1. Anatomy refinement
The current anatomy is much better, but it still reads slightly like an SVG muscle map.

Refine the **existing original artwork** rather than replacing it with copied or licensed competitor art.

Target:
- more natural athletic silhouette
- smoother shoulder → upper-arm transition
- stronger clavicle / upper-chest relationship
- more natural lat taper
- cleaner waist/hip transition
- less mannequin-like legs
- better quad/hamstring/calf contour
- fewer visually dominant divider seams
- more coherent neutral body
- highlighted regions integrated into the figure rather than appearing pasted on
- front/back pair feels like one deliberate illustration system

Preserve:
- original artwork
- front + back
- scalability
- authoritative-focus-only behavior
- Upper B focus: Back, Chest, Shoulders, Triceps, Biceps
- no invented focus for workouts without authoritative focus data

Do not spend the task making medically exhaustive anatomy.
The goal is **premium fitness-app artwork at iPhone size**.

## A2. Training top chrome
The current Training screen is still somewhat planner-like.

Reduce the vertical and visual weight of:
- page header
- Week badge
- week navigator
- day selector

The selected workout should become dominant earlier.
Use the canonical screenshots as the proportional benchmark.
Keep all current controls and semantics.
Do not hide useful navigation.

## A3. Workout hero calibration
For both Home and Training:
- anatomy remains the visual centerpiece
- title/status hierarchy should be crisp and quiet
- metadata should not compete with anatomy
- CTA remains strong and anchored
- reduce unnecessary vertical padding
- reduce unused white space
- keep enough breathing room to feel premium
- do not globally shrink typography just to fit

On 430×932 and 375×667, the hero should feel controlled rather than oversized.
The next section should enter the viewport earlier without making the hero feel cramped.

## A4. Sessions hierarchy
Sessions should remain useful but visibly secondary.

Refine only:
- row density
- date tile weight
- status prominence
- spacing
- muted explanatory copy
- selected-row treatment

Do not remove session facts.

## A5. Floating navigation calibration
Current direction is good.

Only adjust if direct comparison to the references supports it:
- pill height
- selected-tab footprint
- icon/label scale
- plus-button diameter
- gap between main pill and plus
- bottom offset
- shadow weight

Do not change routing.

# Phase B — Limited shared-system consistency sweep
Inspect after Home/Training calibration:
- Session Plan
- Workout Logger
- Nutrition
- Bodyweight
- History
- Settings
- Quick Add

Do **not** redesign them.

Fix only obvious inconsistencies caused by shared primitives/tokens:
- typography drift
- old radius
- old button sizing
- inconsistent page gutter
- floating-nav clearance
- obvious text truncation
- shared colour token mismatch

No new features.
No architecture changes.

# Phase C — Browser state matrix
Use deterministic dev/test state. Do not contaminate production data.

Render and visually inspect:

### Home
1. active Upper B
2. in-progress Upper B if feasible
3. rest day
4. pre-block
5. no block
6. completed workout state if easily seedable

### Training
7. Week 1 Upper B selected
8. Week 1 scrolled
9. Week 12 boundary
10. rest day selection
11. pre-block selection

### Other core screens
12. Session Plan
13. Workout Logger
14. Nutrition
15. Bodyweight
16. History
17. Settings
18. Quick Add

Required viewport sizes:
- 430×932
- 375×667

Use a narrower width only if needed to expose clipping.

Check:
- no horizontal overflow
- no hidden CTA
- no content trapped behind floating nav
- no broken long exercise names
- no unexpected wrapping in date/week controls
- no obvious status-bar collision in browser layout
- no console errors

For Home and Training, compare canonical reference and current render **side by side**.

If the result still feels materially like the current BEFORE state with minor spacing tweaks, continue iterating.

# Phase D — Core journey smoke audit
Do not rebuild test infrastructure.

Using existing tests/browser tooling, verify these existing journeys still work:
1. open app → Home
2. Home → current workout
3. Training → select week/day → View Plan
4. workout logger → enter/update a set
5. Nutrition → update macros → Home reflects them
6. Quick Add → bodyweight → Home/History reflects it
7. History → open past workout
8. persisted data survives reload / cold-style restart in the test environment
9. valid import preview/import path still works
10. duplicate exercise slots remain independent

Only fix confirmed regressions.
Do not opportunistically refactor working systems.

# Phase E — Accessibility / interaction sanity pass
Inspect, do not over-engineer.

Check obvious issues:
- interactive targets are approximately 44 pt or larger
- selected states remain exposed to accessibility
- buttons have clear labels
- anatomy is decorative / hidden appropriately when equivalent text exists
- long text does not become unreadable
- read-only vs editable screens remain visually distinguishable

Physical VoiceOver and real Dynamic Type remain device-only.

# Phase F — Final gates
Run focused checks while editing.

Run the full gates **once near the end**:

```bash
npm run typecheck
npm run lint
npm test
npx expo export --platform ios
```

Then verify:

```bash
git diff e4972c6..HEAD -- web backend
git status --short
```

Requirements:
- typecheck passes
- lint passes with zero warnings
- tests pass
- iOS export builds
- `web/` and `backend/` diff is empty
- no untracked source files
- no unrelated dependency upgrades
- do not run `npm audit fix`
- do not change package files unless truly necessary for this visual task

# Context discipline
This is a scoped task.

Read:
- root `CLAUDE.md`
- `mobile/CLAUDE.md`
- this task file
- only code relevant to Home/Training/anatomy/shared UI and the specific regression checks

Do not preload unrelated repo areas.

Use subagents/reviewers only when they reduce context load.

Good uses:
- one visual-comparison reviewer
- one final regression/scope reviewer

Do not create a swarm.

Keep discoveries and checkpoints in this task file instead of repeatedly restating them in chat.

# Git checkpoints
Create a new branch from `e4972c6`.

Suggested commits:
1. `polish(mobile): refine anatomy and hero proportions`
2. `polish(mobile): tighten Training chrome and sessions hierarchy`
3. `chore(mobile): final visual RC audit fixes`

Different clean boundaries are fine.
Push meaningful checkpoints.
Do not rewrite working history just to make it prettier.

# Stop conditions
Do not ask ordinary implementation questions.

Stop and ask only if:
1. preserving current behavior is impossible without a product decision;
2. a destructive data change would be required;
3. authoritative sources conflict;
4. a required external asset/license would make the visual result unsafe;
5. proceeding risks user-data loss.

Subjective choices already covered by the canonical screenshots are not blockers.

# Final blocker review
At the end, run one bounded reviewer over the diff from `e4972c6`.

Review only for merge-blocking issues:
- obvious visual-reference miss on Home/Training
- hidden/clipped CTA
- anatomy regression
- broken navigation
- accidental domain/data changes
- program-fidelity changes
- accessibility regression
- unexpected `web/` or `backend/` changes
- untracked source files
- obvious small-phone layout failure

Fix confirmed blockers.
Then rerun affected focused checks plus final gates.

# DONE definition
Do not declare DONE until all cloud-verifiable items below are true:
1. canonical references were actually inspected;
2. current iPhone screenshots were actually inspected;
3. anatomy looks materially more natural/premium;
4. anatomy remains original;
5. authoritative muscle-focus behavior is preserved;
6. Training top chrome is visibly lighter;
7. selected workout dominates Training hierarchy;
8. hero proportions are more controlled;
9. Sessions are clearly secondary;
10. floating nav remains polished;
11. Home/Training are materially closer to the references;
12. empty/rest/pre-block states remain intentional;
13. shared screens have no obvious style regression;
14. core journeys still work;
15. no domain/data behavior was intentionally changed;
16. browser QA passes at 430×932 and 375×667;
17. no horizontal overflow;
18. no obvious nav overlap;
19. typecheck passes;
20. lint passes with zero warnings;
21. tests pass;
22. iOS export builds;
23. `web/` and `backend/` diff is empty;
24. no untracked source files;
25. final blocker review has zero unresolved blockers;
26. work is committed and pushed;
27. final physical-iPhone approval is explicitly left to the user.

# Final response format

## FINAL OVERNIGHT CANDIDATE
- branch
- final HEAD
- commits

## VISUAL POLISH
- anatomy
- Home
- Training
- Sessions
- floating nav

## CONSISTENCY SWEEP
- exact screens touched
- why

## JOURNEY AUDIT
- journeys verified
- any regressions found/fixed

## VISUAL QA
- states rendered
- viewport sizes
- remaining reference deviations

## GATES
- typecheck
- lint
- exact test count
- iOS export
- web/backend diff
- git tracking

## PHYSICAL IPHONE TOMORROW
- short exact checklist

Do not merge `main`.
Do not tag.
Then stop.

---

# Progress ledger

Branch `claude/mobile-v1-final-rc` from `e4972c6`. References (3) and BEFORE iPhone shots (2)
inspected.

## Changes
- Anatomy (original art, same plate set minus two): new body outline — lat taper to a
  narrower waist, hip flare, fuller outer thigh, calf bulge, rounder ankle/foot; arm tapers
  to the wrist; neck "fork" (SCM) and knee-cap plates removed; seams 0.9 → 0.6 pt and
  resting-plate tones moved toward the body so muscles read as shading, not cut-outs.
  Focus behaviour untouched (only stated groups highlight).
- Training chrome: title and a small mint `‹ Week n of 12 ›` stepper share one row; the
  dates + "This week" / "Back to this week" are one caption line; day capsules 54 → 48 pt.
  The hero card now starts ~40 pt higher (146 vs 185 pt at 430 wide).
- Hero (Home + Training): anatomy/CTA margins 16 → 12–14 pt; focus-line gap 12 → 10.
- Sessions: selected date tile mint (was solid emerald), rows 58 → 54 pt, section gap 24 → 20.
- Floating nav: unchanged — already matches the reference proportions (64-pt pill/plus).

## Consistency sweep
Session Plan, Logger, Nutrition, Bodyweight, History, Settings, Quick Add inspected at
430×932 and 375×667: no token/radius/gutter/clearance drift found; none changed.

## Visual QA (Metro web, Chromium, fixed clock, fresh storage)
16 states × 2 viewports (Home Upper B / scrolled / rest / pre-block / no block; Training
w1 / scrolled / w12 / pre-block; Plan, Logger, Nutrition, Bodyweight, History, Settings,
Quick Add): no horizontal overflow, no console errors, CTAs on first screen, last content
clears the bar. Not rendered: Home in-progress, completed (covered by RTL tests).

## Journeys
Browser: Settings block start → Training next week / back to this week → select Fri → View
plan (`/plan/2026-10-02`); Quick Add → Bodyweight 82.4 → reload → Home and History show it.
RTL/jest: logger set entry, macros → Home, History past workout, reopen DB file, import
preview/import, independent slots (all in the 283-test suite).

## Gates
typecheck ok · lint 0 warnings · jest 20 suites / 283 tests · iOS export ok.
