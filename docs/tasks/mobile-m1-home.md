# Mobile M1 — foundation + Home (task file)

Started 2026-09-24 from `main` @ `3bd39a9`, on branch `claude/friendly-johnson-vd9ra0`.
Scope: mobile project foundation, design tokens, app shell/navigation, one Home screen on
fixture data. Out of scope (not started): workout logging, Training / Nutrition / History
functionality, persistence, SQLite, data migration from the web app, auth, sync, social,
meal database, PR/e1RM. `web/` and `backend/` are untouched.

Status: **M1 done.** Native iPhone behaviour: **NOT YET VERIFIED** (no macOS/Xcode here).

## Versions

- create-expo-app default template (`npx create-expo-app@latest mobile --yes`)
- Expo SDK 57 (`expo ~57.0.25`), React Native 0.86.3, React 19.2.3, Expo Router ~57.0.23,
  TypeScript ~6.0.3 (strict), react-native-reanimated 4.5.1, React Compiler on (template)
- Tests: jest 29 + jest-expo ~57.0.5 + @testing-library/react-native 14 (`test-renderer`)
- Lint: eslint 9 + eslint-config-expo ~57.0.2, config copied verbatim from Expo CLI's
  template (what `expo lint` writes), run with `--max-warnings 0`
- Font: Geist (`@expo-google-fonts/geist`, bundled) — the web app's typeface

## Decisions

- D1 **Guidance.** Kept Expo's generated `AGENTS.md` and `.claude/settings.json` (Expo plugin)
  unchanged. `mobile/CLAUDE.md` imports `@AGENTS.md` (as generated) and adds only mobile
  invariants: independence, layers, design-system rules and verification.
- D2 **Layers.** `domain` (pure TS) → `data` (facts, fixtures, source) → `ui`/`theme` →
  `features` (pure view model + components) → `app` (routes). Enforced by
  `src/__tests__/architecture.test.ts` (verified to fail when a domain file imports
  `react-native`). No runtime network anywhere (same test).
- D3 **Persistence seam.** `src/data/home-source.ts#loadHomeFacts()` returns the fixture.
  `HomeFacts` holds only recorded facts (sets, macro grams, integer-gram weigh-ins);
  calories, averages, statuses and the block week are derived in `domain/`, mirroring the
  root invariants (calories = P×4 + C×4 + F×9; shortened ≠ done; block phases exact to the
  day; bodyweight in kg from integer grams).
- D4 **Fixture.** Thursday 2026-10-08, block week 2 of the locked 12-week program (start
  2026-10-01), Upper B under way (9 of 21 sets). Names and set counts follow
  `programs/advanced-natural-12w/package/program.json`; all numbers are invented. The date
  is part of the fixture (not the device clock) so tests and screenshots are deterministic.
- D5 **Navigation.** A custom floating tab bar on the headless `expo-router/ui` Tabs, the
  same on iOS, Android and web (so browser QA shows the real bar): Home, Training,
  Nutrition, History + a separate round Quick Add button. Chosen over `NativeTabs` because the
  Quick Add button sits beside the bar and web QA would otherwise not show the real bar.
  Settings is a pushed stack screen from the Home header gear. Quick Add is a `formSheet`
  route (fit to contents) listing Workout / Food / Bodyweight; in M1 each only routes to
  its future owning tab. Training / Nutrition / History / Settings are honest "Not built
  yet" placeholders.
- D6 **Visual identity.** Tokens carry over web V3.1: mint paper `#EDF3EF`, white cards
  with green-tinted layered `boxShadow`, ink `#0F1F19`, one emerald family (primary
  `#1B684F`), steel blue `#3A6680` only for "planned", macro colours from the web app.
  From the references: large date header, week strip with the day filled, one tall
  workout hero with a single dominant CTA, two-up summary cards, floating bottom bar +
  round add button. Not copied: branding, avatar/greeting, gamification counters, chat
  box, social tab, food photos.
- D7 **Muscle artwork seam.** `src/features/home/muscle-art.ts#muscleArt(groups)` returns
  an `ImageSource | null`; null shows a quiet placeholder ("Muscle map"). The focus
  muscles are always stated in text under the workout name, so art is never the only
  carrier. Rejected: chips inside the panel (wrapped onto two rows at 430 pt).
- D8 **Light only.** `userInterfaceStyle: "light"`; dark mode is not designed in M1.
- D9 **Offline tooling.** api.expo.dev and docs.expo.dev are blocked by this environment's
  egress policy (403). `expo install` ran with `EXPO_OFFLINE=1` (versions from the SDK's
  `bundledNativeModules.json`); versioned API facts came from the installed SDK 57 type
  definitions instead of the docs site.

## Files

- `mobile/` — Expo project (template demo screens, components, reset script, template
  LICENSE and unused template images removed; app icons/splash kept as placeholders).
  - `src/app/` — `_layout.tsx` (fonts, Stack), `(tabs)/_layout.tsx` (tab bar),
    `(tabs)/{index,training,nutrition,history}.tsx`, `settings.tsx`, `quick-add.tsx`
  - `src/domain/` — `dates`, `block`, `nutrition`, `bodyweight`, `training`
  - `src/data/` — `home-facts.ts`, `home-source.ts`, `fixtures/home.ts`
  - `src/features/home/` — `home-view.ts`, `format.ts`, `muscle-art.ts`,
    `home-screen.tsx`, `components/*`
  - `src/features/shell/` — `tab-bar.tsx`, `quick-add-sheet.tsx`, `placeholder-screen.tsx`
  - `src/theme/` — `tokens.ts`, `typography.ts`; `src/ui/` — Text, Card, CardHeading,
    Icon, ProgressBar, Pressable
  - tests: `src/domain/__tests__`, `src/features/home/__tests__`, `src/__tests__`
- `docs/tasks/mobile-m1-home.md` (this file)
- Root `CLAUDE.md`: one repository-layout line pointing to `mobile/` (nothing else changed).

## Verification (2026-09-24, Linux cloud container)

- `npm install` (via create-expo-app + `expo install`): OK.
- `npm run typecheck` (tsc strict, typed routes generated): pass.
- `npm run lint` (`expo lint --max-warnings 0`): pass, 0 warnings.
- `npm test`: 4 suites, 39 tests pass (domain 13, view model 12, Home render 4,
  architecture 10).
- `npx expo start --web`: Metro starts; the app serves at localhost:8081.
- `npx expo export --platform ios --platform android --platform web`: all three bundles
  build (iOS Hermes bytecode 2.5 MB).
- `npx expo-doctor`: 19/21 pass; the 2 failures are network lookups blocked by the egress
  policy (config schema service, React Native Directory).
- Visual QA: Playwright + Chromium at 430×932 @3x with iPhone 14 Pro Max safe areas
  simulated (59 pt top / 34 pt bottom): Home top, Home scrolled, Quick Add, Training,
  Settings. No console errors or warnings; page width = viewport (no horizontal overflow).
  Screenshots stayed in the session scratchpad (not committed).
  Fixed from QA: tab slot not bounded (whole page grew, nothing scrolled); muscle chips
  wrapping; a date title that would overflow for long dates (28 pt + auto-shrink); a
  misleading web placeholder glyph; the Bodyweight card's empty lower half.

## Not verified

- Native iPhone (simulator or device): layout, SF Symbols, Geist loading, `formSheet`
  Quick Add (on web it renders full-screen), safe areas, press feedback, Dynamic Type.
- Android device/emulator.
- VoiceOver pass (roles and labels are set and asserted in tests, not heard).

## Next

- Local: `cd mobile && npm install && npx expo start`, then press `i` (Xcode simulator) or
  open in Expo Go on the iPhone, and check Home against the screenshots in the QA notes.
- M2 candidates (not started): persistence (expo-sqlite) behind `loadHomeFacts`, the
  Training/workout flow, original muscle artwork.
