import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { homeFixture } from '@/data/fixtures/home';
import { programFixture } from '@/data/fixtures/program';
import { trainingFixture } from '@/data/fixtures/training';

type PackageSet = { set_type: string; reps_min: number; reps_max: number; target_rir_min: number; target_rir_max: number };
type PackageWorkout = {
  key: string;
  name: string;
  notes: string;
  slots: { exercise: { name: string }; notes: string; sets: PackageSet[] }[];
};

const pkg = JSON.parse(
  readFileSync(join(__dirname, '../../../../../programs/advanced-natural-12w/package/program.json'), 'utf8'),
) as { program: { duration_weeks: number }; workouts: PackageWorkout[] };

const workSets = (w: (typeof programFixture.workouts)[number]) =>
  w.exercises.reduce((n, e) => n + e.sets.length, 0);

describe('program fixture fidelity', () => {
  it('holds the locked facts: 4 days, 29 exercises, 81 work sets', () => {
    expect(programFixture.weeks).toBe(12);
    expect(
      programFixture.workouts.map((w) => [w.name, w.weekday, w.exercises.length, workSets(w)]),
    ).toEqual([
      ['Upper A', 1, 9, 23],
      ['Lower A', 2, 6, 18],
      ['Upper B', 4, 8, 21],
      ['Lower B', 5, 6, 19],
    ]);
    expect(programFixture.workouts.reduce((n, w) => n + workSets(w), 0)).toBe(81);
  });

  it('matches the program package exercise by exercise', () => {
    expect(pkg.program.duration_weeks).toBe(programFixture.weeks);
    expect(pkg.workouts.map((w) => w.key)).toEqual(programFixture.workouts.map((w) => w.key));
    pkg.workouts.forEach((pw, wi) => {
      const fw = programFixture.workouts[wi];
      expect(fw.name).toBe(pw.name);
      expect(pw.notes).toContain(`estimated ${fw.estimatedMinutes.min}–${fw.estimatedMinutes.max} min`);
      expect(fw.exercises.map((e) => e.name)).toEqual(pw.slots.map((s) => s.exercise.name));
      pw.slots.forEach((slot, si) => {
        const fe = fw.exercises[si];
        expect(fe.sets).toEqual(
          slot.sets
            .filter((s) => s.set_type === 'working')
            .map((s) => ({ reps: [s.reps_min, s.reps_max], rir: [s.target_rir_min, s.target_rir_max] })),
        );
        const rest = fe.restSeconds.min === fe.restSeconds.max ? `${fe.restSeconds.min}` : `${fe.restSeconds.min}–${fe.restSeconds.max}`;
        expect(slot.notes).toContain(`Rest: ${rest} s.`);
        expect(slot.notes).toContain(fe.failure === 'prohibited' ? 'Failure: prohibited.' : 'Failure: permitted on the final set only.');
        expect(slot.notes.includes('Marker lift')).toBe(fe.marker);
      });
    });
  });
});

describe('muscle focus is never invented', () => {
  it('states no focus in the program (the package has none)', () => {
    expect(pkg.workouts.some((w) => 'focus' in w || 'muscles' in w)).toBe(false);
    for (const w of programFixture.workouts) expect('focus' in w).toBe(false);
  });

  it('reuses only Home’s existing focus, for Upper B, and nothing else', () => {
    expect(Object.keys(trainingFixture.focus)).toEqual(['upper_b']);
    expect(trainingFixture.focus.upper_b).toBe(homeFixture.todayWorkout?.focus);
  });
});

describe('training fixture agrees with Home', () => {
  it('shares today and the block', () => {
    expect(trainingFixture.today).toBe(homeFixture.today);
    expect(trainingFixture.block).toEqual({ start: homeFixture.block?.start, weeks: homeFixture.block?.weeks });
  });

  it('plans the same set count for every session Home schedules', () => {
    for (const s of homeFixture.week) {
      const workout = programFixture.workouts.find((w) => w.name === s.workoutName);
      expect([s.workoutName, workout && workSets(workout)]).toEqual([s.workoutName, s.plannedWorkSets]);
    }
  });

  it('matches Home’s next exercise for today’s workout', () => {
    const upperB = programFixture.workouts.find((w) => w.name === 'Upper B');
    const next = homeFixture.todayWorkout?.nextExercise;
    expect(upperB?.exercises.length).toBe(homeFixture.todayWorkout?.exerciseCount);
    expect(trainingFixture.focus.upper_b).toEqual(homeFixture.todayWorkout?.focus);
    // 9 recorded sets = the first three exercises (3 + 3 + 3); the 4th is next.
    expect(upperB?.exercises[3].name).toBe(next?.name);
    expect(upperB?.exercises[3].sets.length).toBe(next?.setCount);
  });
});
