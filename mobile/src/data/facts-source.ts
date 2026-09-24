import type { BodyweightEntry } from '@/domain/bodyweight';
import { addDays, weekDates, type IsoDate } from '@/domain/dates';
import { targetOn } from '@/domain/nutrition';
import { scheduledWorkout, type Block } from '@/domain/schedule';
import { isWorkSet, nextPlannedSet } from '@/domain/session';

import type { Db } from './db/database';
import type { HomeFacts, ScheduledSession } from './home-facts';
import { PROGRAM } from './program';
import { PROGRAM_FOCUS } from './program-focus';
import { blockStart } from './repo/block';
import { bodyweightBetween } from './repo/bodyweight';
import { findExercise } from './repo/exercises';
import { macroTargets, nutritionDay, nutritionDaysBetween, type NutritionDay, type StoredTarget } from './repo/nutrition';
import {
  lastPerformance,
  loadSession,
  programWorkout,
  workoutById,
  workoutForDay,
  workoutsBetween,
  type LastPerformance,
  type SessionRecord,
  type WorkoutSummary,
} from './repo/workouts';
import type { ProgramFacts, ProgramWorkout, RecordedSession, TrainingFacts } from './training-facts';

/**
 * Home's and Training's facts, read from the device database. Both screens read the same
 * rows through here, so they cannot disagree. Nothing derived is stored: statuses, weeks,
 * calories and averages are derived in `domain/` from these facts.
 */

export async function loadBlock(db: Db, program: ProgramFacts = PROGRAM): Promise<Block | null> {
  const start = await blockStart(db, program.key);
  return start ? { start, weeks: program.weeks } : null;
}

const plannedWorkSets = (key: string, program: ProgramFacts) =>
  program.workouts.find((w) => w.key === key)?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0;

/** The day's recorded workout for a scheduled key: its draft if open, else the latest one. */
function recordFor(workouts: readonly WorkoutSummary[], date: IsoDate, key: string): WorkoutSummary | null {
  const same = workouts.filter((w) => w.performedOn === date && w.workoutKey === key);
  return same.find((w) => w.status === 'draft') ?? same.at(-1) ?? null;
}

export async function loadHomeFacts(db: Db, today: IsoDate, program: ProgramFacts = PROGRAM): Promise<HomeFacts> {
  const block = await loadBlock(db, program);
  const dates = weekDates(today);
  const workouts = await workoutsBetween(db, dates[0], dates[6]);

  const week: ScheduledSession[] = [];
  if (block) {
    for (const date of dates) {
      const w = scheduledWorkout(program.workouts, block, date);
      if (!w) continue;
      const rec = recordFor(workouts, date, w.key);
      week.push({
        date,
        workoutName: w.name,
        plannedWorkSets: plannedWorkSets(w.key, program),
        recordedWorkSets: rec?.workSets ?? 0,
        opened: rec !== null,
        completed: rec?.status === 'complete',
      });
    }
  }

  let todayWorkout: HomeFacts['todayWorkout'] = null;
  const planned = block ? scheduledWorkout(program.workouts, block, today) : null;
  if (planned) {
    const rec = recordFor(workouts, today, planned.key);
    let nextExercise: NonNullable<HomeFacts['todayWorkout']>['nextExercise'] = null;
    if (rec && rec.status === 'draft') {
      const session = await loadSession(db, rec.id, program);
      const next = nextPlannedSet(
        session.slots.map((s, i) => ({ ...s, plannedSets: planned.exercises[i].sets.length })),
        session.sets.filter(isWorkSet),
      );
      const slot = next && session.slots.find((s) => s.slotKey === next.slotKey);
      if (next && slot) nextExercise = { name: slot.performedName, setNumber: next.setNumber, setCount: next.setCount };
    }
    todayWorkout = {
      exerciseCount: planned.exercises.length,
      estimatedMinutes: planned.estimatedMinutes,
      focus: [...(PROGRAM_FOCUS[planned.key] ?? [])],
      nextExercise,
    };
  }

  const day = await nutritionDay(db, today);
  const target = targetOn(await macroTargets(db), today);
  return {
    today,
    block: block ? { programName: program.name, start: block.start, weeks: block.weeks } : null,
    week,
    todayWorkout,
    nutrition: {
      intake: day?.grams ?? { protein: null, carbs: null, fat: null },
      target: target ? { protein: target.protein, carbs: target.carbs, fat: target.fat } : null,
    },
    bodyweight: await bodyweightBetween(db, addDays(today, -20), today),
  };
}

export async function loadTrainingFacts(db: Db, today: IsoDate, program: ProgramFacts = PROGRAM): Promise<TrainingFacts> {
  const block = await loadBlock(db, program);
  const all = await workoutsBetween(db, '0000-01-01', '9999-12-31');
  const byDay = new Map<string, WorkoutSummary>();
  for (const w of all) {
    if (w.programKey !== program.key || !w.workoutKey) continue;
    const key = `${w.performedOn}|${w.workoutKey}`;
    const seen = byDay.get(key);
    if (!seen || seen.status !== 'draft') byDay.set(key, w);
  }
  const sessions: RecordedSession[] = [...byDay.values()].map((w) => ({
    date: w.performedOn,
    workoutKey: w.workoutKey!,
    recordedWorkSets: w.workSets,
    opened: true,
    completed: w.status === 'complete',
  }));
  return { today, block, program, sessions, focus: PROGRAM_FOCUS };
}

export type WorkoutFacts = {
  date: IsoDate;
  today: IsoDate;
  block: Block | null;
  /** The planned workout (origin) — null for an unplanned workout from an import. */
  plan: ProgramWorkout | null;
  /** The recorded workout; null when the day has not been opened. */
  session: SessionRecord | null;
  /** Previous performance per slot key (by the slot's performed exercise). */
  last: ReadonlyMap<string, LastPerformance | null>;
};

/**
 * The logger's facts: a specific recorded workout (`workoutId`, from History), or the
 * workout scheduled on `date` with whatever was recorded for it.
 */
export async function loadWorkoutFacts(
  db: Db,
  date: IsoDate,
  today: IsoDate,
  workoutId: number | null = null,
  program: ProgramFacts = PROGRAM,
): Promise<WorkoutFacts | null> {
  const block = await loadBlock(db, program);
  let session: SessionRecord | null = null;
  let plan: ProgramWorkout | null;
  if (workoutId !== null) {
    const record = await workoutById(db, workoutId);
    if (!record) return null;
    session = await loadSession(db, record.id, program);
    plan = session.plan;
    date = record.performedOn;
  } else {
    plan = block ? scheduledWorkout(program.workouts, block, date) : null;
    if (!plan) return null;
    const record = await workoutForDay(db, date, plan.key);
    session = record ? await loadSession(db, record.id, program) : null;
  }
  const last = new Map<string, LastPerformance | null>();
  if (session) {
    for (const slot of session.slots) {
      last.set(slot.slotKey, await lastPerformance(db, slot.performedExerciseId, session.workout.id, program));
    }
  } else {
    for (const e of plan?.exercises ?? []) {
      const exercise = await findExercise(db, e.name);
      last.set(e.slotKey, exercise ? await lastPerformance(db, exercise.id, -1, program) : null);
    }
  }
  return { date, today, block, plan: plan ?? programWorkout(program, null), session, last };
}

/** Weigh-ins of the last 120 days: enough for the trend windows and the recent list. */
export async function loadBodyweightEntries(db: Db, today: IsoDate) {
  return bodyweightBetween(db, addDays(today, -120), today);
}

export type NutritionFacts = {
  date: IsoDate;
  today: IsoDate;
  blockStart: IsoDate | null;
  day: NutritionDay | null;
  targets: StoredTarget[];
  /** The 7 days ending on `date`, as logged. */
  recent: NutritionDay[];
  bodyweight: BodyweightEntry[];
};

export async function loadNutritionFacts(db: Db, date: IsoDate, today: IsoDate): Promise<NutritionFacts> {
  return {
    date,
    today,
    blockStart: (await loadBlock(db))?.start ?? null,
    day: await nutritionDay(db, date),
    targets: await macroTargets(db),
    recent: await nutritionDaysBetween(db, addDays(date, -6), date),
    bodyweight: await bodyweightBetween(db, addDays(today, -20), today),
  };
}
