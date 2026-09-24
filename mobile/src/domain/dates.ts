/**
 * Calendar-date arithmetic on ISO dates ("YYYY-MM-DD"). A training day is a calendar date,
 * never an instant, so everything here works in UTC days and cannot drift with the device
 * time zone or daylight saving.
 */

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function parseIsoDate(date: IsoDate): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Not an ISO date: ${date}`);
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (toIsoDate(ms) !== date) throw new Error(`Not a calendar date: ${date}`);
  return ms;
}

function toIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(parseIsoDate(date) + days * DAY_MS);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to) - parseIsoDate(from)) / DAY_MS);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(parseIsoDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** The Monday–Sunday week containing `date`. */
export function weekDates(date: IsoDate): IsoDate[] {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function dayOfMonth(date: IsoDate): number {
  return new Date(parseIsoDate(date)).getUTCDate();
}

export function monthIndex(date: IsoDate): number {
  return new Date(parseIsoDate(date)).getUTCMonth();
}
