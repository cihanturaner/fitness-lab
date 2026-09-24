import type { Db } from './database';

/**
 * The device database schema, as forward-only numbered migrations. `SCHEMA_VERSION` is the
 * newest this build knows; a database written by a newer build is refused rather than
 * guessed at. Each migration runs in its own transaction with its bookkeeping row.
 *
 * The tables mirror the desktop's where they carry the same facts (integer grams, one
 * bodyweight / nutrition row per date, effective-dated append-only macro targets, workout
 * draft/complete with its planned origin, per-set slot placement, per-workout
 * substitutions), so the V1 export carries across without reinterpretation. The program
 * itself is bundled with the app (`data/program.ts`); a workout names its origin by
 * `program_key` + `workout_key` and a set its slot by `slot_key`.
 */

export const SCHEMA_VERSION = 1;

type Migration = { version: number; name: string; sql: string };

const DATE = (col: string) => `CHECK (${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${col}) = ${col})`;
const COMPLETE_GUARD = (table: string, op: 'INSERT' | 'UPDATE' | 'DELETE', row: 'NEW' | 'OLD') => `
CREATE TRIGGER ${table}_${op.toLowerCase()}_needs_draft BEFORE ${op} ON ${table}
WHEN (SELECT status FROM workout WHERE id = ${row}.workout_id) = 'complete'
BEGIN SELECT RAISE(ABORT, 'workout is complete; reopen it before correcting it'); END;`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE maintenance (key TEXT PRIMARY KEY);

CREATE TABLE exercise (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  name_key TEXT NOT NULL,
  equipment_label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX exercise_identity ON exercise (name_key, coalesce(lower(trim(equipment_label)), ''));

CREATE TABLE training_block (
  program_key TEXT PRIMARY KEY,
  start_on TEXT NOT NULL ${DATE('start_on')},
  set_at TEXT NOT NULL
);

CREATE TABLE workout (
  id INTEGER PRIMARY KEY,
  performed_on TEXT NOT NULL ${DATE('performed_on')},
  performed_time_local TEXT CHECK (performed_time_local IS NULL OR performed_time_local GLOB '[0-2][0-9]:[0-5][0-9]'),
  program_key TEXT,
  workout_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'complete')),
  notes TEXT,
  entered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((program_key IS NULL) = (workout_key IS NULL))
);
CREATE INDEX workout_by_day ON workout (performed_on, workout_key);

CREATE TABLE performed_set (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workout (id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercise (id),
  set_order INTEGER NOT NULL CHECK (set_order >= 1),
  set_type TEXT CHECK (set_type IS NULL OR set_type IN ('warmup', 'working', 'backoff')),
  load_g INTEGER CHECK (load_g IS NULL OR load_g >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  rir INTEGER,
  notes TEXT,
  entered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workout_id, set_order)
);
CREATE INDEX performed_set_by_exercise ON performed_set (exercise_id);

-- The planned slot a set was recorded in (NULL slot_key = recorded as extra work). A set
-- without a row has no recorded placement (desktop sets from before its migration 0008).
CREATE TABLE performed_set_slot (
  set_id INTEGER PRIMARY KEY REFERENCES performed_set (id) ON DELETE CASCADE,
  workout_id INTEGER NOT NULL REFERENCES workout (id) ON DELETE CASCADE,
  slot_key TEXT
);

-- "Change": one workout's slot performed as another exercise. The plan never changes.
CREATE TABLE workout_slot_substitution (
  workout_id INTEGER NOT NULL REFERENCES workout (id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  exercise_id INTEGER NOT NULL REFERENCES exercise (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workout_id, slot_key)
);

${COMPLETE_GUARD('performed_set', 'INSERT', 'NEW')}
${COMPLETE_GUARD('performed_set', 'UPDATE', 'NEW')}
${COMPLETE_GUARD('performed_set', 'DELETE', 'OLD')}
${COMPLETE_GUARD('performed_set_slot', 'INSERT', 'NEW')}
${COMPLETE_GUARD('performed_set_slot', 'DELETE', 'OLD')}
${COMPLETE_GUARD('workout_slot_substitution', 'INSERT', 'NEW')}
${COMPLETE_GUARD('workout_slot_substitution', 'UPDATE', 'NEW')}
${COMPLETE_GUARD('workout_slot_substitution', 'DELETE', 'OLD')}

CREATE TABLE bodyweight_entry (
  measured_on TEXT PRIMARY KEY ${DATE('measured_on')},
  bodyweight_g INTEGER NOT NULL CHECK (bodyweight_g BETWEEN 20000 AND 300000),
  notes TEXT,
  entered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Calories are never stored: they are derived, protein × 4 + carbs × 4 + fat × 9.
CREATE TABLE nutrition_day (
  logged_on TEXT PRIMARY KEY ${DATE('logged_on')},
  protein_g INTEGER CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1500),
  carbs_g INTEGER CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1500),
  fat_g INTEGER CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 1500),
  notes TEXT,
  entered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (protein_g IS NOT NULL OR carbs_g IS NOT NULL OR fat_g IS NOT NULL)
);

-- Effective-dated and append-only: the target in force on a day is the latest effective_on
-- on or before it (ties: latest set_at, then id). Only a confirmed full replace may clear it.
CREATE TABLE macro_target (
  id INTEGER PRIMARY KEY,
  effective_on TEXT NOT NULL ${DATE('effective_on')},
  protein_g INTEGER NOT NULL CHECK (protein_g BETWEEN 0 AND 2500),
  carbs_g INTEGER NOT NULL CHECK (carbs_g BETWEEN 0 AND 2500),
  fat_g INTEGER NOT NULL CHECK (fat_g BETWEEN 0 AND 2500),
  notes TEXT,
  set_at TEXT NOT NULL,
  CHECK (protein_g + carbs_g + fat_g > 0)
);
CREATE TRIGGER macro_target_append_only_update BEFORE UPDATE ON macro_target
BEGIN SELECT RAISE(ABORT, 'macro targets are append-only'); END;
CREATE TRIGGER macro_target_append_only_delete BEFORE DELETE ON macro_target
WHEN NOT EXISTS (SELECT 1 FROM maintenance WHERE key = 'replace-all')
BEGIN SELECT RAISE(ABORT, 'macro targets are append-only'); END;

-- A discarded draft that held sets, kept as JSON (the desktop snapshots the file instead).
CREATE TABLE discarded_workout (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL,
  discarded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

-- Desktop history this app does not use but keeps (controller decisions, gate audits,
-- calories typed before V3.1, legacy calorie targets), verbatim from an import.
CREATE TABLE imported_record (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE import_log (
  id INTEGER PRIMARY KEY,
  imported_at TEXT NOT NULL,
  format TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  exported_at TEXT,
  source_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('into-empty', 'replace')),
  summary_json TEXT NOT NULL
);

-- What a confirmed replace removed, as a V1 export (JSON). Never cleared by a replace.
CREATE TABLE replaced_data (
  id INTEGER PRIMARY KEY,
  replaced_at TEXT NOT NULL,
  export_json TEXT NOT NULL
);
`,
  },
];

export class NewerSchemaError extends Error {
  constructor(found: number) {
    super(`This data was written by a newer Fitness Lab (schema ${found}); this build knows ${SCHEMA_VERSION}.`);
  }
}

/** Applies every pending migration in order; refuses a database newer than this build. */
export async function migrate(db: Db, now: () => string = () => new Date().toISOString()): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const row = await db.first<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
  const current = row?.v ?? 0;
  if (current > SCHEMA_VERSION) throw new NewerSchemaError(current);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async () => {
      await db.exec(m.sql);
      await db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        now(),
      ]);
    });
  }
  return SCHEMA_VERSION;
}
