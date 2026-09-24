import type { IsoDate } from '@/domain/dates';

import type { Db } from '../db/database';

/** The block start date for a program, or null when the lifter has not set one. */
export async function blockStart(db: Db, programKey: string): Promise<IsoDate | null> {
  const row = await db.first<{ start_on: string }>('SELECT start_on FROM training_block WHERE program_key = ?', [
    programKey,
  ]);
  return row?.start_on ?? null;
}

/** Sets (or moves) the block start. Recorded workouts keep their dates; only week numbers follow. */
export async function setBlockStart(db: Db, programKey: string, start: IsoDate, now: string): Promise<void> {
  await db.run(
    `INSERT INTO training_block (program_key, start_on, set_at) VALUES (?, ?, ?)
     ON CONFLICT (program_key) DO UPDATE SET start_on = excluded.start_on, set_at = excluded.set_at`,
    [programKey, start, now],
  );
}
