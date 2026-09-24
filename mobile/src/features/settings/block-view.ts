import { addDays, isoWeekday, mondayOf, parseIsoDate, type IsoDate } from '@/domain/dates';
import { longDate, weekdayShort } from '@/features/home/format';
import { weekRangeLabel } from '@/features/training/training-view';

/** The block-start setting as the Settings screen shows it. Pure. */

export type BlockSetting = {
  startLabel: string;
  week1Label: string | null;
  lengthLabel: string;
};

export function blockSetting(start: IsoDate | null, weeks: number): BlockSetting {
  if (!start) {
    return { startLabel: 'Not set — weeks are not numbered yet', week1Label: null, lengthLabel: `${weeks} weeks` };
  }
  const monday = mondayOf(start);
  return {
    startLabel: longDate(start),
    week1Label: weekRangeLabel(monday, addDays(monday, 6)),
    lengthLabel: `${weeks} weeks`,
  };
}

export function isCalendarDate(text: string): boolean {
  try {
    parseIsoDate(text.trim());
    return true;
  } catch {
    return false;
  }
}

/** The confirmation for moving the block start (the desktop's wording). */
export function blockStartQuestion(start: IsoDate): string {
  const monday = mondayOf(start);
  const pre = Array.from({ length: isoWeekday(start) - 1 }, (_, i) => weekdayShort(addDays(monday, i)));
  const preNote = pre.length ? `; in week 1, ${pre.join(', ')} count as pre-block` : '';
  return `Week 1 becomes ${weekRangeLabel(monday, addDays(monday, 6))}${preNote}. Recorded workouts keep their dates; only their week numbers follow the new start.`;
}
