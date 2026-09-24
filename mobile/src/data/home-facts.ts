import type { BodyweightEntry } from '@/domain/bodyweight';
import type { IsoDate } from '@/domain/dates';
import type { MacroGrams, MacroTarget } from '@/domain/nutrition';
import type { SessionFacts } from '@/domain/training';

/**
 * The recorded facts the Home screen is drawn from. This is the persistence seam: M1 fills
 * it from fixtures; a later milestone fills the same shape from on-device storage. Nothing
 * here is derived (no calories, no averages, no statuses) — derivation is `domain/`'s job.
 */

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs';

export type ScheduledSession = SessionFacts & {
  date: IsoDate;
  workoutName: string;
};

export type TodayWorkoutDetail = {
  exerciseCount: number;
  estimatedMinutes: { min: number; max: number };
  focus: MuscleGroup[];
  /** The next planned slot without all its sets recorded, if the workout is under way. */
  nextExercise: { name: string; setNumber: number; setCount: number } | null;
};

export type HomeFacts = {
  today: IsoDate;
  block: { programName: string; start: IsoDate; weeks: number } | null;
  /** Sessions scheduled in the Monday–Sunday week containing `today`. */
  week: ScheduledSession[];
  /** Detail for the session scheduled today; null when `week` has none on `today`. */
  todayWorkout: TodayWorkoutDetail | null;
  nutrition: { intake: MacroGrams; target: MacroTarget | null };
  bodyweight: BodyweightEntry[];
};
