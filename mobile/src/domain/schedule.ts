import { blockPhase } from './block';
import { addDays, isoWeekday, mondayOf, type IsoDate } from './dates';

/**
 * The weekly template laid over a training block. Block weeks are Monday–Sunday; week 1 is
 * the week containing the start date. Days before the start or after the last block week
 * hold no scheduled workout, even inside week 1 (block phases are exact to the day).
 */

export type Block = { start: IsoDate; weeks: number };

/** Monday of block week `week` (1-based). */
export function blockWeekMonday(block: Block, week: number): IsoDate {
  return addDays(mondayOf(block.start), (week - 1) * 7);
}

/** The seven dates of block week `week`, Monday first. */
export function blockWeekDates(block: Block, week: number): IsoDate[] {
  const monday = blockWeekMonday(block, week);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** `week` kept inside 1…block.weeks. */
export function clampBlockWeek(block: Block, week: number): number {
  return Math.min(block.weeks, Math.max(1, Math.trunc(week)));
}

/** The block week a planner opens on: today's; week 1 before the block; the last after it. */
export function currentBlockWeek(block: Block, today: IsoDate): number {
  const phase = blockPhase(block.start, block.weeks, today);
  if (phase.kind === 'in-block') return phase.week;
  return phase.kind === 'pre-block' ? 1 : block.weeks;
}

export function isInBlock(block: Block, date: IsoDate): boolean {
  return blockPhase(block.start, block.weeks, date).kind === 'in-block';
}

/** The workout the weekly template puts on `date`; null on a rest day or outside the block. */
export function scheduledWorkout<W extends { weekday: number }>(
  workouts: readonly W[],
  block: Block,
  date: IsoDate,
): W | null {
  if (!isInBlock(block, date)) return null;
  return workouts.find((w) => w.weekday === isoWeekday(date)) ?? null;
}
