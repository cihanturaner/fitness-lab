import { dayOfMonth, isoWeekday, monthIndex, type IsoDate } from '@/domain/dates';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MINUS = '−';

export function weekdayName(date: IsoDate): string {
  return WEEKDAYS[isoWeekday(date) - 1];
}

export function weekdayShort(date: IsoDate): string {
  return weekdayName(date).slice(0, 3);
}

/** "Thursday 8 October" */
export function longDate(date: IsoDate): string {
  return `${weekdayName(date)} ${dayOfMonth(date)} ${MONTHS[monthIndex(date)]}`;
}

/** 2360 → "2,360"; independent of the device's Intl support. */
export function groupThousands(n: number): string {
  const sign = n < 0 ? MINUS : '';
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Integer grams → "82.4" (kilograms, one decimal). */
export function kg(grams: number): string {
  return (grams / 1000).toFixed(1);
}

/** Signed one-decimal kilograms: "−0.3", "+0.2", "0.0". */
export function signedKg(grams: number): string {
  const rounded = Math.round(grams / 100) / 10;
  if (rounded === 0) return '0.0';
  return `${rounded < 0 ? MINUS : '+'}${Math.abs(rounded).toFixed(1)}`;
}
