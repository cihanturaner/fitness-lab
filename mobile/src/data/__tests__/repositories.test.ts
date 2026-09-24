import { describe, expect, it } from '@jest/globals';

import { fixedClock } from '../clock';
import { openTestDatabase } from '../db/test-database';
import { migrate, NewerSchemaError, SCHEMA_VERSION } from '../db/schema';
import { loadHomeFacts, loadTrainingFacts } from '../facts-source';
import { PROGRAM } from '../program';
import { setBlockStart } from '../repo/block';
import { bodyweightBetween, saveBodyweight } from '../repo/bodyweight';
import { addMacroTarget, macroTargets, nutritionDay, saveNutritionDay } from '../repo/nutrition';
import {
  addSet,
  changeExercise,
  completeWorkout,
  deleteSet,
  discardWorkout,
  DraftRequiredError,
  lastPerformance,
  loadSession,
  openWorkout,
  reopenWorkout,
  updateSet,
} from '../repo/workouts';
import type { ProgramFacts } from '../training-facts';
import { groupSets } from '@/domain/session';

const clock = fixedClock('2026-10-08');
const now = () => clock.now();
const upperB = PROGRAM.workouts.find((w) => w.key === 'upper_b')!;

/** A program whose one workout plans the same exercise in two slots (as V3.3.1 allows). */
const DUP: ProgramFacts = {
  key: 'dup-test',
  name: 'Duplicate slots',
  versionLabel: '1',
  weeks: 12,
  workouts: [
    {
      key: 'd',
      name: 'Dup Day',
      weekday: 4,
      estimatedMinutes: { min: 30, max: 40 },
      exercises: [
        { slotKey: 'd.01', name: 'Cable Lateral Raise', marker: false, failure: 'final-set', restSeconds: { min: 90, max: 90 }, sets: [{ reps: [12, 20], rir: [1, 1] }, { reps: [12, 20], rir: [1, 1] }], notes: 'Approved substitutes: Machine Lateral Raise.' },
        { slotKey: 'd.02', name: 'Cable Lateral Raise', marker: false, failure: 'final-set', restSeconds: { min: 90, max: 90 }, sets: [{ reps: [12, 20], rir: [0, 1] }], notes: '' },
      ],
    },
  ],
};

describe('schema migrations', () => {
  it('creates schema version 1 once and is idempotent', async () => {
    const db = await openTestDatabase();
    expect(SCHEMA_VERSION).toBe(1);
    expect(await migrate(db)).toBe(1);
    const rows = await db.all<{ version: number; name: string }>('SELECT version, name FROM schema_migrations');
    expect(rows).toEqual([{ version: 1, name: 'initial' }]);
  });

  it('holds exactly the V1 tables, with foreign keys enforced', async () => {
    const db = await openTestDatabase();
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual([
      'bodyweight_entry',
      'discarded_workout',
      'exercise',
      'import_log',
      'imported_record',
      'macro_target',
      'maintenance',
      'nutrition_day',
      'performed_set',
      'performed_set_slot',
      'replaced_data',
      'schema_migrations',
      'training_block',
      'workout',
      'workout_slot_substitution',
    ]);
    expect(await db.first('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    await expect(db.run("INSERT INTO workout_slot_substitution VALUES (999, 'x', 1, 'a', 'a')")).rejects.toThrow(/FOREIGN KEY/);
  });

  it('refuses a database written by a newer build instead of guessing', async () => {
    const db = await openTestDatabase();
    await db.run("INSERT INTO schema_migrations VALUES (2, 'future', 'x')");
    await expect(migrate(db)).rejects.toBeInstanceOf(NewerSchemaError);
  });

  it('keeps everything across a cold restart (file bytes reopened)', async () => {
    const db = await openTestDatabase();
    await setBlockStart(db, PROGRAM.key, '2026-10-01', now());
    const { workout } = await openWorkout(db, '2026-10-08', upperB, now());
    await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 45_359, reps: 8, rir: 2 }, now());
    await saveBodyweight(db, '2026-10-08', 82_400, now());
    await saveNutritionDay(db, '2026-10-08', { protein: 112, carbs: 186, fat: 41 }, now());

    const restarted = await openTestDatabase(db.snapshot());
    const session = await loadSession(restarted, workout.id);
    expect(session.sets.map((s) => [s.loadG, s.reps, s.rir, s.placement])).toEqual([[45_359, 8, 2, 'upper_b.01']]);
    expect(await bodyweightBetween(restarted, '2026-10-01', '2026-10-31')).toEqual([{ date: '2026-10-08', grams: 82_400 }]);
    expect((await nutritionDay(restarted, '2026-10-08'))?.grams).toEqual({ protein: 112, carbs: 186, fat: 41 });
    expect((await loadHomeFacts(restarted, '2026-10-08')).week.find((s) => s.date === '2026-10-08')).toMatchObject({
      recordedWorkSets: 1,
      opened: true,
      completed: false,
    });
  });
});

describe('workout lifecycle', () => {
  it('opening a planned workout creates one empty draft, and opening again returns it', async () => {
    const db = await openTestDatabase();
    const first = await openWorkout(db, '2026-10-08', upperB, now());
    const again = await openWorkout(db, '2026-10-08', upperB, now());
    expect(first.created).toBe(true);
    expect(again).toEqual({ workout: first.workout, created: false });
    expect(first.workout.status).toBe('draft');
    expect((await loadSession(db, first.workout.id)).sets).toEqual([]);
  });

  it('a double tap on Start creates one draft, and concurrent writes never interleave', async () => {
    const db = await openTestDatabase();
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const first = openWorkout(db, '2026-10-08', upperB, now());
    await tick(); // the second tap lands while the first is mid-write
    const [a, b] = await Promise.all([first, openWorkout(db, '2026-10-08', upperB, now())]);
    expect(a.workout.id).toBe(b.workout.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await db.all('SELECT id FROM workout')).toHaveLength(1);
    const one = addSet(db, a.workout.id, { slotKey: 'upper_b.01' }, { loadG: 1_000, reps: 5, rir: 2 }, now());
    await tick();
    await Promise.all([one, addSet(db, a.workout.id, { slotKey: 'upper_b.01' }, { loadG: 1_000, reps: 6, rir: 2 }, now())]);
    expect(await db.all('SELECT set_order, reps FROM performed_set ORDER BY set_order')).toEqual([
      { set_order: 1, reps: 5 },
      { set_order: 2, reps: 6 },
    ]);
  });

  it('a write that overlaps a failing transaction is queued, not rolled back with it', async () => {
    const db = await openTestDatabase();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const failing = db.transaction(async () => {
      await db.run('INSERT INTO bodyweight_entry VALUES (?, ?, NULL, ?, ?)', ['2026-10-01', 80_000, now(), now()]);
      await gate;
      throw new Error('import failed');
    });
    await new Promise((r) => setTimeout(r, 0)); // the transaction is open now
    const overlapping = saveBodyweight(db, '2026-10-08', 82_400, now());
    await new Promise((r) => setTimeout(r, 0));
    release();
    await expect(failing).rejects.toThrow('import failed');
    await overlapping;
    expect(await bodyweightBetween(db, '2026-10-01', '2026-10-31')).toEqual([{ date: '2026-10-08', grams: 82_400 }]);
  });

  it('logs sets in their slots, updates and deletes them, renumbering densely', async () => {
    const db = await openTestDatabase();
    const { workout } = await openWorkout(db, '2026-10-08', upperB, now());
    const a = await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 50_000, reps: 8, rir: 2 }, now());
    const b = await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 50_000, reps: 7, rir: 2 }, now());
    const c = await addSet(db, workout.id, { slotKey: 'upper_b.02' }, { loadG: 40_000, reps: 9, rir: null }, now());
    await updateSet(db, b, { loadG: 52_000, reps: 7, rir: 1 }, now());
    await deleteSet(db, a, now());
    const { sets } = await loadSession(db, workout.id);
    expect(sets.map((s) => [s.id, s.setOrder, s.loadG, s.rir, s.setType])).toEqual([
      [b, 1, 52_000, 1, 'working'],
      [c, 2, 40_000, null, 'working'],
    ]);
  });

  it('completes, then refuses every write until reopened (app check and schema trigger)', async () => {
    const db = await openTestDatabase();
    const { workout } = await openWorkout(db, '2026-10-08', upperB, now());
    expect(await completeWorkout(db, workout.id, now())).toEqual({ ok: false, blockers: ['no-sets'] });
    const s = await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: null, reps: 8, rir: null }, now());
    expect(await completeWorkout(db, workout.id, now())).toEqual({ ok: true });

    await expect(addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 1, reps: 1, rir: 1 }, now())).rejects.toBeInstanceOf(DraftRequiredError);
    await expect(updateSet(db, s, { loadG: 1, reps: 1, rir: 1 }, now())).rejects.toBeInstanceOf(DraftRequiredError);
    await expect(deleteSet(db, s, now())).rejects.toBeInstanceOf(DraftRequiredError);
    await expect(changeExercise(db, workout.id, 'upper_b.01', 'Fixed Pulldown', now())).rejects.toBeInstanceOf(DraftRequiredError);
    await expect(discardWorkout(db, workout.id, now())).rejects.toBeInstanceOf(DraftRequiredError);
    await expect(db.run('UPDATE performed_set SET reps = 1 WHERE id = ?', [s])).rejects.toThrow(/reopen it/);
    await expect(db.run('DELETE FROM performed_set WHERE id = ?', [s])).rejects.toThrow(/reopen it/);

    await reopenWorkout(db, workout.id, now());
    const reopened = await loadSession(db, workout.id);
    expect(reopened.workout.status).toBe('draft');
    expect(reopened.sets).toHaveLength(1); // nothing but the status changed
    await updateSet(db, s, { loadG: 10_000, reps: 9, rir: 1 }, now());
  });

  it('discards a draft with its sets, keeping a JSON copy; the plan and other days are untouched', async () => {
    const db = await openTestDatabase();
    const { workout } = await openWorkout(db, '2026-10-08', upperB, now());
    await addSet(db, workout.id, { slotKey: 'upper_b.03' }, { loadG: 30_000, reps: 10, rir: 1 }, now());
    await changeExercise(db, workout.id, 'upper_b.04', 'Stable Chest Press', now());
    await discardWorkout(db, workout.id, now());
    expect(await db.all('SELECT * FROM workout')).toEqual([]);
    expect(await db.all('SELECT * FROM performed_set')).toEqual([]);
    expect(await db.all('SELECT * FROM workout_slot_substitution')).toEqual([]);
    const kept = await db.all<{ payload_json: string }>('SELECT payload_json FROM discarded_workout');
    expect(JSON.parse(kept[0].payload_json).sets[0]).toMatchObject({ exercise: 'Chest-Supported Upper-Back Row', reps: 10 });
    // an empty draft leaves no copy
    const empty = await openWorkout(db, '2026-10-08', upperB, now());
    await discardWorkout(db, empty.workout.id, now());
    expect(await db.all('SELECT * FROM discarded_workout')).toHaveLength(1);
  });
});

describe('slot identity: duplicate exercises stay independent', () => {
  it('keeps each slot’s sets apart although both slots are the same exercise', async () => {
    const db = await openTestDatabase();
    const dup = DUP.workouts[0];
    const { workout } = await openWorkout(db, '2026-10-08', dup, now(), DUP);
    await addSet(db, workout.id, { slotKey: 'd.02' }, { loadG: 9_000, reps: 15, rir: 0 }, now(), DUP);
    await addSet(db, workout.id, { slotKey: 'd.01' }, { loadG: 11_000, reps: 14, rir: 1 }, now(), DUP);
    const session = await loadSession(db, workout.id, DUP);
    expect(session.slots[0].performedExerciseId).toBe(session.slots[1].performedExerciseId);
    const grouped = groupSets(session.slots, session.sets);
    expect(grouped.bySlot.get('d.01')?.map((s) => s.loadG)).toEqual([11_000]);
    expect(grouped.bySlot.get('d.02')?.map((s) => s.loadG)).toEqual([9_000]);
    expect(grouped.extra).toEqual([]);
  });

  it('changing one slot turns its old sets into extra work and leaves the twin slot alone', async () => {
    const db = await openTestDatabase();
    const dup = DUP.workouts[0];
    const { workout } = await openWorkout(db, '2026-10-08', dup, now(), DUP);
    await addSet(db, workout.id, { slotKey: 'd.01' }, { loadG: 11_000, reps: 14, rir: 1 }, now(), DUP);
    await addSet(db, workout.id, { slotKey: 'd.02' }, { loadG: 9_000, reps: 15, rir: 0 }, now(), DUP);
    await changeExercise(db, workout.id, 'd.01', 'machine lateral raise', now(), DUP);
    let session = await loadSession(db, workout.id, DUP);
    expect(session.slots.map((s) => [s.performedName, s.changed])).toEqual([
      ['Machine Lateral Raise', true],
      ['Cable Lateral Raise', false],
    ]);
    let grouped = groupSets(session.slots, session.sets);
    expect(grouped.bySlot.get('d.01')).toEqual([]);
    expect(grouped.bySlot.get('d.02')?.map((s) => s.loadG)).toEqual([9_000]);
    expect(grouped.extra.map((g) => g.sets.map((s) => s.loadG))).toEqual([[11_000]]);

    // a set logged now in d.01 is the substitute; back to planned removes the change row
    await addSet(db, workout.id, { slotKey: 'd.01' }, { loadG: 20_000, reps: 12, rir: 1 }, now(), DUP);
    await changeExercise(db, workout.id, 'd.01', null, now(), DUP);
    session = await loadSession(db, workout.id, DUP);
    grouped = groupSets(session.slots, session.sets);
    expect(await db.all('SELECT * FROM workout_slot_substitution')).toEqual([]);
    expect(session.slots[0].changed).toBe(false);
    expect(grouped.extra.map((g) => g.sets.map((s) => s.loadG))).toEqual([[11_000], [20_000]]);
  });

  it('a set with no recorded placement is left alone by a change (as on the desktop)', async () => {
    const db = await openTestDatabase();
    const { workout } = await openWorkout(db, '2026-10-08', upperB, now());
    const setId = await addSet(db, workout.id, { slotKey: 'upper_b.05' }, { loadG: 9_000, reps: 15, rir: 1 }, now());
    await db.run('DELETE FROM performed_set_slot WHERE set_id = ?', [setId]); // as imported from before 0008
    await changeExercise(db, workout.id, 'upper_b.05', 'Machine Lateral Raise', now());
    expect(await db.all('SELECT * FROM performed_set_slot WHERE set_id = ?', [setId])).toEqual([]);
  });

  it('the change is for this workout only: the next occurrence opens on the planned exercise', async () => {
    const db = await openTestDatabase();
    const a = await openWorkout(db, '2026-10-08', upperB, now());
    await changeExercise(db, a.workout.id, 'upper_b.01', 'Fixed Pulldown', now());
    const b = await openWorkout(db, '2026-10-15', upperB, now());
    expect((await loadSession(db, b.workout.id)).slots[0].performedName).toBe('Neutral-Grip Lat Pulldown');
    expect(PROGRAM.workouts.find((w) => w.key === 'upper_b')?.exercises[0].name).toBe('Neutral-Grip Lat Pulldown');
  });
});

describe('previous performance', () => {
  it('is the latest completed workout with that exact exercise, all its sets in order', async () => {
    const db = await openTestDatabase();
    const upperA = PROGRAM.workouts.find((w) => w.key === 'upper_a')!;
    const mon = await openWorkout(db, '2026-10-05', upperA, now());
    await addSet(db, mon.workout.id, { slotKey: 'upper_a.03' }, { loadG: 60_000, reps: 10, rir: 2 }, now());
    await addSet(db, mon.workout.id, { slotKey: 'upper_a.03' }, { loadG: 60_000, reps: 9, rir: 1 }, now());
    await completeWorkout(db, mon.workout.id, now());
    const thu = await openWorkout(db, '2026-10-08', upperB, now());
    const session = await loadSession(db, thu.workout.id);
    const last = await lastPerformance(db, session.slots[0].performedExerciseId, thu.workout.id);
    expect(last).toMatchObject({ performedOn: '2026-10-05', workoutName: 'Upper A' });
    expect(last?.sets.map((s) => s.reps)).toEqual([10, 9]);
    expect(await lastPerformance(db, session.slots[1].performedExerciseId, thu.workout.id)).toBeNull();
  });
});

describe('nutrition, targets and bodyweight', () => {
  it('stores one macro log per day; clearing every macro removes the day', async () => {
    const db = await openTestDatabase();
    await saveNutritionDay(db, '2026-10-08', { protein: 100, carbs: null, fat: 40 }, now());
    await saveNutritionDay(db, '2026-10-08', { protein: 112, carbs: 186, fat: 41 }, now());
    expect((await nutritionDay(db, '2026-10-08'))?.grams).toEqual({ protein: 112, carbs: 186, fat: 41 });
    await saveNutritionDay(db, '2026-10-08', { protein: null, carbs: null, fat: null }, now());
    expect(await nutritionDay(db, '2026-10-08')).toBeNull();
  });

  it('keeps targets append-only', async () => {
    const db = await openTestDatabase();
    const id = await addMacroTarget(db, { effectiveOn: '2026-10-01', protein: 145, carbs: 300, fat: 60, notes: null }, now());
    await addMacroTarget(db, { effectiveOn: '2026-10-08', protein: 145, carbs: 338, fat: 60, notes: null }, now());
    await expect(db.run('UPDATE macro_target SET carbs_g = 1 WHERE id = ?', [id])).rejects.toThrow(/append-only/);
    await expect(db.run('DELETE FROM macro_target WHERE id = ?', [id])).rejects.toThrow(/append-only/);
    expect((await macroTargets(db)).map((t) => t.carbs)).toEqual([300, 338]);
    const home = await loadHomeFacts(db, '2026-10-07');
    expect(home.nutrition.target).toEqual({ protein: 145, carbs: 300, fat: 60 });
  });

  it('refuses a bodyweight outside 20–300 kg and replaces a day’s entry', async () => {
    const db = await openTestDatabase();
    await expect(saveBodyweight(db, '2026-10-08', 19_999, now())).rejects.toThrow();
    await saveBodyweight(db, '2026-10-08', 82_400, now());
    await saveBodyweight(db, '2026-10-08', 82_300, now());
    expect(await bodyweightBetween(db, '2026-10-08', '2026-10-08')).toEqual([{ date: '2026-10-08', grams: 82_300 }]);
  });
});

describe('Home and Training read the same facts', () => {
  it('agree on a session’s status and counts, and reflect a write immediately', async () => {
    const db = await openTestDatabase();
    await setBlockStart(db, PROGRAM.key, '2026-10-01', now());
    const { workout } = await openWorkout(db, '2026-10-08', upperB, now());
    for (let i = 0; i < 3; i++) await addSet(db, workout.id, { slotKey: 'upper_b.01' }, { loadG: 50_000, reps: 8, rir: 2 }, now());
    await addSet(db, workout.id, { slotKey: 'upper_b.02' }, { loadG: 50_000, reps: 8, rir: 2 }, now());
    const home = await loadHomeFacts(db, '2026-10-08');
    const training = await loadTrainingFacts(db, '2026-10-08');
    expect(home.week.find((s) => s.date === '2026-10-08')).toMatchObject({ plannedWorkSets: 21, recordedWorkSets: 4, opened: true, completed: false });
    expect(training.sessions).toEqual([{ date: '2026-10-08', workoutKey: 'upper_b', recordedWorkSets: 4, opened: true, completed: false }]);
    expect(home.todayWorkout?.nextExercise).toEqual({ name: 'Incline Smith Press', setNumber: 2, setCount: 3 });
  });

  it('has honest empty facts before anything is recorded (no block, no nutrition, no weigh-in)', async () => {
    const db = await openTestDatabase();
    const home = await loadHomeFacts(db, '2026-10-08');
    expect(home).toMatchObject({ block: null, week: [], todayWorkout: null, bodyweight: [] });
    expect(home.nutrition).toEqual({ intake: { protein: null, carbs: null, fat: null }, target: null });
  });
});
