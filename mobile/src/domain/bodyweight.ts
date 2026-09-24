import { addDays, parseIsoDate, type IsoDate } from './dates';

/** Bodyweight is exact integer grams, one entry per date. */
export type BodyweightEntry = { date: IsoDate; grams: number };

/** Weigh-ins each 7-day window needs before the change of the average is shown (desktop rule). */
export const MIN_COMPARABLE = 4;

export const MIN_BODYWEIGHT_G = 20_000;
export const MAX_BODYWEIGHT_G = 300_000;

export type BodyweightTrend = {
  latest: BodyweightEntry | null;
  /** Mean of the entries in the 7 days ending today, or null if there are none. */
  average7Grams: number | null;
  /** How many weigh-ins that mean is over (of 7 days). */
  count7: number;
  /**
   * This 7-day mean minus the previous 7-day mean; null unless both windows hold at least
   * `MIN_COMPARABLE` weigh-ins (never interpolated).
   */
  weeklyChangeGrams: number | null;
};

function inWindow(entries: BodyweightEntry[], from: IsoDate, to: IsoDate): BodyweightEntry[] {
  const lo = parseIsoDate(from);
  const hi = parseIsoDate(to);
  return entries.filter((e) => {
    const t = parseIsoDate(e.date);
    return t >= lo && t <= hi;
  });
}

function mean(entries: BodyweightEntry[]): number | null {
  if (entries.length === 0) return null;
  return entries.reduce((sum, e) => sum + e.grams, 0) / entries.length;
}

/** "82.4" or "82,45" kg → integer grams; null when not a bodyweight (20–300 kg, ≤ 2 decimals). */
export function parseKgToGrams(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const grams = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(2, '0')) * 10;
  return grams >= MIN_BODYWEIGHT_G && grams <= MAX_BODYWEIGHT_G ? grams : null;
}

export function bodyweightTrend(entries: BodyweightEntry[], today: IsoDate): BodyweightTrend {
  const upToToday = entries
    .filter((e) => parseIsoDate(e.date) <= parseIsoDate(today))
    .sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  const latest = upToToday.at(-1) ?? null;
  const current = inWindow(upToToday, addDays(today, -6), today);
  const previous = inWindow(upToToday, addDays(today, -13), addDays(today, -7));
  const comparable = current.length >= MIN_COMPARABLE && previous.length >= MIN_COMPARABLE;
  return {
    latest,
    average7Grams: mean(current),
    count7: current.length,
    weeklyChangeGrams: comparable ? mean(current)! - mean(previous)! : null,
  };
}
