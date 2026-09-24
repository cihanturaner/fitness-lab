import { addDays, parseIsoDate, type IsoDate } from './dates';

/** Bodyweight is exact integer grams, one entry per date. */
export type BodyweightEntry = { date: IsoDate; grams: number };

export type BodyweightTrend = {
  latest: BodyweightEntry | null;
  /** Mean of the entries in the 7 days ending today, or null if there are none. */
  average7Grams: number | null;
  /** This 7-day mean minus the previous 7-day mean; null unless both windows have entries. */
  weeklyChangeGrams: number | null;
};

function meanInWindow(entries: BodyweightEntry[], from: IsoDate, to: IsoDate): number | null {
  const lo = parseIsoDate(from);
  const hi = parseIsoDate(to);
  const inside = entries.filter((e) => {
    const t = parseIsoDate(e.date);
    return t >= lo && t <= hi;
  });
  if (inside.length === 0) return null;
  return inside.reduce((sum, e) => sum + e.grams, 0) / inside.length;
}

export function bodyweightTrend(entries: BodyweightEntry[], today: IsoDate): BodyweightTrend {
  const upToToday = entries
    .filter((e) => parseIsoDate(e.date) <= parseIsoDate(today))
    .sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  const latest = upToToday.at(-1) ?? null;
  const current = meanInWindow(upToToday, addDays(today, -6), today);
  const previous = meanInWindow(upToToday, addDays(today, -13), addDays(today, -7));
  return {
    latest,
    average7Grams: current,
    weeklyChangeGrams: current !== null && previous !== null ? current - previous : null,
  };
}
