import type { Db } from '../db/database';
import { SCHEMA_VERSION } from '../db/version';
import { PROGRAM, PROGRAM_JSON_SHA256 } from '../program';
import type { ProgramFacts } from '../training-facts';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, type ExportDocument, type ExportWorkout } from './format';

/**
 * The device's data as a V1 export — the same format the desktop exporter writes, so a
 * backup from this iPhone can be imported again (here or on a new iPhone). Ids are this
 * database's own, as text. Read-only.
 */
export async function exportDevice(db: Db, exportedAt: string, program: ProgramFacts = PROGRAM): Promise<ExportDocument> {
  const exercises = await db.all<{ id: number; name: string; equipment_label: string | null; is_active: number; created_at: string }>(
    'SELECT * FROM exercise ORDER BY id',
  );
  const workoutRows = await db.all<{
    id: number;
    performed_on: string;
    performed_time_local: string | null;
    program_key: string | null;
    workout_key: string | null;
    status: 'draft' | 'complete';
    notes: string | null;
    entered_at: string;
    updated_at: string;
  }>('SELECT * FROM workout ORDER BY performed_on, entered_at, id');

  const workouts: ExportWorkout[] = [];
  for (const w of workoutRows) {
    const subs = await db.all<{ slot_key: string; exercise_id: number; created_at: string; updated_at: string }>(
      'SELECT * FROM workout_slot_substitution WHERE workout_id = ? ORDER BY slot_key',
      [w.id],
    );
    const sets = await db.all<{
      id: number;
      exercise_id: number;
      set_order: number;
      set_type: 'warmup' | 'working' | 'backoff' | null;
      load_g: number | null;
      reps: number | null;
      rir: number | null;
      notes: string | null;
      entered_at: string;
      updated_at: string;
      placed: number;
      slot_key: string | null;
    }>(
      `SELECT s.*, (p.set_id IS NOT NULL) AS placed, p.slot_key FROM performed_set s
       LEFT JOIN performed_set_slot p ON p.set_id = s.id WHERE s.workout_id = ? ORDER BY s.set_order`,
      [w.id],
    );
    workouts.push({
      id: `${w.id}`,
      performed_on: w.performed_on,
      performed_time_local: w.performed_time_local,
      status: w.status,
      notes: w.notes,
      entered_at_utc: w.entered_at,
      updated_at_utc: w.updated_at,
      origin:
        w.workout_key && w.program_key
          ? { program_key: w.program_key, version_label: program.versionLabel, workout_key: w.workout_key }
          : null,
      substitutions: subs.map((s) => ({
        slot_key: s.slot_key,
        exercise_id: `${s.exercise_id}`,
        created_at_utc: s.created_at,
        updated_at_utc: s.updated_at,
      })),
      sets: sets.map((s) => ({
        id: `${s.id}`,
        exercise_id: `${s.exercise_id}`,
        set_order: s.set_order,
        set_type: s.set_type,
        load_g: s.load_g,
        reps: s.reps,
        rir: s.rir,
        notes: s.notes,
        entered_at_utc: s.entered_at,
        updated_at_utc: s.updated_at,
        placement: s.placed ? { slot_key: s.slot_key } : null,
      })),
    });
  }

  const block = await db.first<{ start_on: string; set_at: string }>('SELECT * FROM training_block WHERE program_key = ?', [
    program.key,
  ]);
  const archive: Record<string, Record<string, unknown>[]> = {};
  for (const r of await db.all<{ kind: string; payload_json: string }>('SELECT kind, payload_json FROM imported_record ORDER BY id')) {
    (archive[r.kind] ??= []).push(JSON.parse(r.payload_json) as Record<string, unknown>);
  }

  const document: ExportDocument = {
    format: EXPORT_FORMAT,
    format_version: EXPORT_FORMAT_VERSION,
    exported_at_utc: exportedAt,
    source: { app: 'fitness-lab-mobile', schema_version: SCHEMA_VERSION, database_sha256: null },
    program: {
      key: program.key,
      name: program.name,
      version_label: program.versionLabel,
      duration_weeks: program.weeks,
      program_json_sha256: PROGRAM_JSON_SHA256,
    },
    program_slots: program.workouts.flatMap((w) =>
      w.exercises.map((e, i) => ({
        program_key: program.key,
        version_label: program.versionLabel,
        workout_key: w.key,
        workout_name: w.name,
        slot_key: e.slotKey,
        position: i + 1,
        exercise_name: e.name,
      })),
    ),
    training_block: block ? { start_on: block.start_on, set_at_utc: block.set_at } : null,
    exercises: exercises.map((e) => ({
      id: `${e.id}`,
      name: e.name,
      equipment_label: e.equipment_label,
      is_active: e.is_active === 1,
      created_at_utc: e.created_at,
    })),
    workouts,
    bodyweight: (
      await db.all<{ measured_on: string; bodyweight_g: number; notes: string | null; entered_at: string; updated_at: string }>(
        'SELECT * FROM bodyweight_entry ORDER BY measured_on',
      )
    ).map((b) => ({ measured_on: b.measured_on, bodyweight_g: b.bodyweight_g, notes: b.notes, entered_at_utc: b.entered_at, updated_at_utc: b.updated_at })),
    nutrition_days: (
      await db.all<{
        logged_on: string;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
        notes: string | null;
        entered_at: string;
        updated_at: string;
      }>('SELECT * FROM nutrition_day ORDER BY logged_on')
    ).map((n) => ({
      logged_on: n.logged_on,
      protein_g: n.protein_g,
      carbs_g: n.carbs_g,
      fat_g: n.fat_g,
      notes: n.notes,
      entered_at_utc: n.entered_at,
      updated_at_utc: n.updated_at,
    })),
    macro_targets: (
      await db.all<{ id: number; effective_on: string; protein_g: number; carbs_g: number; fat_g: number; notes: string | null; set_at: string }>(
        'SELECT * FROM macro_target ORDER BY set_at, id',
      )
    ).map((t) => ({
      id: `${t.id}`,
      effective_on: t.effective_on,
      protein_g: t.protein_g,
      carbs_g: t.carbs_g,
      fat_g: t.fat_g,
      notes: t.notes,
      set_at_utc: t.set_at,
    })),
    archive,
  };
  document.counts = {
    exercises: document.exercises.length,
    workouts: workouts.length,
    sets: workouts.reduce((n, w) => n + w.sets.length, 0),
    bodyweight: document.bodyweight.length,
    nutrition_days: document.nutrition_days.length,
    macro_targets: document.macro_targets.length,
  };
  return document;
}
