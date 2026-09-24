import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { fixedClock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase, type TestDb } from '@/data/db/test-database';
import { loadHistoryPage } from '@/data/history-source';
import { PROGRAM } from '@/data/program';
import { setBlockStart } from '@/data/repo/block';
import { saveBodyweight } from '@/data/repo/bodyweight';
import { addMacroTarget, saveNutritionDay } from '@/data/repo/nutrition';
import { addSet, changeExercise, completeWorkout, openWorkout } from '@/data/repo/workouts';
import { addDays } from '@/domain/dates';
import { DataProvider } from '@/store/data-store';

import { HistoryScreen } from '../history-screen';
import { historyDayView } from '../history-view';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

const TODAY = '2026-10-08';
const clock = fixedClock(TODAY);
const now = () => clock.now();
const upperA = PROGRAM.workouts.find((w) => w.key === 'upper_a')!;
const upperB = PROGRAM.workouts.find((w) => w.key === 'upper_b')!;
let db: TestDb;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await openTestDatabase();
  await setBlockStart(db, PROGRAM.key, '2026-10-01', now());
});

async function seed() {
  const mon = await openWorkout(db, '2026-10-05', upperA, now());
  await addSet(db, mon.workout.id, { slotKey: 'upper_a.01' }, { loadG: 102_058, reps: 6, rir: 2 }, now());
  await changeExercise(db, mon.workout.id, 'upper_a.02', 'Supported Machine Row', now());
  await addSet(db, mon.workout.id, { slotKey: 'upper_a.02' }, { loadG: 45_359, reps: 9, rir: 1 }, now());
  await completeWorkout(db, mon.workout.id, now());
  // today's draft is not history yet
  const thu = await openWorkout(db, TODAY, upperB, now());
  await addSet(db, thu.workout.id, { slotKey: 'upper_b.01' }, { loadG: 50_000, reps: 8, rir: 2 }, now());
  await saveBodyweight(db, '2026-10-06', 82_500, now());
  await addMacroTarget(db, { effectiveOn: '2026-10-01', protein: 145, carbs: 310, fat: 60, notes: null }, now());
  await saveNutritionDay(db, '2026-10-06', { protein: 150, carbs: null, fat: 70 }, now());
  return mon.workout.id;
}

const withStore = (ui: React.ReactElement) => (
  <DataProvider open={async () => db as Db} clock={clock}>
    {ui}
  </DataProvider>
);

describe('history source and view', () => {
  it('lists days with a completed workout, a weigh-in or a macro log, newest first — never a draft', async () => {
    await seed();
    const page = await loadHistoryPage(db);
    expect(page.days.map((d) => d.date)).toEqual(['2026-10-06', '2026-10-05']);
    expect(page.nextBefore).toBeNull();
    const training = await loadHistoryPage(db, 'training');
    expect(training.days.map((d) => d.date)).toEqual(['2026-10-05']);
  });

  it('shows a workout by slot with lb × reps @ RIR, the change, and Shortened', async () => {
    await seed();
    const page = await loadHistoryPage(db);
    const mon = historyDayView(page.days[1], page, TODAY);
    expect(mon.workouts[0]).toMatchObject({ name: 'Upper A', shortened: true, setsLabel: '2 of 23 working sets' });
    expect(mon.workouts[0].slots).toEqual([
      { key: 'upper_a.01', name: 'Smith Flat Bench Press', plannedName: null, setsText: '225 lb × 6 @ RIR 2' },
      { key: 'upper_a.02', name: 'Supported Machine Row', plannedName: 'Chest-Supported Row', setsText: '100 lb × 9 @ RIR 1' },
    ]);
    const tue = historyDayView(page.days[0], page, TODAY);
    expect(tue.bodyweightLabel).toBe('82.5 kg');
    expect(tue.nutrition).toEqual({ kcalLabel: '1,230 kcal', detail: '150P · —C · 70F · target 2,360', partial: true });
  });

  it('pages by date', async () => {
    for (let i = 0; i < 25; i++) await saveBodyweight(db, addDays('2026-09-01', i), 80_000 + i, now());
    const first = await loadHistoryPage(db, 'all', null, 21);
    expect(first.days).toHaveLength(21);
    expect(first.nextBefore).toBe(first.days[20].date);
    const second = await loadHistoryPage(db, 'all', first.nextBefore, 21);
    expect(second.days.map((d) => d.date)).toEqual(['2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01']);
    expect(second.nextBefore).toBeNull();
  });
});

describe('HistoryScreen', () => {
  it('is honest when empty', async () => {
    await render(withStore(<HistoryScreen />));
    expect(await screen.findByText('Nothing recorded yet.')).toBeOnTheScreen();
  });

  it('opens a past workout from its day, and filters by kind', async () => {
    const id = await seed();
    await render(withStore(<HistoryScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Upper A, shortened, 2 of 23 working sets. Open workout' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[date]', params: { date: '2026-10-05', id: `${id}` } });
    await fireEvent.press(screen.getByRole('tab', { name: 'Bodyweight' }));
    expect(await screen.findByText('82.5 kg')).toBeOnTheScreen();
    expect(screen.queryByText('Upper A')).toBeNull();
  });
});
