import type { IsoDate } from '@/domain/dates';
import {
  completionBlockers,
  groupSets,
  type CompletionBlocker,
  type PerformedSet,
  type SetType,
  type SlotIdentity,
} from '@/domain/session';
import { typedExerciseName } from '@/domain/substitutes';

import type { Db } from '../db/database';
import { PROGRAM } from '../program';
import type { ProgramFacts, ProgramWorkout } from '../training-facts';
import { ensureExercise, exercisesById, findExercise, type Exercise } from './exercises';

/**
 * Performed workouts and their sets. Mirrors the desktop's entry rules: a workout is a
 * `draft` or `complete`; opening a planned workout returns its draft or creates one empty
 * draft whose origin never changes; every set, placement and substitution write needs a
 * draft (the schema's triggers enforce it too); a set logged in a slot records that slot.
 */

export type WorkoutStatus = 'draft' | 'complete';

export type WorkoutRecord = {
  id: number;
  performedOn: IsoDate;
  programKey: string | null;
  workoutKey: string | null;
  status: WorkoutStatus;
  notes: string | null;
  enteredAt: string;
  updatedAt: string;
};

/** A workout with its non-warm-up set count — enough for a planner or a history row. */
export type WorkoutSummary = WorkoutRecord & { workSets: number };

type WorkoutRow = {
  id: number;
  performed_on: string;
  program_key: string | null;
  workout_key: string | null;
  status: WorkoutStatus;
  notes: string | null;
  entered_at: string;
  updated_at: string;
  work_sets?: number;
};

const toRecord = (r: WorkoutRow): WorkoutRecord => ({
  id: r.id,
  performedOn: r.performed_on,
  programKey: r.program_key,
  workoutKey: r.workout_key,
  status: r.status,
  notes: r.notes,
  enteredAt: r.entered_at,
  updatedAt: r.updated_at,
});

export class DraftRequiredError extends Error {
  constructor() {
    super('This workout is complete; reopen it before correcting it.');
  }
}

export class NotFoundError extends Error {}

const WORK_SETS = `(SELECT count(*) FROM performed_set s WHERE s.workout_id = w.id
  AND (s.set_type IS NULL OR s.set_type <> 'warmup'))`;

/** Workouts performed between two dates (inclusive), oldest first. */
export async function workoutsBetween(db: Db, from: IsoDate, to: IsoDate): Promise<WorkoutSummary[]> {
  const rows = await db.all<WorkoutRow>(
    `SELECT w.*, ${WORK_SETS} AS work_sets FROM workout w
     WHERE w.performed_on BETWEEN ? AND ? ORDER BY w.performed_on, w.entered_at, w.id`,
    [from, to],
  );
  return rows.map((r) => ({ ...toRecord(r), workSets: r.work_sets ?? 0 }));
}

export async function workoutById(db: Db, id: number): Promise<WorkoutRecord | null> {
  const row = await db.first<WorkoutRow>('SELECT * FROM workout WHERE id = ?', [id]);
  return row ? toRecord(row) : null;
}

/**
 * The workout recorded for a scheduled day: its draft if one is open, else the latest
 * completed one; null when the day was never opened.
 */
export async function workoutForDay(db: Db, date: IsoDate, workoutKey: string): Promise<WorkoutRecord | null> {
  const row = await db.first<WorkoutRow>(
    `SELECT * FROM workout WHERE performed_on = ? AND workout_key = ?
     ORDER BY status = 'draft' DESC, updated_at DESC, id DESC LIMIT 1`,
    [date, workoutKey],
  );
  return row ? toRecord(row) : null;
}

export function programWorkout(program: ProgramFacts, workoutKey: string | null): ProgramWorkout | null {
  return program.workouts.find((w) => w.key === workoutKey) ?? null;
}

/**
 * Opens the planned workout for `date`: returns the day's existing workout (draft or
 * complete), or creates one empty draft with that origin. Never creates a set.
 */
export async function openWorkout(
  db: Db,
  date: IsoDate,
  workout: ProgramWorkout,
  now: string,
  program: ProgramFacts = PROGRAM,
): Promise<{ workout: WorkoutRecord; created: boolean }> {
  return db.transaction(async () => {
    const existing = await workoutForDay(db, date, workout.key);
    if (existing) return { workout: existing, created: false };
    for (const e of workout.exercises) await ensureExercise(db, e.name, now);
    const r = await db.run(
      `INSERT INTO workout (performed_on, program_key, workout_key, status, entered_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
      [date, program.key, workout.key, now, now],
    );
    const created = await workoutById(db, r.lastInsertRowId);
    return { workout: created!, created: true };
  });
}

// ── Reading one session ────────────────────────────────────────────────────────────────

export type SessionSlot = SlotIdentity & {
  plannedName: string;
  performedName: string;
  /** Changed for this workout only. */
  changed: boolean;
};

export type SessionRecord = {
  workout: WorkoutRecord;
  plan: ProgramWorkout | null;
  slots: SessionSlot[];
  sets: PerformedSet[];
  exercises: Map<number, Exercise>;
};

type SetRow = {
  id: number;
  exercise_id: number;
  set_order: number;
  set_type: SetType | null;
  load_g: number | null;
  reps: number | null;
  rir: number | null;
  placed: number;
  slot_key: string | null;
};

async function setsOf(db: Db, workoutId: number): Promise<PerformedSet[]> {
  const rows = await db.all<SetRow>(
    `SELECT s.id, s.exercise_id, s.set_order, s.set_type, s.load_g, s.reps, s.rir,
            (p.set_id IS NOT NULL) AS placed, p.slot_key
     FROM performed_set s LEFT JOIN performed_set_slot p ON p.set_id = s.id
     WHERE s.workout_id = ? ORDER BY s.set_order`,
    [workoutId],
  );
  return rows.map((r) => ({
    id: r.id,
    exerciseId: r.exercise_id,
    setOrder: r.set_order,
    setType: r.set_type,
    loadG: r.load_g,
    reps: r.reps,
    rir: r.rir,
    placement: r.placed ? r.slot_key : undefined,
  }));
}

export async function loadSession(db: Db, workoutId: number, program: ProgramFacts = PROGRAM): Promise<SessionRecord> {
  const workout = await workoutById(db, workoutId);
  if (!workout) throw new NotFoundError(`No workout ${workoutId}`);
  const plan = workout.programKey === program.key ? programWorkout(program, workout.workoutKey) : null;
  const subs = await db.all<{ slot_key: string; exercise_id: number }>(
    'SELECT slot_key, exercise_id FROM workout_slot_substitution WHERE workout_id = ?',
    [workoutId],
  );
  const subBySlot = new Map(subs.map((s) => [s.slot_key, s.exercise_id]));
  const planned = new Map<string, Exercise>();
  for (const e of plan?.exercises ?? []) {
    const found = await findExercise(db, e.name);
    if (found) planned.set(e.slotKey, found);
  }
  const sets = await setsOf(db, workoutId);
  const exercises = await exercisesById(db, [
    ...sets.map((s) => s.exerciseId),
    ...subs.map((s) => s.exercise_id),
    ...[...planned.values()].map((e) => e.id),
  ]);
  const slots = (plan?.exercises ?? []).map((e, i): SessionSlot => {
    const plannedId = planned.get(e.slotKey)?.id ?? -(i + 1);
    const performedId = subBySlot.get(e.slotKey) ?? plannedId;
    return {
      slotKey: e.slotKey,
      position: i + 1,
      plannedExerciseId: plannedId,
      performedExerciseId: performedId,
      plannedName: e.name,
      performedName: exercises.get(performedId)?.name ?? e.name,
      changed: performedId !== plannedId,
    };
  });
  return { workout, plan, slots, sets, exercises };
}

// ── Writing sets ───────────────────────────────────────────────────────────────────────

async function requireDraft(db: Db, workoutId: number): Promise<WorkoutRecord> {
  const workout = await workoutById(db, workoutId);
  if (!workout) throw new NotFoundError(`No workout ${workoutId}`);
  if (workout.status !== 'draft') throw new DraftRequiredError();
  return workout;
}

async function touch(db: Db, workoutId: number, now: string) {
  await db.run('UPDATE workout SET updated_at = ? WHERE id = ?', [now, workoutId]);
}

export type SetValues = { loadG: number | null; reps: number; rir: number | null };

/**
 * Logs a set in a planned slot (performed as the slot's exercise for this workout) or, with
 * `slotKey` null, as extra work of `exerciseId`. The lifter never picks a set type: it is
 * stored as `working`.
 */
export async function addSet(
  db: Db,
  workoutId: number,
  target: { slotKey: string } | { slotKey: null; exerciseId: number },
  values: SetValues,
  now: string,
  program: ProgramFacts = PROGRAM,
): Promise<number> {
  return db.transaction(async () => {
    await requireDraft(db, workoutId);
    let exerciseId: number;
    if (target.slotKey !== null) {
      const session = await loadSession(db, workoutId, program);
      const slot = session.slots.find((s) => s.slotKey === target.slotKey);
      if (!slot || slot.performedExerciseId < 0) throw new NotFoundError(`No slot ${target.slotKey}`);
      exerciseId = slot.performedExerciseId;
    } else {
      exerciseId = target.exerciseId;
    }
    const next = await db.first<{ n: number }>(
      'SELECT coalesce(max(set_order), 0) + 1 AS n FROM performed_set WHERE workout_id = ?',
      [workoutId],
    );
    const r = await db.run(
      `INSERT INTO performed_set (workout_id, exercise_id, set_order, set_type, load_g, reps, rir, entered_at, updated_at)
       VALUES (?, ?, ?, 'working', ?, ?, ?, ?, ?)`,
      [workoutId, exerciseId, next!.n, values.loadG, values.reps, values.rir, now, now],
    );
    await db.run('INSERT INTO performed_set_slot (set_id, workout_id, slot_key) VALUES (?, ?, ?)', [
      r.lastInsertRowId,
      workoutId,
      target.slotKey,
    ]);
    await touch(db, workoutId, now);
    return r.lastInsertRowId;
  });
}

async function workoutOfSet(db: Db, setId: number): Promise<number> {
  const row = await db.first<{ workout_id: number }>('SELECT workout_id FROM performed_set WHERE id = ?', [setId]);
  if (!row) throw new NotFoundError(`No set ${setId}`);
  return row.workout_id;
}

export async function updateSet(db: Db, setId: number, values: SetValues, now: string): Promise<void> {
  await db.transaction(async () => {
    const workoutId = await workoutOfSet(db, setId);
    await requireDraft(db, workoutId);
    await db.run('UPDATE performed_set SET load_g = ?, reps = ?, rir = ?, updated_at = ? WHERE id = ?', [
      values.loadG,
      values.reps,
      values.rir,
      now,
      setId,
    ]);
    await touch(db, workoutId, now);
  });
}

/** Renumbers a workout's sets to 1…n in their current order (two passes: set_order is unique). */
async function renumber(db: Db, workoutId: number) {
  await db.run('UPDATE performed_set SET set_order = set_order + 1000000 WHERE workout_id = ?', [workoutId]);
  const rows = await db.all<{ id: number }>('SELECT id FROM performed_set WHERE workout_id = ? ORDER BY set_order', [
    workoutId,
  ]);
  for (const [i, r] of rows.entries()) {
    await db.run('UPDATE performed_set SET set_order = ? WHERE id = ?', [i + 1, r.id]);
  }
}

export async function deleteSet(db: Db, setId: number, now: string): Promise<void> {
  await db.transaction(async () => {
    const workoutId = await workoutOfSet(db, setId);
    await requireDraft(db, workoutId);
    await db.run('DELETE FROM performed_set WHERE id = ?', [setId]);
    await renumber(db, workoutId);
    await touch(db, workoutId, now);
  });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────────────

export type CompleteResult = { ok: true } | { ok: false; blockers: CompletionBlocker[] };

/** Completes a draft unless something blocks it; sets are renumbered 1…n in the same step. */
export async function completeWorkout(db: Db, workoutId: number, now: string): Promise<CompleteResult> {
  return db.transaction(async () => {
    await requireDraft(db, workoutId);
    const blockers = completionBlockers(await setsOf(db, workoutId));
    if (blockers.length) return { ok: false, blockers };
    await renumber(db, workoutId);
    await db.run("UPDATE workout SET status = 'complete', updated_at = ? WHERE id = ?", [now, workoutId]);
    return { ok: true };
  });
}

/** Complete → draft. Nothing else changes: sets, placements and changes stay as they were. */
export async function reopenWorkout(db: Db, workoutId: number, now: string): Promise<void> {
  const r = await db.run("UPDATE workout SET status = 'draft', updated_at = ? WHERE id = ? AND status = 'complete'", [
    now,
    workoutId,
  ]);
  if (r.changes !== 1) throw new NotFoundError('Only a completed workout can be reopened.');
}

/**
 * Discards a draft with everything recorded in it (sets, placements, changes). The plan is
 * untouched. A draft that held sets is first kept as JSON in `discarded_workout`.
 */
export async function discardWorkout(
  db: Db,
  workoutId: number,
  now: string,
  program: ProgramFacts = PROGRAM,
): Promise<void> {
  await db.transaction(async () => {
    const workout = await requireDraft(db, workoutId);
    const session = await loadSession(db, workoutId, program);
    if (session.sets.length > 0) {
      const payload = {
        workout,
        sets: session.sets.map((s) => ({ ...s, exercise: session.exercises.get(s.exerciseId)?.name ?? null })),
        changes: session.slots.filter((s) => s.changed).map((s) => ({ slotKey: s.slotKey, exercise: s.performedName })),
      };
      await db.run('INSERT INTO discarded_workout (workout_id, discarded_at, payload_json) VALUES (?, ?, ?)', [
        workoutId,
        now,
        JSON.stringify(payload),
      ]);
    }
    await db.run("DELETE FROM workout WHERE id = ? AND status = 'draft'", [workoutId]);
  });
}

// ── Change exercise (this workout only) ────────────────────────────────────────────────

/**
 * Performs a slot as another exercise in this workout only (null: back to the planned
 * exercise). Sets already in the slot as the old exercise stay recorded as that exercise,
 * as extra work. The program, its slots and every other workout keep the planned exercise.
 */
export async function changeExercise(
  db: Db,
  workoutId: number,
  slotKey: string,
  exerciseName: string | null,
  now: string,
  program: ProgramFacts = PROGRAM,
): Promise<void> {
  await db.transaction(async () => {
    await requireDraft(db, workoutId);
    const session = await loadSession(db, workoutId, program);
    const slot = session.slots.find((s) => s.slotKey === slotKey);
    if (!slot) throw new NotFoundError(`No slot ${slotKey}`);
    let target: Exercise | null = null;
    if (exerciseName !== null) {
      const typed = typedExerciseName(exerciseName);
      if (!typed.ok) throw new Error(typed.error);
      target = await ensureExercise(db, typed.name, now);
    }
    const performed = target === null || target.id === slot.plannedExerciseId ? slot.plannedExerciseId : target.id;
    if (performed === slot.performedExerciseId) return;

    const { bySlot } = groupSets(session.slots, session.sets);
    for (const set of bySlot.get(slotKey) ?? []) {
      if (set.exerciseId === performed) continue;
      await db.run('DELETE FROM performed_set_slot WHERE set_id = ?', [set.id]);
      await db.run('INSERT INTO performed_set_slot (set_id, workout_id, slot_key) VALUES (?, ?, NULL)', [
        set.id,
        workoutId,
      ]);
    }
    if (performed === slot.plannedExerciseId) {
      await db.run('DELETE FROM workout_slot_substitution WHERE workout_id = ? AND slot_key = ?', [workoutId, slotKey]);
    } else {
      await db.run(
        `INSERT INTO workout_slot_substitution (workout_id, slot_key, exercise_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workout_id, slot_key) DO UPDATE SET exercise_id = excluded.exercise_id, updated_at = excluded.updated_at`,
        [workoutId, slotKey, performed, now, now],
      );
    }
    await touch(db, workoutId, now);
  });
}

// ── Previous performance ───────────────────────────────────────────────────────────────

export type LastPerformance = {
  workoutId: number;
  performedOn: IsoDate;
  workoutName: string | null;
  sets: { loadG: number | null; reps: number | null; rir: number | null; warmup: boolean }[];
};

/**
 * The most recent completed workout (other than `excludeWorkoutId`) containing this exact
 * exercise, with all its sets of it in order. Null when there is none yet.
 */
export async function lastPerformance(
  db: Db,
  exerciseId: number,
  excludeWorkoutId: number,
  program: ProgramFacts = PROGRAM,
): Promise<LastPerformance | null> {
  const w = await db.first<WorkoutRow>(
    `SELECT w.* FROM workout w
     WHERE w.status = 'complete' AND w.id <> ?
       AND EXISTS (SELECT 1 FROM performed_set s WHERE s.workout_id = w.id AND s.exercise_id = ?)
     ORDER BY w.performed_on DESC, w.performed_time_local IS NULL, w.performed_time_local DESC, w.entered_at DESC, w.id DESC
     LIMIT 1`,
    [excludeWorkoutId, exerciseId],
  );
  if (!w) return null;
  const rows = await db.all<{ load_g: number | null; reps: number | null; rir: number | null; set_type: SetType | null }>(
    'SELECT load_g, reps, rir, set_type FROM performed_set WHERE workout_id = ? AND exercise_id = ? ORDER BY set_order',
    [w.id, exerciseId],
  );
  return {
    workoutId: w.id,
    performedOn: w.performed_on,
    workoutName: programWorkout(program, w.workout_key)?.name ?? null,
    sets: rows.map((r) => ({ loadG: r.load_g, reps: r.reps, rir: r.rir, warmup: r.set_type === 'warmup' })),
  };
}
