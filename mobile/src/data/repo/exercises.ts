import { exerciseNameKey } from '@/domain/substitutes';

import type { Db } from '../db/database';

export type Exercise = { id: number; name: string; isActive: boolean };

type Row = { id: number; name: string; is_active: number };
const toExercise = (r: Row): Exercise => ({ id: r.id, name: r.name, isActive: r.is_active === 1 });

export class RetiredExerciseError extends Error {
  constructor(name: string) {
    super(`${name} is retired and cannot be used again.`);
  }
}

/** The exercise identity with this name and no equipment label, if one exists. */
export async function findExercise(db: Db, name: string): Promise<Exercise | null> {
  const rows = await db.all<Row>(
    `SELECT id, name, is_active FROM exercise
     WHERE name_key = ? AND (equipment_label IS NULL OR trim(equipment_label) = '')
     ORDER BY is_active DESC, id`,
    [exerciseNameKey(name)],
  );
  return rows[0] ? toExercise(rows[0]) : null;
}

/**
 * The exercise with this name (case- and whitespace-insensitive), created when none exists.
 * A retired identity is refused, never revived.
 */
export async function ensureExercise(db: Db, name: string, now: string): Promise<Exercise> {
  const found = await findExercise(db, name);
  if (found) {
    if (!found.isActive) throw new RetiredExerciseError(found.name);
    return found;
  }
  const r = await db.run('INSERT INTO exercise (name, name_key, created_at) VALUES (?, ?, ?)', [
    name,
    exerciseNameKey(name),
    now,
  ]);
  return { id: r.lastInsertRowId, name, isActive: true };
}

export async function exercisesById(db: Db, ids: readonly number[]): Promise<Map<number, Exercise>> {
  if (ids.length === 0) return new Map();
  const unique = [...new Set(ids)];
  const rows = await db.all<Row>(
    `SELECT id, name, is_active FROM exercise WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  return new Map(rows.map((r) => [r.id, toExercise(r)]));
}
