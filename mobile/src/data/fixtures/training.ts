import type { RecordedSession, TrainingFacts } from '../training-facts';
import { homeFixture } from './home';
import { programFixture } from './program';

function workoutKey(name: string): string {
  const workout = programFixture.workouts.find((w) => w.name === name);
  if (!workout) throw new Error(`No program workout named ${name}`);
  return workout.key;
}

/**
 * M2 fixture: the same moment as M1 Home — Thursday 8 October, block week 2, Upper B under
 * way. The current week's records are read from the Home fixture itself, so Home and
 * Training cannot disagree. Week 1 adds two earlier sessions (the block started on its
 * Thursday, so Monday and Tuesday of week 1 were before the block). Invented numbers only.
 */
const week1: RecordedSession[] = [
  { date: '2026-10-01', workoutKey: 'upper_b', recordedWorkSets: 21, opened: true, completed: true },
  { date: '2026-10-02', workoutKey: 'lower_b', recordedWorkSets: 16, opened: true, completed: true },
];

const week2: RecordedSession[] = homeFixture.week
  .filter((s) => s.opened)
  .map((s) => ({
    date: s.date,
    workoutKey: workoutKey(s.workoutName),
    recordedWorkSets: s.recordedWorkSets,
    opened: s.opened,
    completed: s.completed,
  }));

export const trainingFixture: TrainingFacts = {
  today: homeFixture.today,
  block: homeFixture.block ? { start: homeFixture.block.start, weeks: homeFixture.block.weeks } : null,
  program: programFixture,
  sessions: [...week1, ...week2],
};
