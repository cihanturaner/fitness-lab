import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import HomeRoute from '@/app/(tabs)/index';
import { fixedClock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase, type TestDb } from '@/data/db/test-database';
import { PROGRAM } from '@/data/program';
import { setBlockStart } from '@/data/repo/block';
import { saveBodyweight } from '@/data/repo/bodyweight';
import { addMacroTarget, macroTargets, nutritionDay } from '@/data/repo/nutrition';
import { BodyweightScreen } from '@/features/bodyweight/bodyweight-screen';
import { buildBodyweightView, kg2, kgExact } from '@/features/bodyweight/bodyweight-view';
import { QuickAddSheet } from '@/features/shell/quick-add-sheet';
import { DataProvider } from '@/store/data-store';

import { NutritionScreen } from '../nutrition-screen';
import { buildNutritionView, calorieEquation } from '../nutrition-view';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

const TODAY = '2026-10-08';
const clock = fixedClock(TODAY);
let db: TestDb;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await openTestDatabase();
});

const withStore = (ui: React.ReactElement) => (
  <DataProvider open={async () => db as Db} clock={clock}>
    {ui}
  </DataProvider>
);

describe('nutrition view', () => {
  const base = { date: TODAY, today: TODAY, blockStart: null, recent: [], bodyweight: [] };

  it('derives calories from macros and judges the day by the target in force on it', () => {
    const view = buildNutritionView({
      ...base,
      day: { date: TODAY, grams: { protein: 112, carbs: 186, fat: 41 }, updatedAt: 'x' },
      targets: [{ id: 1, effectiveOn: '2026-10-01', setAt: 'a', protein: 145, carbs: 310, fat: 60, notes: null }],
    });
    expect(view.gauge).toEqual({ eatenLabel: '1,561', fraction: 1561 / 2360, targetLabel: '2,360', leftLabel: '799', over: false });
    expect(view.macros.map((m) => [m.eatenLabel, m.targetLabel, m.leftLabel])).toEqual([
      ['112', '145 g', '33 g left'],
      ['186', '310 g', '124 g left'],
      ['41', '60 g', '19 g left'],
    ]);
    expect(calorieEquation({ protein: 112, carbs: 186, fat: 41 })).toBe('112 × 4 + 186 × 4 + 41 × 9 = 1,561 kcal');
  });

  it('marks a partial day and never invents a target', () => {
    const view = buildNutritionView({ ...base, day: { date: TODAY, grams: { protein: 100, carbs: null, fat: null }, updatedAt: 'x' }, targets: [] });
    expect(view.partialNote).toMatch(/Not every macro is recorded/);
    expect(view.target).toBeNull();
    expect(view.gauge.targetLabel).toBeNull();
    // the first target offers the source's protein and fat only; carbs stay blank
    expect(view.targetDefaults).toEqual({ protein: '145', carbs: '', fat: '60' });
  });

  it('asks for an exception only when changing an established target in the early weeks', () => {
    const established = [{ id: 1, effectiveOn: '2026-10-01', setAt: 'a', protein: 145, carbs: 310, fat: 60, notes: null }];
    const early = { ...base, day: null, blockStart: '2026-10-01' };
    expect(buildNutritionView({ ...early, targets: established }).targetChangeNeedsException).toBe(true);
    expect(buildNutritionView({ ...early, targets: [] }).targetChangeNeedsException).toBe(false);
    const setToday = [{ ...established[0], effectiveOn: TODAY }];
    expect(buildNutritionView({ ...early, targets: setToday }).targetChangeNeedsException).toBe(false);
    // week 4: routine changes no longer need an exception
    expect(buildNutritionView({ ...early, today: '2026-10-19', date: '2026-10-19', targets: established }).targetChangeNeedsException).toBe(false);
  });
});

describe('bodyweight view', () => {
  it('shows exact kilograms, a 0.01 kg average with its n/7, and no change without 4 + 4 weigh-ins', () => {
    expect(kgExact(82_450)).toBe('82.45');
    expect(kgExact(82_000)).toBe('82');
    expect(kg2(-330)).toBe('−0.33');
    const view = buildBodyweightView([{ date: TODAY, grams: 82_400 }, { date: '2026-10-06', grams: 82_500 }], TODAY);
    expect(view).toMatchObject({ averageLabel: '82.45', averageCaption: '2 of 7 days', latestLabel: '82.4', latestWhen: 'Today', changeLabel: null });
    expect(buildBodyweightView([], TODAY)).toMatchObject({ averageLabel: null, latestLabel: null, recent: [] });
  });
});

describe('NutritionScreen', () => {
  it('saves the day’s macros as grams only — calories are derived, never stored', async () => {
    await render(withStore(<NutritionScreen />));
    await fireEvent.changeText(await screen.findByLabelText('Protein in grams, Today'), '112');
    await fireEvent.changeText(screen.getByLabelText('Carbs in grams, Today'), '186');
    await fireEvent.changeText(screen.getByLabelText('Fat in grams, Today'), '41');
    expect(screen.getByText('112 × 4 + 186 × 4 + 41 × 9 = 1,561 kcal')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save macros, Today' }));
    await waitFor(async () => expect((await nutritionDay(db, TODAY))?.grams).toEqual({ protein: 112, carbs: 186, fat: 41 }));
    const columns = await db.all<{ name: string }>("SELECT name FROM pragma_table_info('nutrition_day')");
    expect(columns.map((c) => c.name).some((n) => /cal/i.test(n))).toBe(false);
  });

  it('refuses a fractional macro', async () => {
    await render(withStore(<NutritionScreen />));
    await fireEvent.changeText(await screen.findByLabelText('Protein in grams, Today'), '112.5');
    await fireEvent.press(screen.getByRole('button', { name: 'Save macros, Today' }));
    expect(await screen.findByText('Macros are whole grams, 0–1500.')).toBeOnTheScreen();
    expect(await nutritionDay(db, TODAY)).toBeNull();
  });

  it('sets the first target from today, offering P 145 / F 60 and a blank carbs', async () => {
    await render(withStore(<NutritionScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'No daily target yet. Set a target' }));
    expect(screen.getByLabelText('Target protein in grams').props.value).toBe('145');
    expect(screen.getByLabelText('Target carbs in grams').props.value).toBe('');
    expect(screen.getByLabelText('Target fat in grams').props.value).toBe('60');
    await fireEvent.changeText(screen.getByLabelText('Target carbs in grams'), '310');
    expect(screen.getByText('2,360 kcal a day')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(async () => expect(await macroTargets(db)).toHaveLength(1));
    expect((await macroTargets(db))[0]).toMatchObject({ effectiveOn: TODAY, protein: 145, carbs: 310, fat: 60, notes: null });
  });

  it('requires one of the source’s exceptions to change an established target in weeks 1–2', async () => {
    await setBlockStart(db, PROGRAM.key, '2026-10-01', clock.now());
    await addMacroTarget(db, { effectiveOn: '2026-10-01', protein: 145, carbs: 310, fat: 60, notes: null }, clock.now());
    await render(withStore(<NutritionScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Daily target: .*Change target/ }));
    await fireEvent.changeText(screen.getByLabelText('Target carbs in grams'), '348');
    await fireEvent.press(screen.getByRole('button', { name: 'Save target' }));
    expect(await screen.findByText('Weeks 1–2 allow no routine change: choose the exception that applies.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'illness' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(async () => expect(await macroTargets(db)).toHaveLength(2));
    expect((await macroTargets(db))[1]).toMatchObject({ carbs: 348, notes: 'Weeks 1–2 exception: illness' });
  });
});

describe('Quick Add and Home', () => {
  it('records today’s weigh-in from Quick Add and Home shows it at once', async () => {
    await render(
      withStore(
        <>
          <HomeRoute />
          <QuickAddSheet />
        </>,
      ),
    );
    await fireEvent.press(await screen.findByRole('button', { name: /^Bodyweight: Today's weigh-in/ }));
    await fireEvent.changeText(screen.getByLabelText('Bodyweight in kilograms, today'), '82,4');
    await fireEvent.press(screen.getByRole('button', { name: 'Save today’s weigh-in' }));
    expect(await screen.findByText('Saved 82.4 kg for today.')).toBeOnTheScreen();
    expect(await screen.findByText('82.4')).toBeOnTheScreen(); // Home's bodyweight card
    expect(await db.all('SELECT measured_on, bodyweight_g FROM bodyweight_entry')).toEqual([{ measured_on: TODAY, bodyweight_g: 82_400 }]);
  });

  it('records today’s macros from Quick Add and Home’s calories follow', async () => {
    await render(
      withStore(
        <>
          <HomeRoute />
          <QuickAddSheet />
        </>,
      ),
    );
    await fireEvent.press(await screen.findByRole('button', { name: /^Macros:/ }));
    await fireEvent.changeText(screen.getByLabelText('Protein in grams, Today'), '100');
    await fireEvent.changeText(screen.getByLabelText('Carbs in grams, Today'), '200');
    await fireEvent.changeText(screen.getByLabelText('Fat in grams, Today'), '50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save macros, Today' }));
    expect(await screen.findByText('1,650')).toBeOnTheScreen(); // 100×4 + 200×4 + 50×9
  });
});

describe('BodyweightScreen', () => {
  it('replaces a day’s entry rather than adding a second one, and refuses out-of-range values', async () => {
    await saveBodyweight(db, TODAY, 82_400, clock.now());
    await render(withStore(<BodyweightScreen />));
    const field = await screen.findByLabelText('Bodyweight in kilograms, today');
    expect(field.props.value).toBe('82.4');
    await fireEvent.changeText(field, '19');
    await fireEvent.press(screen.getByRole('button', { name: 'Replace weigh-in' }));
    expect(await screen.findByText(/between 20 and 300/)).toBeOnTheScreen();
    await fireEvent.changeText(field, '82.25');
    await fireEvent.press(screen.getByRole('button', { name: 'Replace weigh-in' }));
    await waitFor(async () => expect(await db.all('SELECT bodyweight_g FROM bodyweight_entry')).toEqual([{ bodyweight_g: 82_250 }]));
  });
});
