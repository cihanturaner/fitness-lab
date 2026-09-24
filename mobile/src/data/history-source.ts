import type { BodyweightEntry } from '@/domain/bodyweight';
import type { IsoDate } from '@/domain/dates';

import type { Db } from './db/database';
import { PROGRAM } from './program';
import { macroTargets, type NutritionDay, type StoredTarget } from './repo/nutrition';
import { loadSession, type SessionRecord } from './repo/workouts';
import type { ProgramFacts } from './training-facts';

/**
 * History's facts: days, newest first, each with what was recorded on it. A day appears
 * when it holds a completed workout, a weigh-in or a nutrition log (drafts are not history
 * yet). Paged by date: `before` is the cursor (exclusive).
 */

export type HistoryKind = 'all' | 'training' | 'bodyweight' | 'nutrition';

export type HistoryDay = {
  date: IsoDate;
  workouts: SessionRecord[];
  bodyweight: BodyweightEntry | null;
  nutrition: NutritionDay | null;
};

export type HistoryPage = {
  days: HistoryDay[];
  /** Pass as `before` for the next (earlier) page; null when there is none. */
  nextBefore: IsoDate | null;
  targets: StoredTarget[];
};

const SOURCES: Record<Exclude<HistoryKind, 'all'>, string> = {
  training: "SELECT DISTINCT performed_on AS d FROM workout WHERE status = 'complete'",
  bodyweight: 'SELECT measured_on AS d FROM bodyweight_entry',
  nutrition: 'SELECT logged_on AS d FROM nutrition_day',
};

export async function loadHistoryPage(
  db: Db,
  kind: HistoryKind = 'all',
  before: IsoDate | null = null,
  limit = 21,
  program: ProgramFacts = PROGRAM,
): Promise<HistoryPage> {
  const union =
    kind === 'all' ? Object.values(SOURCES).join(' UNION ') : SOURCES[kind];
  const rows = await db.all<{ d: string }>(
    `SELECT d FROM (${union}) WHERE (? IS NULL OR d < ?) GROUP BY d ORDER BY d DESC LIMIT ?`,
    [before, before, limit + 1],
  );
  const dates = rows.slice(0, limit).map((r) => r.d);
  const days: HistoryDay[] = [];
  for (const date of dates) {
    const ids = await db.all<{ id: number }>(
      "SELECT id FROM workout WHERE performed_on = ? AND status = 'complete' ORDER BY entered_at, id",
      [date],
    );
    const workouts: SessionRecord[] = [];
    if (kind === 'all' || kind === 'training') {
      for (const { id } of ids) workouts.push(await loadSession(db, id, program));
    }
    const bw =
      kind === 'all' || kind === 'bodyweight'
        ? await db.first<{ g: number }>('SELECT bodyweight_g AS g FROM bodyweight_entry WHERE measured_on = ?', [date])
        : null;
    const nu =
      kind === 'all' || kind === 'nutrition'
        ? await db.first<{ p: number | null; c: number | null; f: number | null; u: string }>(
            'SELECT protein_g AS p, carbs_g AS c, fat_g AS f, updated_at AS u FROM nutrition_day WHERE logged_on = ?',
            [date],
          )
        : null;
    days.push({
      date,
      workouts,
      bodyweight: bw ? { date, grams: bw.g } : null,
      nutrition: nu ? { date, grams: { protein: nu.p, carbs: nu.c, fat: nu.f }, updatedAt: nu.u } : null,
    });
  }
  return {
    days,
    nextBefore: rows.length > limit ? dates[dates.length - 1] : null,
    targets: await macroTargets(db),
  };
}
