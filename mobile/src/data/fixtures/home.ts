import type { HomeFacts } from '../home-facts';

/**
 * M1 fixture: Thursday of block week 2 of the locked 12-week program, Upper B under way.
 * Names and set counts follow programs/advanced-natural-12w/package/program.json. Invented
 * numbers only — this is not user data.
 */
export const homeFixture: HomeFacts = {
  today: '2026-10-08',
  block: {
    programName: '12-Week Advanced Natural Hypertrophy + Strength',
    start: '2026-10-01',
    weeks: 12,
  },
  week: [
    {
      date: '2026-10-05',
      workoutName: 'Upper A',
      plannedWorkSets: 23,
      recordedWorkSets: 23,
      opened: true,
      completed: true,
    },
    {
      date: '2026-10-06',
      workoutName: 'Lower A',
      plannedWorkSets: 18,
      recordedWorkSets: 18,
      opened: true,
      completed: true,
    },
    {
      date: '2026-10-08',
      workoutName: 'Upper B',
      plannedWorkSets: 21,
      recordedWorkSets: 9,
      opened: true,
      completed: false,
    },
    {
      date: '2026-10-09',
      workoutName: 'Lower B',
      plannedWorkSets: 19,
      recordedWorkSets: 0,
      opened: false,
      completed: false,
    },
  ],
  todayWorkout: {
    exerciseCount: 8,
    estimatedMinutes: { min: 80, max: 95 },
    focus: ['back', 'chest', 'shoulders', 'triceps', 'biceps'],
    nextExercise: { name: 'Flat Converging Machine Press', setNumber: 1, setCount: 2 },
  },
  nutrition: {
    intake: { protein: 112, carbs: 186, fat: 41 },
    target: { protein: 145, carbs: 310, fat: 60 },
  },
  bodyweight: [
    { date: '2026-09-25', grams: 82_900 },
    { date: '2026-09-26', grams: 83_000 },
    { date: '2026-09-27', grams: 82_800 },
    { date: '2026-09-29', grams: 82_700 },
    { date: '2026-09-30', grams: 82_900 },
    { date: '2026-10-01', grams: 82_600 },
    { date: '2026-10-02', grams: 82_700 },
    { date: '2026-10-03', grams: 82_500 },
    { date: '2026-10-04', grams: 82_600 },
    { date: '2026-10-06', grams: 82_500 },
    { date: '2026-10-07', grams: 82_300 },
    { date: '2026-10-08', grams: 82_400 },
  ],
};
