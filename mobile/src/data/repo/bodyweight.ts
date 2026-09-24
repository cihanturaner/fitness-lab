import type { BodyweightEntry } from '@/domain/bodyweight';
import type { IsoDate } from '@/domain/dates';

import type { Db } from '../db/database';

type Row = { measured_on: string; bodyweight_g: number };

/** Weigh-ins between two dates (inclusive), oldest first. */
export async function bodyweightBetween(db: Db, from: IsoDate, to: IsoDate): Promise<BodyweightEntry[]> {
  const rows = await db.all<Row>(
    'SELECT measured_on, bodyweight_g FROM bodyweight_entry WHERE measured_on BETWEEN ? AND ? ORDER BY measured_on',
    [from, to],
  );
  return rows.map((r) => ({ date: r.measured_on, grams: r.bodyweight_g }));
}

/** Records the day's weigh-in in integer grams; a second entry for the date replaces it. */
export async function saveBodyweight(db: Db, date: IsoDate, grams: number, now: string): Promise<void> {
  await db.run(
    `INSERT INTO bodyweight_entry (measured_on, bodyweight_g, entered_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (measured_on) DO UPDATE SET bodyweight_g = excluded.bodyweight_g, updated_at = excluded.updated_at`,
    [date, grams, now, now],
  );
}

export async function deleteBodyweight(db: Db, date: IsoDate): Promise<void> {
  await db.run('DELETE FROM bodyweight_entry WHERE measured_on = ?', [date]);
}
