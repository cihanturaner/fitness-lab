@AGENTS.md

# Fitness Lab mobile — invariants

Mobile-only rules. The root `CLAUDE.md` (product constraints and data invariants) applies
here unchanged; this file does not restate it. Progress lives in `docs/tasks/mobile-*.md`.

## Independence

- `mobile/` is its own npm project (Expo SDK 57). It never imports from `web/` or `backend/`
  and never calls the FastAPI server: no runtime network at all (enforced by
  `src/__tests__/architecture.test.ts`).
- Recorded data lives in a device-local SQLite file (`expo-sqlite`, `src/data/db/`), with
  forward-only migrations in `schema.ts` (`SCHEMA_VERSION`); a newer schema is refused, never
  guessed at. Screens read facts through `src/data/facts-source.ts` and write through
  `src/data/repo/*` via `src/store/data-store.tsx` (`useQuery` / `useWrite`) — SQL lives in
  `src/data` only (architecture test). Never point anything at `data/fitness_lab.db`, and
  never commit a database, screenshot or user data. `src/data/fixtures/` is for tests only.
- "Today" comes from the injected `Clock` (`src/data/clock.ts`): the device's local date in
  the app, a fixed date in tests.
- The program is bundled (`src/data/program.ts`, transcribed from the package with slot keys
  and verbatim slot notes); `training-fixture.test.ts` checks it against the package. A
  workout names its origin by `workout_key`, a set its slot by `slot_key`
  (`performed_set_slot`): two slots of one exercise never merge.
- This environment blocks api.expo.dev: run `npx expo install` / `expo lint` / `expo-doctor`
  with `EXPO_OFFLINE=1`, which resolves versions from the local SDK manifest.

## Layers (one-way)

    domain -> data -> store -> ui / theme -> features -> app

- `src/domain/` — pure TypeScript fitness logic (dates, block phase, derived calories,
  bodyweight trend, session status). Imports only other domain files.
- `src/data/` — recorded facts (types), the SQLite schema and repositories, the bundled
  program, test fixtures. Nothing derived is stored.
- `src/store/` — the React bridge to `data` (`DataProvider`, `useQuery`, `useWrite`); after
  every write each mounted screen re-reads, so all screens agree.
- `src/features/<screen>/` — a pure view model (`*-view.ts`: facts + domain → display
  strings, tested without React) and the components that draw it.
- `src/app/` — Expo Router routes only; each file renders one feature screen.

## Design system

- Every colour, space, radius and shadow comes from `src/theme/tokens.ts`, every text style
  from `src/theme/typography.ts` (Geist, bundled). No raw hex or font names in features.
  The palette mirrors the web app's V3.1 emerald identity; steel blue means "planned".
- Icons only through `src/ui/icon.tsx` (SF Symbols on iOS, bundled Material Symbols on
  Android/web), named by meaning.
- One dominant emerald CTA per screen. Touch targets ≥ 44 pt. Numbers use tabular figures.
- Settings is not a tab (Home header gear). Tabs: Home, Training, Nutrition, History, plus
  the Quick Add button beside the bar. Tab screens pad their scroll content with
  `tabBarClearance()`. The `TabList`/`TabTrigger` JSX must stay in `src/app/(tabs)/_layout.tsx`
  (expo-router reads the tab routes from it).
- Muscle artwork: `src/ui/anatomy/` — original front/back figures drawn with
  `react-native-svg` from the plate paths in `anatomy-art.ts` (left half only, mirrored).
  Only a focus a source states is highlighted; with none the body stays neutral. The figure
  is hidden from assistive technology, so the focus is always also stated in text
  (`MuscleFocus`).

## Verification (from `mobile/`)

    npm run typecheck && npm run lint && npm test
    npx expo start --web     # then check at 430×932 (iPhone 14 Pro Max)

A browser render is not proof of native iOS behaviour (formSheet, SF Symbols, safe areas,
haptics). State "native iPhone: NOT YET VERIFIED" unless it ran on a simulator or device.
