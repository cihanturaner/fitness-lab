import { daysBetween, mondayOf, parseIsoDate, type IsoDate } from './dates';

/**
 * Where a date sits in a training block. Exact to the day: before the start date is
 * pre-block (even inside week 1), after the last block week is post-block. Week 1 is the
 * Monday–Sunday week containing the start date.
 */
export type BlockPhase =
  | { kind: 'pre-block'; daysToStart: number }
  | { kind: 'in-block'; week: number; weeks: number }
  | { kind: 'post-block'; weeks: number };

export function blockPhase(start: IsoDate, weeks: number, date: IsoDate): BlockPhase {
  if (parseIsoDate(date) < parseIsoDate(start)) {
    return { kind: 'pre-block', daysToStart: daysBetween(date, start) };
  }
  const week = Math.floor(daysBetween(mondayOf(start), date) / 7) + 1;
  if (week > weeks) return { kind: 'post-block', weeks };
  return { kind: 'in-block', week, weeks };
}
