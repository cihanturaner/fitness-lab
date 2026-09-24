import { parseIsoDate, type IsoDate } from './dates';

/**
 * Session status from facts about one planned session. Planned is not performed: the
 * planned side is a count of non-warm-up sets, the performed side only what was recorded.
 * A completed session with fewer recorded sets than planned is "shortened" (totals only,
 * never matched set by set) and is never presented as a full "done".
 */

export type SessionFacts = {
  plannedWorkSets: number;
  recordedWorkSets: number;
  /** A draft exists (the lifter opened the workout). */
  opened: boolean;
  completed: boolean;
};

export type SessionStatus = 'planned' | 'in-progress' | 'done' | 'shortened';

export function sessionStatus(facts: SessionFacts): SessionStatus {
  if (facts.completed) {
    return facts.recordedWorkSets < facts.plannedWorkSets ? 'shortened' : 'done';
  }
  return facts.opened ? 'in-progress' : 'planned';
}

/** Share of planned work sets recorded, 0–1. */
export function sessionProgress(facts: SessionFacts): number {
  if (facts.plannedWorkSets <= 0) return 0;
  return Math.min(1, facts.recordedWorkSets / facts.plannedWorkSets);
}

export function isFinished(status: SessionStatus): boolean {
  return status === 'done' || status === 'shortened';
}

/** A scheduled day's status: a planned session whose day has passed unopened was not recorded. */
export type DayStatus = SessionStatus | 'not-recorded';

export function dayStatus(facts: SessionFacts, date: IsoDate, today: IsoDate): DayStatus {
  const status = sessionStatus(facts);
  if (status === 'planned' && parseIsoDate(date) < parseIsoDate(today)) return 'not-recorded';
  return status;
}
