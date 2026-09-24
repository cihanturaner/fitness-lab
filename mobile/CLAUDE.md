@AGENTS.md

# Fitness Lab mobile — invariants

Mobile-only rules. The root `CLAUDE.md` (product constraints and data invariants) applies
here unchanged; this file does not restate it. Progress lives in `docs/tasks/mobile-*.md`.

## Independence

- `mobile/` is its own npm project (Expo SDK 57). It never imports from `web/` or `backend/`
  and never calls the FastAPI server: no runtime network at all (enforced by
  `src/__tests__/architecture.test.ts`).
- Home reads `HomeFacts` from `src/data/home-source.ts`. M1 fills it from
  `src/data/fixtures/`; on-device persistence replaces that function's body later. Never
  point it at `data/fitness_lab.db`, and never commit a database, screenshot or user data.
- This environment blocks api.expo.dev: run `npx expo install` / `expo lint` / `expo-doctor`
  with `EXPO_OFFLINE=1`, which resolves versions from the local SDK manifest.

## Layers (one-way)

    domain -> data -> ui / theme -> features -> app

- `src/domain/` — pure TypeScript fitness logic (dates, block phase, derived calories,
  bodyweight trend, session status). Imports only other domain files.
- `src/data/` — recorded facts (types), fixtures and their source. Nothing derived.
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
- Muscle artwork: replace `muscleArt()` in `src/features/home/muscle-art.ts`; the focus is
  always also stated in text.

## Verification (from `mobile/`)

    npm run typecheck && npm run lint && npm test
    npx expo start --web     # then check at 430×932 (iPhone 14 Pro Max)

A browser render is not proof of native iOS behaviour (formSheet, SF Symbols, safe areas,
haptics). State "native iPhone: NOT YET VERIFIED" unless it ran on a simulator or device.
