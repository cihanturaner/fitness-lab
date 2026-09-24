import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { fixedClock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase, type TestDb } from '@/data/db/test-database';
import { PROGRAM } from '@/data/program';
import { setBlockStart } from '@/data/repo/block';
import { addSet, completeWorkout, openWorkout } from '@/data/repo/workouts';
import HomeRoute from '@/app/(tabs)/index';
import { DataProvider } from '@/store/data-store';

import { buildWorkoutView } from '../workout-view';
import { WorkoutScreen } from '../workout-screen';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

const TODAY = '2026-10-08'; // Thursday, block week 2 — Upper B
const clock = fixedClock(TODAY);
const upperB = PROGRAM.workouts.find((w) => w.key === 'upper_b')!;

let db: TestDb;
beforeEach(async () => {
  jest.clearAllMocks();
  db = await openTestDatabase();
  await setBlockStart(db, PROGRAM.key, '2026-10-01', clock.now());
});

async function renderWorkout(date = TODAY, workoutId: number | null = null) {
  await render(
    <DataProvider open={async () => db as Db} clock={clock}>
      <WorkoutScreen date={date} workoutId={workoutId} />
    </DataProvider>,
  );
  await screen.findByRole('header', { name: 'Upper B' });
}

async function logSet(load: string, reps: string, rir: string) {
  if (load) await fireEvent.changeText(screen.getAllByLabelText(/load in pounds/)[0], load);
  await fireEvent.changeText(screen.getAllByLabelText(/reps, planned/)[0], reps);
  await fireEvent.changeText(screen.getAllByLabelText(/reps in reserve/)[0], rir);
  await fireEvent.press(screen.getAllByRole('button', { name: /^Log set / })[0]);
}

describe('WorkoutScreen: start and log', () => {
  it('shows the plan first and creates the draft only on Start — never a set', async () => {
    await renderWorkout();
    expect(screen.getByText('Not started')).toBeOnTheScreen();
    expect(await db.all('SELECT * FROM workout')).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout, Upper B' }));
    await screen.findByText('In progress');
    expect(await db.all('SELECT status FROM workout')).toEqual([{ status: 'draft' }]);
    expect(await db.all('SELECT * FROM performed_set')).toEqual([]);
  });

  it('logs LOAD → REPS → RIR in the next planned slot and updates progress at once', async () => {
    await openWorkout(db, TODAY, upperB, clock.now());
    await renderWorkout();
    // The open row is the next planned set: Neutral-Grip Lat Pulldown, set 1.
    expect(screen.getByLabelText('Neutral-Grip Lat Pulldown, set 1, load in pounds')).toBeOnTheScreen();
    await logSet('135', '10', '2');
    await screen.findByText('1 of 21 working sets');
    // The load carries over to the slot's next set; only reps and RIR are typed.
    await waitFor(() => expect(screen.getByLabelText('Neutral-Grip Lat Pulldown, set 2, load in pounds').props.value).toBe('135'));
    await logSet('', '9', '2');
    await screen.findByText('2 of 21 working sets');
    const rows = await db.all<{ load_g: number; reps: number; rir: number; set_type: string; slot_key: string }>(
      'SELECT load_g, reps, rir, set_type, slot_key FROM performed_set JOIN performed_set_slot ON set_id = id ORDER BY set_order',
    );
    expect(rows).toEqual([
      { load_g: 61_235, reps: 10, rir: 2, set_type: 'working', slot_key: 'upper_b.01' },
      { load_g: 61_235, reps: 9, rir: 2, set_type: 'working', slot_key: 'upper_b.01' },
    ]);
  });

  it('refuses a row without reps and never saves it', async () => {
    await openWorkout(db, TODAY, upperB, clock.now());
    await renderWorkout();
    await fireEvent.changeText(screen.getAllByLabelText(/load in pounds/)[0], '135');
    await fireEvent.press(screen.getAllByRole('button', { name: /^Log set / })[0]);
    expect(await screen.findByText('Enter the reps to log this set.')).toBeOnTheScreen();
    expect(await db.all('SELECT * FROM performed_set')).toEqual([]);
  });

  it('corrects and deletes a logged set (asking before deleting)', async () => {
    const { workout } = await openWorkout(db, TODAY, upperB, clock.now());
    await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 61_235, reps: 10, rir: 2 }, clock.now());
    await renderWorkout();
    await fireEvent.press(await screen.findByRole('button', { name: /^Set 1: 135 lb × 10 @ RIR 2\. Tap to correct/ }));
    await fireEvent.changeText(screen.getByLabelText('Neutral-Grip Lat Pulldown, set 1, reps, planned reps'), '11');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1, Neutral-Grip Lat Pulldown' }));
    await screen.findByRole('button', { name: /^Set 1: 135 lb × 11 @ RIR 2/ });
    await fireEvent.press(screen.getByRole('button', { name: /^Set 1: 135 lb × 11/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete set 1, Neutral-Grip Lat Pulldown' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('0 of 21 working sets');
    expect(await db.all('SELECT * FROM performed_set')).toEqual([]);
  });
});

describe('WorkoutScreen: finish, shortened, reopen, discard', () => {
  it('asks before completing a shortened session, then never shows it as Done', async () => {
    const { workout } = await openWorkout(db, TODAY, upperB, clock.now());
    await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 61_235, reps: 10, rir: 2 }, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: /^Finish workout/ }));
    expect(screen.getByText('1 actual working sets recorded / 21 planned. Complete anyway?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Complete anyway' }));
    expect(await screen.findByText('Shortened')).toBeOnTheScreen();
    expect(screen.getByText('Saved as a shortened session: 1 of 21 planned working sets recorded.')).toBeOnTheScreen();
    expect(screen.queryByText('Done')).toBeNull();
    // read-only now: no entry row, no Change
    expect(screen.queryByLabelText(/load in pounds/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Change exercise/ })).toBeNull();
  });

  it('cancelling the shortened question completes nothing', async () => {
    const { workout } = await openWorkout(db, TODAY, upperB, clock.now());
    await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: null, reps: 10, rir: null }, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: /^Finish workout/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(await db.all('SELECT status FROM workout')).toEqual([{ status: 'draft' }]);
  });

  it('does not complete a draft with no sets', async () => {
    await openWorkout(db, TODAY, upperB, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: /^Finish workout/ }));
    expect(screen.getByText('Log at least one set before finishing.')).toBeOnTheScreen();
    expect(await db.all('SELECT status FROM workout')).toEqual([{ status: 'draft' }]);
  });

  it('reopens a completed workout to correct it; nothing else changes', async () => {
    const { workout } = await openWorkout(db, TODAY, upperB, clock.now());
    await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 61_235, reps: 10, rir: 2 }, clock.now());
    await completeWorkout(db, workout.id, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Reopen to correct' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reopen' }));
    await screen.findByText('In progress');
    expect(await db.all('SELECT count(*) AS n FROM performed_set')).toEqual([{ n: 1 }]);
  });

  it('discards a draft only after naming what it deletes', async () => {
    const { workout } = await openWorkout(db, TODAY, upperB, clock.now());
    await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 61_235, reps: 10, rir: 2 }, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
    expect(screen.getByText(/1 recorded set \(Neutral-Grip Lat Pulldown\) will be deleted\. The plan is not changed\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await db.all('SELECT * FROM workout')).toEqual([]);
  });
});

describe('WorkoutScreen: change exercise (this workout only)', () => {
  it('offers the slot’s approved substitutes and records the change', async () => {
    await openWorkout(db, TODAY, upperB, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Change exercise for this workout: Neutral-Grip Lat Pulldown' }));
    const sheet = screen.getByText('For this workout only. The program and every other session keep Neutral-Grip Lat Pulldown.');
    expect(sheet).toBeOnTheScreen();
    for (const name of ['Fixed Pulldown', 'Assisted Pull-Up', 'Weighted Pull-Up']) {
      expect(screen.getByRole('button', { name: `${name}, From the program` })).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Fixed Pulldown, From the program' }));
    expect(await screen.findByText('Planned: Neutral-Grip Lat Pulldown · changed for this workout')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Fixed Pulldown' })).toBeOnTheScreen();
  });

  it('takes a typed exercise, normalising an all-lowercase name', async () => {
    await openWorkout(db, TODAY, upperB, clock.now());
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Change exercise for this workout: Cable Pressdown' }));
    await fireEvent.changeText(screen.getByLabelText('Another exercise, name'), 'rope   pressdown');
    expect(screen.getByText('Saved as “Rope Pressdown”')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Use Rope Pressdown' }));
    expect(await screen.findByRole('header', { name: 'Rope Pressdown' })).toBeOnTheScreen();
  });
});

describe('prescription fidelity', () => {
  it('shows every slot exactly as the program package prescribes it', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../../../programs/advanced-natural-12w/package/program.json'), 'utf8'),
    ) as { workouts: { key: string; slots: { exercise: { name: string }; sets: { reps_min: number; reps_max: number; target_rir_min: number; target_rir_max: number }[] }[] }[] };
    const r = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
    for (const workout of PROGRAM.workouts) {
      const view = buildWorkoutView({ date: TODAY, today: TODAY, block: { start: '2026-10-01', weeks: 12 }, plan: workout, session: null, last: new Map() });
      const slots = pkg.workouts.find((w) => w.key === workout.key)!.slots;
      expect(view.blocks.map((b) => b.name)).toEqual(slots.map((s) => s.exercise.name));
      view.blocks.forEach((b, i) => {
        const sets = slots[i].sets;
        expect(b.prescription).toContain(`${sets.length} set${sets.length === 1 ? '' : 's'} ×`);
        expect(b.prescription).toContain(`RIR ${sets.map((s) => r(s.target_rir_min, s.target_rir_max)).join(' · ')}`);
        expect(b.pending.map((p) => [p.repsHint, p.rirHint])).toEqual(
          sets.map((s) => [r(s.reps_min, s.reps_max), r(s.target_rir_min, s.target_rir_max)]),
        );
      });
    }
  });

  it('a future day shows the plan without Start', async () => {
    await render(
      <DataProvider open={async () => db as Db} clock={clock}>
        <WorkoutScreen date="2026-10-09" workoutId={null} />
      </DataProvider>,
    );
    await screen.findByRole('header', { name: 'Lower B' });
    expect(screen.getByText('Planned for Friday 9 October. It can be started on the day.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Start workout/ })).toBeNull();
    const card = screen.getByLabelText(/^1\. Hack Squat/);
    expect(within(card).getByText('3 sets × 8–12 reps · RIR 2 · 1 · 1')).toBeOnTheScreen();
  });
});

describe('Home ↔ logger agree', () => {
  it('a set logged in the logger shows on Home at once (same store, no reload)', async () => {
    await openWorkout(db, TODAY, upperB, clock.now());
    await render(
      <DataProvider open={async () => db as Db} clock={clock}>
        <HomeRoute />
        <WorkoutScreen date={TODAY} workoutId={null} />
      </DataProvider>,
    );
    expect(await screen.findByText('0 of 21 sets')).toBeOnTheScreen();
    await logSet('100', '8', '1');
    expect(await screen.findByText('1 of 21 sets')).toBeOnTheScreen();
    expect(screen.getByText('1 of 21 working sets')).toBeOnTheScreen();
  });
});
