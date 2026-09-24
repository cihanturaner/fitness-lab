import type { IsoDate } from '@/domain/dates';

import type { MuscleGroup } from './home-facts';

/**
 * The planned side of training: the active program's weekly template, as imported. Planned
 * is not performed — nothing here says what was lifted. Every prescription is copied from
 * the program package (programs/<name>/package/program.json); fields the source does not
 * state are absent rather than guessed.
 */

/** One planned work set: a rep range and a reps-in-reserve target, both inclusive. */
export type PlannedSet = {
  reps: readonly [min: number, max: number];
  rir: readonly [min: number, max: number];
};

export type PlannedExercise = {
  /** The slot's identity in the program ("upper_b.04"): what a performed set is placed in. */
  slotKey: string;
  name: string;
  /** A week-12 benchmark lift. */
  marker: boolean;
  failure: 'prohibited' | 'final-set';
  restSeconds: { min: number; max: number };
  sets: readonly PlannedSet[];
  /** The slot's notes, verbatim from the package (rest, failure, approved substitutes). */
  notes: string;
};

export type ProgramWorkout = {
  key: string;
  name: string;
  /** ISO weekday the weekly template places it on: Monday = 1 … Sunday = 7. */
  weekday: number;
  estimatedMinutes: { min: number; max: number };
  exercises: readonly PlannedExercise[];
};

export type ProgramFacts = {
  key: string;
  name: string;
  versionLabel: string;
  weeks: number;
  workouts: readonly ProgramWorkout[];
};

/** What the lifter recorded against one scheduled day. Absent = never opened. */
export type RecordedSession = {
  date: IsoDate;
  workoutKey: string;
  recordedWorkSets: number;
  opened: boolean;
  completed: boolean;
};

/**
 * The recorded facts the Training screen is drawn from — the persistence seam, like
 * `HomeFacts`. Planned set counts come only from `program`; statuses, weeks and
 * schedules are derived in `domain/`.
 */
export type TrainingFacts = {
  today: IsoDate;
  block: { start: IsoDate; weeks: number } | null;
  program: ProgramFacts;
  sessions: readonly RecordedSession[];
  /**
   * Muscle focus by workout key, only where an existing source states one. A workout
   * without an entry has no focus; it is never inferred from exercise names.
   */
  focus: Readonly<Record<string, readonly MuscleGroup[]>>;
};
