import { describe, expect, it } from '@jest/globals';

import { blockPhase } from '../block';
import { bodyweightTrend } from '../bodyweight';
import { addDays, isoWeekday, mondayOf, parseIsoDate, weekDates } from '../dates';
import { dayCalories, macroProgress, targetCalories } from '../nutrition';
import { sessionProgress, sessionStatus } from '../training';

describe('dates', () => {
  it('builds the Monday–Sunday week containing a date', () => {
    expect(weekDates('2026-10-08')).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week before
    expect(isoWeekday('2026-10-11')).toBe(7);
  });

  it('crosses month, year and DST boundaries by calendar day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU DST change
    expect(weekDates('2026-12-31')[6]).toBe('2027-01-03');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow();
    expect(() => parseIsoDate('8 Oct 2026')).toThrow();
  });
});

describe('blockPhase', () => {
  // Block starts Thursday 1 Oct; week 1 is Mon 28 Sep – Sun 4 Oct.
  it('is pre-block before the start date, even inside week 1', () => {
    expect(blockPhase('2026-10-01', 12, '2026-09-29')).toEqual({
      kind: 'pre-block',
      daysToStart: 2,
    });
  });

  it('counts Monday–Sunday weeks from the week containing the start', () => {
    expect(blockPhase('2026-10-01', 12, '2026-10-01')).toEqual({ kind: 'in-block', week: 1, weeks: 12 });
    expect(blockPhase('2026-10-01', 12, '2026-10-04')).toMatchObject({ week: 1 });
    expect(blockPhase('2026-10-01', 12, '2026-10-05')).toMatchObject({ week: 2 });
    expect(blockPhase('2026-10-01', 12, '2026-12-20')).toMatchObject({ week: 12 });
  });

  it('is post-block after the last block week', () => {
    expect(blockPhase('2026-10-01', 12, '2026-12-21')).toEqual({ kind: 'post-block', weeks: 12 });
  });
});

describe('nutrition', () => {
  it('derives calories from macros: P×4 + C×4 + F×9', () => {
    expect(dayCalories({ protein: 150, carbs: 300, fat: 60 })).toEqual({ kcal: 2340, complete: true });
    expect(targetCalories({ protein: 145, carbs: 310, fat: 60 })).toBe(2360);
  });

  it('adds nothing for an unrecorded macro and marks the day incomplete', () => {
    expect(dayCalories({ protein: 100, carbs: null, fat: 10 })).toEqual({ kcal: 490, complete: false });
  });

  it('reports grams left and a clamped fraction per macro', () => {
    const [protein, carbs, fat] = macroProgress(
      { protein: 160, carbs: null, fat: 30 },
      { protein: 145, carbs: 310, fat: 60 },
    );
    expect(protein).toMatchObject({ left: -15, fraction: 1 });
    expect(carbs).toMatchObject({ eaten: null, left: 310, fraction: 0 });
    expect(fat).toMatchObject({ left: 30, fraction: 0.5 });
  });
});

describe('bodyweightTrend', () => {
  it('compares the last 7 days with the 7 before', () => {
    const trend = bodyweightTrend(
      [
        { date: '2026-09-25', grams: 83_000 },
        { date: '2026-10-01', grams: 82_800 },
        { date: '2026-10-02', grams: 82_600 },
        { date: '2026-10-08', grams: 82_400 },
      ],
      '2026-10-08',
    );
    expect(trend.latest).toEqual({ date: '2026-10-08', grams: 82_400 });
    expect(trend.average7Grams).toBe(82_500);
    expect(trend.weeklyChangeGrams).toBe(-400);
  });

  it('ignores entries after today and has no change without a previous week', () => {
    const trend = bodyweightTrend(
      [
        { date: '2026-10-07', grams: 82_000 },
        { date: '2026-10-09', grams: 90_000 },
      ],
      '2026-10-08',
    );
    expect(trend.latest?.grams).toBe(82_000);
    expect(trend.weeklyChangeGrams).toBeNull();
    expect(bodyweightTrend([], '2026-10-08').latest).toBeNull();
  });
});

describe('training', () => {
  const facts = { plannedWorkSets: 21, recordedWorkSets: 0, opened: false, completed: false };

  it('separates planned, in-progress, done and shortened', () => {
    expect(sessionStatus(facts)).toBe('planned');
    expect(sessionStatus({ ...facts, opened: true, recordedWorkSets: 9 })).toBe('in-progress');
    expect(sessionStatus({ ...facts, opened: true, completed: true, recordedWorkSets: 21 })).toBe('done');
    expect(sessionStatus({ ...facts, opened: true, completed: true, recordedWorkSets: 15 })).toBe(
      'shortened',
    );
  });

  it('measures progress against planned work sets', () => {
    expect(sessionProgress({ ...facts, recordedWorkSets: 9 })).toBeCloseTo(9 / 21);
    expect(sessionProgress({ ...facts, recordedWorkSets: 25 })).toBe(1);
    expect(sessionProgress({ ...facts, plannedWorkSets: 0 })).toBe(0);
  });
});
