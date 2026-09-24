import { bodyweightTrend, MIN_COMPARABLE, type BodyweightEntry } from '@/domain/bodyweight';
import { dayOfMonth, parseIsoDate, type IsoDate } from '@/domain/dates';
import { MINUS, weekdayShort } from '@/features/home/format';

/** Bodyweight in kilograms, exactly as recorded (integer grams): 82400 → "82.4". */
export function kgExact(grams: number): string {
  const whole = Math.floor(grams / 1000);
  const frac = String(grams % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** A mean or a change, rounded half-up to 0.01 kg as the desktop shows it. */
export function kg2(grams: number): string {
  const hundredths = Math.floor(Math.abs(grams) / 10 + 0.5);
  const text = `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
  return grams < 0 && hundredths > 0 ? `${MINUS}${text}` : text;
}

export function shortDay(date: IsoDate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdayShort(date)} ${dayOfMonth(date)} ${months[new Date(parseIsoDate(date)).getUTCMonth()]}`;
}

export type BodyweightView = {
  averageLabel: string | null;
  averageCaption: string;
  latestLabel: string | null;
  latestWhen: string | null;
  changeLabel: string | null;
  changeCaption: string;
  recent: { date: IsoDate; dayLabel: string; kgLabel: string }[];
};

/** Latest, 7-day average (with its n/7) and the change of the average — never interpolated. */
export function buildBodyweightView(entries: readonly BodyweightEntry[], today: IsoDate): BodyweightView {
  const trend = bodyweightTrend([...entries], today);
  const change = trend.weeklyChangeGrams;
  return {
    averageLabel: trend.average7Grams === null ? null : kg2(trend.average7Grams),
    averageCaption: trend.average7Grams === null ? 'No weigh-in in the last 7 days' : `${trend.count7} of 7 days`,
    latestLabel: trend.latest ? kgExact(trend.latest.grams) : null,
    latestWhen: trend.latest ? (trend.latest.date === today ? 'Today' : shortDay(trend.latest.date)) : null,
    changeLabel: change === null ? null : `${change > 0 ? '+' : ''}${kg2(change)}`,
    changeCaption:
      change === null ? `Needs ${MIN_COMPARABLE} weigh-ins in each of the last two weeks` : 'vs the previous 7 days',
    recent: [...entries]
      .filter((e) => parseIsoDate(e.date) <= parseIsoDate(today))
      .sort((a, b) => parseIsoDate(b.date) - parseIsoDate(a.date))
      .slice(0, 14)
      .map((e) => ({ date: e.date, dayLabel: e.date === today ? 'Today' : shortDay(e.date), kgLabel: kgExact(e.grams) })),
  };
}
