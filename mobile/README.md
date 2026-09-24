# Fitness Lab mobile

The iPhone app for Fitness Lab (Expo SDK 57, React Native 0.86, Expo Router). Standalone:
it does not use the FastAPI server. M1 = foundation, theme, navigation shell and Home on
fixture data. Rules for contributors are in `CLAUDE.md`; progress in
`../docs/tasks/mobile-m1-home.md`.

    npm install
    npx expo start           # press i for the iOS simulator (macOS + Xcode), or scan with Expo Go
    npx expo start --web     # browser preview

    npm run typecheck
    npm run lint
    npm test
