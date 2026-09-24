import { describe, expect, it } from '@jest/globals';

import {
  blockWeekDates,
  blockWeekMonday,
  clampBlockWeek,
  currentBlockWeek,
  isInBlock,
  scheduledWorkout,
} from '../schedule';
import { dayStatus } from '../training';

// The M1/M2 fixture block: starts Thursday 1 October 2026, twelve weeks.
const block = { start: '2026-10-01', weeks: 12 };
const template = [
  { weekday: 1, name: 'Upper A' },
  { weekday: 2, name: 'Lower A' },
  { weekday: 4, name: 'Upper B' },
  { weekday: 5, name: 'Lower B' },
];

describe('block weeks', () => {
  it('starts week 1 on the Monday of the start date and steps exactly 7 days', () => {
    expect(blockWeekMonday(block, 1)).toBe('2026-09-28');
    expect(blockWeekMonday(block, 2)).toBe('2026-10-05');
    expect(blockWeekDates(block, 12)).toEqual([
      '2026-12-14',
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
      '2026-12-18',
      '2026-12-19',
      '2026-12-20',
    ]);
  });

  it('does not drift across the October daylight-saving change', () => {
    // Europe and the US leave summer time in weeks 4–6; calendar days must not shift.
    for (let w = 1; w <= 12; w++) {
      const dates = blockWeekDates(block, w);
      expect(dates[0]).toBe(blockWeekMonday(block, w));
      expect(new Date(`${dates[0]}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it('clamps navigation to weeks 1–12', () => {
    expect(clampBlockWeek(block, 0)).toBe(1);
    expect(clampBlockWeek(block, -3)).toBe(1);
    expect(clampBlockWeek(block, 13)).toBe(12);
    expect(clampBlockWeek(block, 7)).toBe(7);
  });

  it('opens on today’s week, week 1 before the block and week 12 after it', () => {
    expect(currentBlockWeek(block, '2026-10-08')).toBe(2);
    expect(currentBlockWeek(block, '2026-09-29')).toBe(1);
    expect(currentBlockWeek(block, '2026-09-01')).toBe(1);
    expect(currentBlockWeek(block, '2026-12-20')).toBe(12);
    expect(currentBlockWeek(block, '2026-12-21')).toBe(12);
  });
});

describe('scheduled workouts', () => {
  it('places the template on its weekdays and leaves Wed/Sat/Sun as rest', () => {
    const names = blockWeekDates(block, 2).map((d) => scheduledWorkout(template, block, d)?.name ?? null);
    expect(names).toEqual(['Upper A', 'Lower A', null, 'Upper B', 'Lower B', null, null]);
  });

  it('schedules nothing before the start date, even inside week 1', () => {
    expect(isInBlock(block, '2026-09-28')).toBe(false);
    const names = blockWeekDates(block, 1).map((d) => scheduledWorkout(template, block, d)?.name ?? null);
    expect(names).toEqual([null, null, null, 'Upper B', 'Lower B', null, null]);
  });

  it('schedules nothing after the last block week', () => {
    expect(scheduledWorkout(template, block, '2026-12-18')?.name).toBe('Lower B');
    expect(scheduledWorkout(template, block, '2026-12-21')).toBeNull();
  });
});

describe('dayStatus', () => {
  const unopened = { plannedWorkSets: 21, recordedWorkSets: 0, opened: false, completed: false };

  it('marks a past unopened session as not recorded, never as planned', () => {
    expect(dayStatus(unopened, '2026-10-07', '2026-10-08')).toBe('not-recorded');
    expect(dayStatus(unopened, '2026-10-08', '2026-10-08')).toBe('planned');
    expect(dayStatus(unopened, '2026-10-09', '2026-10-08')).toBe('planned');
  });

  it('keeps shortened distinct from done', () => {
    const facts = { ...unopened, opened: true, completed: true };
    expect(dayStatus({ ...facts, recordedWorkSets: 16 }, '2026-10-02', '2026-10-08')).toBe('shortened');
    expect(dayStatus({ ...facts, recordedWorkSets: 21 }, '2026-10-01', '2026-10-08')).toBe('done');
  });
});
