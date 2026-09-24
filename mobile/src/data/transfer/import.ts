import { exerciseNameKey } from '@/domain/substitutes';

import type { Db } from '../db/database';
import { PROGRAM, PROGRAM_JSON_SHA256 } from '../program';
import type { ProgramFacts } from '../training-facts';
import { exportDevice } from './export';
import type { ExportDocument } from './format';

/**
 * Imports a checked V1 export into the device database — all of it or none of it (one
 * transaction). The conservative rule for a device that already holds data: nothing is
 * merged. Importing needs an empty device, or an explicit "replace" that first keeps the
 * device's current data as a V1 export in `replaced_data` and then swaps it for the file's.
 */

export type ImportPlan =
  | {
      ok: true;
      /** The export's program is this app's exactly, or differs only outside the slots used. */
      programMatch: 'exact' | 'compatible';
      deviceHasData: boolean;
      summary: {
        workouts: number;
        completed: number;
        sets: number;
        bodyweight: number;
        nutritionDays: number;
        targets: number;
        firstDate: string | null;
        lastDate: string | null;
        blockStart: string | null;
      };
    }
  | { ok: false; errors: string[] };

export class ImportRefused extends Error {}

/** Does the device hold any recorded fact (a workout, weigh-in, macro log, target or block)? */
export async function deviceHasData(db: Db): Promise<boolean> {
  const row = await db.first<{ n: number }>(
    `SELECT (SELECT count(*) FROM workout) + (SELECT count(*) FROM bodyweight_entry)
          + (SELECT count(*) FROM nutrition_day) + (SELECT count(*) FROM macro_target)
          + (SELECT count(*) FROM training_block) AS n`,
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Proves every planned slot the export refers to is the same slot in this app's program:
 * same program and version, same workout, same key, position and planned exercise. A set
 * placed in a slot must be the exercise that slot was performed as in its workout.
 */
function checkAgainstProgram(doc: ExportDocument, program: ProgramFacts): string[] {
  const errors: string[] = [];
  const add = (e: string) => errors.length < 8 && errors.push(e);
  if (doc.program && doc.program.key !== program.key) {
    add(`This export is for the program “${doc.program.name}”; this app runs “${program.name}”.`);
    return errors;
  }
  const bundle = new Map(program.workouts.map((w) => [w.key, w]));
  for (const s of doc.program_slots) {
    if (s.program_key !== program.key || s.version_label !== program.versionLabel) continue;
    const w = bundle.get(s.workout_key);
    const slot = w?.exercises.findIndex((e) => e.slotKey === s.slot_key) ?? -1;
    if (!w || slot < 0) add(`Slot ${s.slot_key} of ${s.workout_key} is not in this app’s program.`);
    else if (slot + 1 !== s.position || w.exercises[slot].name !== s.exercise_name) {
      add(`Slot ${s.slot_key} differs: the export plans ${s.exercise_name} at position ${s.position}.`);
    }
  }
  const names = new Map(doc.exercises.map((e) => [e.id, exerciseNameKey(e.name)]));
  for (const w of doc.workouts) {
    const where = `Workout on ${w.performed_on}`;
    if (!w.origin) {
      if (w.substitutions.length) add(`${where}: an unplanned workout cannot change a slot.`);
      if (w.sets.some((s) => s.placement?.slot_key)) add(`${where}: an unplanned workout has no slots.`);
      continue;
    }
    if (w.origin.program_key !== program.key || w.origin.version_label !== program.versionLabel) {
      add(`${where} was planned from ${w.origin.program_key} ${w.origin.version_label ?? ''}, not this app’s program.`);
      continue;
    }
    const plan = bundle.get(w.origin.workout_key);
    if (!plan) {
      add(`${where}: no workout ${w.origin.workout_key} in this app’s program.`);
      continue;
    }
    const performed = new Map(plan.exercises.map((e) => [e.slotKey, exerciseNameKey(e.name)]));
    for (const sub of w.substitutions) {
      if (!performed.has(sub.slot_key)) add(`${where}: slot ${sub.slot_key} is not part of ${plan.name}.`);
      else performed.set(sub.slot_key, names.get(sub.exercise_id) ?? '');
    }
    for (const s of w.sets) {
      const slot = s.placement?.slot_key;
      if (!slot) continue;
      if (!performed.has(slot)) add(`${where}: a set is placed in ${slot}, which is not part of ${plan.name}.`);
      else if (performed.get(slot) !== names.get(s.exercise_id)) add(`${where}: a set in ${slot} is not that slot’s exercise.`);
    }
  }
  return errors;
}

export async function planImport(db: Db, doc: ExportDocument, program: ProgramFacts = PROGRAM): Promise<ImportPlan> {
  const errors = checkAgainstProgram(doc, program);
  if (errors.length) return { ok: false, errors };
  const dates = [
    ...doc.workouts.map((w) => w.performed_on),
    ...doc.bodyweight.map((b) => b.measured_on),
    ...doc.nutrition_days.map((n) => n.logged_on),
  ].sort();
  return {
    ok: true,
    programMatch: doc.program?.program_json_sha256 === PROGRAM_JSON_SHA256 ? 'exact' : 'compatible',
    deviceHasData: await deviceHasData(db),
    summary: {
      workouts: doc.workouts.length,
      completed: doc.workouts.filter((w) => w.status === 'complete').length,
      sets: doc.workouts.reduce((n, w) => n + w.sets.length, 0),
      bodyweight: doc.bodyweight.length,
      nutritionDays: doc.nutrition_days.length,
      targets: doc.macro_targets.length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      blockStart: doc.training_block?.start_on ?? null,
    },
  };
}

async function wipe(db: Db) {
  await db.run("UPDATE workout SET status = 'draft' WHERE status = 'complete'");
  await db.run('DELETE FROM workout');
  await db.run('DELETE FROM bodyweight_entry');
  await db.run('DELETE FROM nutrition_day');
  await db.run("INSERT INTO maintenance (key) VALUES ('replace-all')");
  await db.run('DELETE FROM macro_target');
  await db.run("DELETE FROM maintenance WHERE key = 'replace-all'");
  await db.run('DELETE FROM training_block');
  await db.run('DELETE FROM imported_record');
  await db.run('DELETE FROM exercise');
}

/**
 * Imports `doc`. `mode` must be 'into-empty' unless the lifter explicitly chose to replace
 * this device's data. Throws (and writes nothing) when refused or when anything fails.
 */
export async function runImport(
  db: Db,
  doc: ExportDocument,
  mode: 'into-empty' | 'replace',
  now: string,
  program: ProgramFacts = PROGRAM,
): Promise<void> {
  const plan = await planImport(db, doc, program);
  if (!plan.ok) throw new ImportRefused(plan.errors.join(' '));
  await db.transaction(async () => {
    const hasData = await deviceHasData(db);
    if (hasData && mode !== 'replace') {
      throw new ImportRefused('This iPhone already holds data. Importing needs an empty app, or an explicit replace.');
    }
    if (mode === 'replace') {
      const current = await exportDevice(db, now, program);
      await db.run('INSERT INTO replaced_data (replaced_at, export_json) VALUES (?, ?)', [now, JSON.stringify(current)]);
      await wipe(db);
    }

    const exerciseId = new Map<string, number>();
    for (const e of doc.exercises) {
      const key = exerciseNameKey(e.name);
      const existing = await db.first<{ id: number }>(
        "SELECT id FROM exercise WHERE name_key = ? AND coalesce(lower(trim(equipment_label)), '') = ?",
        [key, (e.equipment_label ?? '').trim().toLowerCase()],
      );
      if (existing) {
        exerciseId.set(e.id, existing.id);
        continue;
      }
      const r = await db.run(
        'INSERT INTO exercise (name, name_key, equipment_label, is_active, created_at) VALUES (?, ?, ?, ?, ?)',
        [e.name, key, e.equipment_label, e.is_active ? 1 : 0, e.created_at_utc],
      );
      exerciseId.set(e.id, r.lastInsertRowId);
    }
    const ex = (id: string) => {
      const mapped = exerciseId.get(id);
      if (mapped === undefined) throw new ImportRefused(`Unknown exercise ${id}.`);
      return mapped;
    };

    if (doc.training_block) {
      await db.run('INSERT INTO training_block (program_key, start_on, set_at) VALUES (?, ?, ?)', [
        program.key,
        doc.training_block.start_on,
        doc.training_block.set_at_utc,
      ]);
    }

    for (const w of doc.workouts) {
      // Inserted as a draft (sets and placements need one), completed at the end.
      const r = await db.run(
        `INSERT INTO workout (performed_on, performed_time_local, program_key, workout_key, status, notes, entered_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [
          w.performed_on,
          w.performed_time_local,
          w.origin ? program.key : null,
          w.origin?.workout_key ?? null,
          w.notes,
          w.entered_at_utc,
          w.updated_at_utc,
        ],
      );
      const id = r.lastInsertRowId;
      for (const s of w.substitutions) {
        await db.run(
          'INSERT INTO workout_slot_substitution (workout_id, slot_key, exercise_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [id, s.slot_key, ex(s.exercise_id), s.created_at_utc, s.updated_at_utc],
        );
      }
      for (const s of w.sets) {
        const set = await db.run(
          `INSERT INTO performed_set (workout_id, exercise_id, set_order, set_type, load_g, reps, rir, notes, entered_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, ex(s.exercise_id), s.set_order, s.set_type, s.load_g, s.reps, s.rir, s.notes, s.entered_at_utc, s.updated_at_utc],
        );
        if (s.placement) {
          await db.run('INSERT INTO performed_set_slot (set_id, workout_id, slot_key) VALUES (?, ?, ?)', [
            set.lastInsertRowId,
            id,
            s.placement.slot_key,
          ]);
        }
      }
      if (w.status === 'complete') await db.run("UPDATE workout SET status = 'complete' WHERE id = ?", [id]);
    }

    for (const b of doc.bodyweight) {
      await db.run(
        'INSERT INTO bodyweight_entry (measured_on, bodyweight_g, notes, entered_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [b.measured_on, b.bodyweight_g, b.notes, b.entered_at_utc, b.updated_at_utc],
      );
    }
    for (const n of doc.nutrition_days) {
      await db.run(
        'INSERT INTO nutrition_day (logged_on, protein_g, carbs_g, fat_g, notes, entered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [n.logged_on, n.protein_g, n.carbs_g, n.fat_g, n.notes, n.entered_at_utc, n.updated_at_utc],
      );
    }
    // Append-only, in the order they were set: "latest set wins" ties keep their meaning.
    for (const t of doc.macro_targets) {
      await db.run(
        'INSERT INTO macro_target (effective_on, protein_g, carbs_g, fat_g, notes, set_at) VALUES (?, ?, ?, ?, ?, ?)',
        [t.effective_on, t.protein_g, t.carbs_g, t.fat_g, t.notes, t.set_at_utc],
      );
    }
    for (const [kind, rows] of Object.entries(doc.archive)) {
      for (const row of rows) {
        await db.run('INSERT INTO imported_record (kind, payload_json, imported_at) VALUES (?, ?, ?)', [
          kind,
          JSON.stringify(row),
          now,
        ]);
      }
    }
    await db.run(
      `INSERT INTO import_log (imported_at, format, format_version, exported_at, source_sha256, mode, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        now,
        doc.format,
        doc.format_version,
        doc.exported_at_utc,
        doc.source.database_sha256 ?? `${doc.source.app}:unhashed`,
        mode,
        JSON.stringify({ ...plan.summary, programMatch: plan.programMatch, source: doc.source }),
      ],
    );
  });
}
