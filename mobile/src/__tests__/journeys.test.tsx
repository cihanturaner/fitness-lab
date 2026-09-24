import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeRoute from '@/app/(tabs)/index';
import { fixedClock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase, type TestDb } from '@/data/db/test-database';
import { PROGRAM } from '@/data/program';
import { setBlockStart } from '@/data/repo/block';
import { WorkoutScreen } from '@/features/workout/workout-screen';
import { DataProvider } from '@/store/data-store';

/**
 * The V1 journeys that run end to end against a real SQLite database (sql.js) with the app's
 * own screens: J1 app opens, J2 Home → workout → set, J7 cold restart. The others are
 * covered next to their screens (nutrition, history, transfer tests).
 */

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  jest.clearAllMocks();
});

const app = (db: TestDb, today: string, ui: React.ReactElement) => (
  <DataProvider open={async () => db as Db} clock={fixedClock(today)}>
    {ui}
  </DataProvider>
);

describe('J1: the app opens to a usable Home, honestly, in every phase', () => {
  it('fresh install: no block yet — Home says how to begin and invents nothing', async () => {
    const db = await openTestDatabase();
    await render(app(db, '2026-09-24', <HomeRoute />));
    expect(await screen.findByRole('header', { name: 'Not started yet' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Set block start in Settings' })).toBeOnTheScreen();
    expect(screen.getByText('Nothing logged yet')).toBeOnTheScreen();
    expect(screen.getByText('No weigh-in yet')).toBeOnTheScreen();
    expect(screen.getByText('Block not started')).toBeOnTheScreen();
  });

  it('before the block starts: a countdown, no workout', async () => {
    const db = await openTestDatabase();
    await setBlockStart(db, PROGRAM.key, '2026-10-01', '2026-09-24T00:00:00Z');
    await render(app(db, '2026-09-24', <HomeRoute />));
    expect(await screen.findByText('Block starts in 7 days')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Rest day' })).toBeOnTheScreen();
  });

  it('a rest day inside the block names the next session', async () => {
    const db = await openTestDatabase();
    await setBlockStart(db, PROGRAM.key, '2026-10-01', '2026-09-24T00:00:00Z');
    await render(app(db, '2026-10-07', <HomeRoute />));
    expect(await screen.findByText('Next: Upper B · Thursday')).toBeOnTheScreen();
  });

  it('after the last block week: Block complete, nothing scheduled', async () => {
    const db = await openTestDatabase();
    await setBlockStart(db, PROGRAM.key, '2026-10-01', '2026-09-24T00:00:00Z');
    await render(app(db, '2026-12-28', <HomeRoute />));
    expect(await screen.findByText('Block complete')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^(Start|Continue) workout/ })).toBeNull();
  });
});

describe('J2 + J7: Home → workout → set, then a cold restart keeps it', () => {
  it('logs a set from Home’s workout and still shows it after reopening the database file', async () => {
    const db = await openTestDatabase();
    await setBlockStart(db, PROGRAM.key, '2026-10-01', '2026-10-08T06:00:00Z');
    await render(app(db, '2026-10-08', <HomeRoute />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start workout, Upper B' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[date]', params: { date: '2026-10-08' } });
    await screen.unmount();

    await render(app(db, '2026-10-08', <WorkoutScreen date="2026-10-08" workoutId={null} />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start workout, Upper B' }));
    await fireEvent.changeText(await screen.findByLabelText('Neutral-Grip Lat Pulldown, set 1, load in pounds'), '140');
    await fireEvent.changeText(screen.getByLabelText(/set 1, reps, planned/), '9');
    await fireEvent.changeText(screen.getByLabelText(/set 1, reps in reserve/), '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1, Neutral-Grip Lat Pulldown' }));
    await screen.findByText('1 of 21 working sets');
    await screen.unmount();

    // Cold restart: a new process opens the same file bytes.
    const restarted = await openTestDatabase(db.snapshot());
    await render(app(restarted, '2026-10-08', <HomeRoute />));
    expect(await screen.findByText('1 of 21 sets')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue workout, Upper B' })).toBeOnTheScreen();
    expect(screen.getByText('Neutral-Grip Lat Pulldown · set 2 of 3')).toBeOnTheScreen();
  });
});
