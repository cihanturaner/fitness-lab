import type { IsoDate } from '@/domain/dates';

/**
 * Where "today" and "now" come from. Production reads the device clock (the local calendar
 * date — a training day is the lifter's date, not a UTC instant); tests and screenshots
 * inject a fixed clock so they stay deterministic.
 */
export type Clock = {
  /** The local calendar date, YYYY-MM-DD. */
  today(): IsoDate;
  /** The current instant, ISO 8601 UTC — for entered/updated stamps. */
  now(): string;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function localIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const deviceClock: Clock = {
  today: () => localIsoDate(new Date()),
  now: () => new Date().toISOString(),
};

/** A clock stopped on `today` (noon UTC of it, for stamps), advancing 1 ms per read. */
export function fixedClock(today: IsoDate): Clock {
  let tick = 0;
  return {
    today: () => today,
    now: () => new Date(Date.parse(`${today}T12:00:00.000Z`) + tick++).toISOString(),
  };
}
