import type { IsoDate } from '@/domain/dates';
import type { MacroGrams, MacroTarget, TargetRecord } from '@/domain/nutrition';

import type { Db } from '../db/database';

/** One day's macro log. Calories are never stored — they are derived from these grams. */
export type NutritionDay = { date: IsoDate; grams: MacroGrams; updatedAt: string };

type DayRow = { logged_on: string; protein_g: number | null; carbs_g: number | null; fat_g: number | null; updated_at: string };
const toDay = (r: DayRow): NutritionDay => ({
  date: r.logged_on,
  grams: { protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g },
  updatedAt: r.updated_at,
});

export async function nutritionDay(db: Db, date: IsoDate): Promise<NutritionDay | null> {
  const row = await db.first<DayRow>('SELECT * FROM nutrition_day WHERE logged_on = ?', [date]);
  return row ? toDay(row) : null;
}

export async function nutritionDaysBetween(db: Db, from: IsoDate, to: IsoDate): Promise<NutritionDay[]> {
  const rows = await db.all<DayRow>('SELECT * FROM nutrition_day WHERE logged_on BETWEEN ? AND ? ORDER BY logged_on', [
    from,
    to,
  ]);
  return rows.map(toDay);
}

/** Records a day's macros (replacing that day's log); with nothing recorded, removes the day. */
export async function saveNutritionDay(db: Db, date: IsoDate, grams: MacroGrams, now: string): Promise<void> {
  if (grams.protein === null && grams.carbs === null && grams.fat === null) {
    await db.transaction(() => db.run('DELETE FROM nutrition_day WHERE logged_on = ?', [date]));
    return;
  }
  await db.transaction(() => db.run(
    `INSERT INTO nutrition_day (logged_on, protein_g, carbs_g, fat_g, entered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (logged_on) DO UPDATE SET protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
       fat_g = excluded.fat_g, updated_at = excluded.updated_at`,
    [date, grams.protein, grams.carbs, grams.fat, now, now],
  ));
}

type TargetRow = {
  id: number;
  effective_on: string;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  notes: string | null;
  set_at: string;
};

export type StoredTarget = TargetRecord & { notes: string | null };

/** Every target ever set, in the order it was set (append-only history). */
export async function macroTargets(db: Db): Promise<StoredTarget[]> {
  const rows = await db.all<TargetRow>('SELECT * FROM macro_target ORDER BY set_at, id');
  return rows.map((r) => ({
    id: r.id,
    effectiveOn: r.effective_on,
    setAt: r.set_at,
    protein: r.protein_g,
    carbs: r.carbs_g,
    fat: r.fat_g,
    notes: r.notes,
  }));
}

/** Appends a target effective from `effectiveOn`; earlier days keep the targets they had. */
export async function addMacroTarget(
  db: Db,
  target: MacroTarget & { effectiveOn: IsoDate; notes: string | null },
  now: string,
): Promise<number> {
  const r = await db.transaction(() =>
    db.run(
      'INSERT INTO macro_target (effective_on, protein_g, carbs_g, fat_g, notes, set_at) VALUES (?, ?, ?, ?, ?, ?)',
      [target.effectiveOn, target.protein, target.carbs, target.fat, target.notes, now],
    ),
  );
  return r.lastInsertRowId;
}
