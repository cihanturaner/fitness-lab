import { parseIsoDate } from '@/domain/dates';

/**
 * `fitness-lab-export-v1.json`: the versioned file that carries Fitness Lab data between the
 * desktop app (tools/export/fitness_lab_export.py) and this app, in both directions. This
 * module only reads and checks its shape; it never touches the database. Every value is
 * checked before anything is imported, so a malformed file changes nothing.
 */

export const EXPORT_FORMAT = 'fitness-lab-export';
export const EXPORT_FORMAT_VERSION = 1;

type Id = string;
type SetType = 'warmup' | 'working' | 'backoff';

export type ExportSet = {
  id: Id;
  exercise_id: Id;
  set_order: number;
  set_type: SetType | null;
  load_g: number | null;
  reps: number | null;
  rir: number | null;
  notes: string | null;
  entered_at_utc: string;
  updated_at_utc: string;
  /** null: no placement recorded; { slot_key: null }: recorded as extra work. */
  placement: { slot_key: string | null } | null;
};

export type ExportWorkout = {
  id: Id;
  performed_on: string;
  performed_time_local: string | null;
  status: 'draft' | 'complete';
  notes: string | null;
  entered_at_utc: string;
  updated_at_utc: string;
  origin: { program_key: string; version_label: string | null; workout_key: string } | null;
  substitutions: { slot_key: string; exercise_id: Id; created_at_utc: string; updated_at_utc: string }[];
  sets: ExportSet[];
};

export type ExportDocument = {
  format: typeof EXPORT_FORMAT;
  format_version: typeof EXPORT_FORMAT_VERSION;
  exported_at_utc: string;
  source: { app: string; schema_version: number; database_sha256: string | null };
  program: {
    key: string;
    name: string;
    version_label: string | null;
    duration_weeks: number | null;
    program_json_sha256: string;
  } | null;
  program_slots: {
    program_key: string;
    version_label: string | null;
    workout_key: string;
    workout_name: string;
    slot_key: string;
    position: number;
    exercise_name: string;
  }[];
  training_block: { start_on: string; set_at_utc: string } | null;
  exercises: { id: Id; name: string; equipment_label: string | null; is_active: boolean; created_at_utc: string }[];
  workouts: ExportWorkout[];
  bodyweight: { measured_on: string; bodyweight_g: number; notes: string | null; entered_at_utc: string; updated_at_utc: string }[];
  nutrition_days: {
    logged_on: string;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    notes: string | null;
    entered_at_utc: string;
    updated_at_utc: string;
  }[];
  macro_targets: {
    id: Id;
    effective_on: string;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    notes: string | null;
    set_at_utc: string;
    from_calorie_target_id?: Id | null;
  }[];
  archive: Record<string, Record<string, unknown>[]>;
  counts?: Record<string, number>;
};

export type ParseResult = { ok: true; document: ExportDocument } | { ok: false; errors: string[] };

const MAX_ERRORS = 8;

/** A checker that records the first problems it finds, with where they are. */
class Check {
  errors: string[] = [];
  fail(path: string, what: string) {
    if (this.errors.length < MAX_ERRORS) this.errors.push(`${path}: ${what}`);
    return false;
  }
  object(path: string, v: unknown): v is Record<string, unknown> {
    return (typeof v === 'object' && v !== null && !Array.isArray(v)) || this.fail(path, 'expected an object');
  }
  array(path: string, v: unknown): v is unknown[] {
    return Array.isArray(v) || this.fail(path, 'expected a list');
  }
  string(path: string, v: unknown, nullable = false): boolean {
    if (nullable && v === null) return true;
    return (typeof v === 'string' && v.length <= 10_000) || this.fail(path, 'expected text');
  }
  int(path: string, v: unknown, min: number, max: number, nullable = false): boolean {
    if (nullable && v === null) return true;
    return (
      (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) ||
      this.fail(path, `expected a whole number ${min}–${max}${nullable ? ' or null' : ''}`)
    );
  }
  date(path: string, v: unknown): boolean {
    if (typeof v !== 'string') return this.fail(path, 'expected a date');
    try {
      parseIsoDate(v);
      return true;
    } catch {
      return this.fail(path, `not a calendar date (${v})`);
    }
  }
  oneOf<T>(path: string, v: unknown, options: readonly T[]): boolean {
    return options.includes(v as T) || this.fail(path, `expected one of ${options.map(String).join(', ')}`);
  }
}

const INT = 2 ** 31;

/** Parses and checks the file's text. Nothing is trusted until this returns ok. */
export function parseExport(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This file is not JSON.'] };
  }
  const c = new Check();
  if (!c.object('file', raw)) return { ok: false, errors: c.errors };
  if (raw.format !== EXPORT_FORMAT) return { ok: false, errors: ['This is not a Fitness Lab export.'] };
  if (raw.format_version !== EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [`Export format version ${String(raw.format_version)} is not supported; this app reads version ${EXPORT_FORMAT_VERSION}.`],
    };
  }
  c.string('exported_at_utc', raw.exported_at_utc);
  if (c.object('source', raw.source)) {
    c.string('source.app', raw.source.app);
    c.int('source.schema_version', raw.source.schema_version, 1, 10_000);
    c.string('source.database_sha256', raw.source.database_sha256, true);
  }
  if (raw.program !== null && c.object('program', raw.program)) {
    c.string('program.key', raw.program.key);
    c.string('program.name', raw.program.name);
    c.string('program.version_label', raw.program.version_label, true);
    c.string('program.program_json_sha256', raw.program.program_json_sha256);
  }
  if (c.array('program_slots', raw.program_slots)) {
    raw.program_slots.forEach((s, i) => {
      const p = `program_slots[${i}]`;
      if (!c.object(p, s)) return;
      c.string(`${p}.program_key`, s.program_key);
      c.string(`${p}.version_label`, s.version_label, true);
      c.string(`${p}.workout_key`, s.workout_key);
      c.string(`${p}.slot_key`, s.slot_key);
      c.int(`${p}.position`, s.position, 1, 1000);
      c.string(`${p}.exercise_name`, s.exercise_name);
    });
  }
  if (raw.training_block !== null && c.object('training_block', raw.training_block)) {
    c.date('training_block.start_on', raw.training_block.start_on);
    c.string('training_block.set_at_utc', raw.training_block.set_at_utc);
  }

  const exerciseIds = new Set<string>();
  if (c.array('exercises', raw.exercises)) {
    raw.exercises.forEach((e, i) => {
      const p = `exercises[${i}]`;
      if (!c.object(p, e)) return;
      if (c.string(`${p}.id`, e.id)) {
        if (exerciseIds.has(e.id as string)) c.fail(`${p}.id`, 'appears twice');
        exerciseIds.add(e.id as string);
      }
      if (typeof e.name !== 'string' || e.name.trim() === '' || e.name.length > 200) c.fail(`${p}.name`, 'expected a name');
      c.string(`${p}.equipment_label`, e.equipment_label, true);
      if (typeof e.is_active !== 'boolean') c.fail(`${p}.is_active`, 'expected true or false');
      c.string(`${p}.created_at_utc`, e.created_at_utc);
    });
  }

  if (c.array('workouts', raw.workouts)) {
    const workoutIds = new Set<string>();
    const setIds = new Set<string>();
    raw.workouts.forEach((w, i) => {
      const p = `workouts[${i}]`;
      if (!c.object(p, w)) return;
      if (c.string(`${p}.id`, w.id)) {
        if (workoutIds.has(w.id as string)) c.fail(`${p}.id`, 'appears twice');
        workoutIds.add(w.id as string);
      }
      c.date(`${p}.performed_on`, w.performed_on);
      if (w.performed_time_local !== null && !(typeof w.performed_time_local === 'string' && /^[0-2]\d:[0-5]\d$/.test(w.performed_time_local))) {
        c.fail(`${p}.performed_time_local`, 'expected HH:MM or null');
      }
      c.oneOf(`${p}.status`, w.status, ['draft', 'complete']);
      c.string(`${p}.notes`, w.notes, true);
      c.string(`${p}.entered_at_utc`, w.entered_at_utc);
      c.string(`${p}.updated_at_utc`, w.updated_at_utc);
      if (w.origin !== null && c.object(`${p}.origin`, w.origin)) {
        c.string(`${p}.origin.program_key`, w.origin.program_key);
        c.string(`${p}.origin.version_label`, w.origin.version_label, true);
        c.string(`${p}.origin.workout_key`, w.origin.workout_key);
      }
      if (c.array(`${p}.substitutions`, w.substitutions)) {
        const slots = new Set<string>();
        w.substitutions.forEach((s, j) => {
          const q = `${p}.substitutions[${j}]`;
          if (!c.object(q, s)) return;
          if (c.string(`${q}.slot_key`, s.slot_key)) {
            if (slots.has(s.slot_key as string)) c.fail(`${q}.slot_key`, 'changed twice');
            slots.add(s.slot_key as string);
          }
          if (!exerciseIds.has(s.exercise_id as string)) c.fail(`${q}.exercise_id`, 'names no exported exercise');
          c.string(`${q}.created_at_utc`, s.created_at_utc);
          c.string(`${q}.updated_at_utc`, s.updated_at_utc);
        });
      }
      if (c.array(`${p}.sets`, w.sets)) {
        const orders = new Set<number>();
        w.sets.forEach((s, j) => {
          const q = `${p}.sets[${j}]`;
          if (!c.object(q, s)) return;
          if (c.string(`${q}.id`, s.id)) {
            if (setIds.has(s.id as string)) c.fail(`${q}.id`, 'appears twice');
            setIds.add(s.id as string);
          }
          if (!exerciseIds.has(s.exercise_id as string)) c.fail(`${q}.exercise_id`, 'names no exported exercise');
          if (c.int(`${q}.set_order`, s.set_order, 1, 100_000)) {
            if (orders.has(s.set_order as number)) c.fail(`${q}.set_order`, 'appears twice in the workout');
            orders.add(s.set_order as number);
          }
          c.oneOf(`${q}.set_type`, s.set_type, ['warmup', 'working', 'backoff', null]);
          c.int(`${q}.load_g`, s.load_g, 0, INT, true);
          c.int(`${q}.reps`, s.reps, 0, INT, true);
          c.int(`${q}.rir`, s.rir, -INT, INT, true);
          c.string(`${q}.notes`, s.notes, true);
          c.string(`${q}.entered_at_utc`, s.entered_at_utc);
          c.string(`${q}.updated_at_utc`, s.updated_at_utc);
          if (s.placement !== null && c.object(`${q}.placement`, s.placement)) {
            c.string(`${q}.placement.slot_key`, s.placement.slot_key, true);
          }
        });
      }
    });
  }

  const unique = (path: string, list: unknown, key: string, each: (p: string, row: Record<string, unknown>) => void) => {
    if (!c.array(path, list)) return;
    const seen = new Set<unknown>();
    list.forEach((row, i) => {
      const p = `${path}[${i}]`;
      if (!c.object(p, row)) return;
      if (seen.has(row[key])) c.fail(`${p}.${key}`, 'appears twice');
      seen.add(row[key]);
      each(p, row);
    });
  };
  unique('bodyweight', raw.bodyweight, 'measured_on', (p, b) => {
    c.date(`${p}.measured_on`, b.measured_on);
    c.int(`${p}.bodyweight_g`, b.bodyweight_g, 20_000, 300_000);
    c.string(`${p}.notes`, b.notes, true);
  });
  unique('nutrition_days', raw.nutrition_days, 'logged_on', (p, n) => {
    c.date(`${p}.logged_on`, n.logged_on);
    for (const m of ['protein_g', 'carbs_g', 'fat_g']) c.int(`${p}.${m}`, n[m], 0, 1500, true);
    if (n.protein_g === null && n.carbs_g === null && n.fat_g === null) c.fail(p, 'records no macro');
    c.string(`${p}.notes`, n.notes, true);
  });
  unique('macro_targets', raw.macro_targets, 'id', (p, t) => {
    c.date(`${p}.effective_on`, t.effective_on);
    for (const m of ['protein_g', 'carbs_g', 'fat_g']) c.int(`${p}.${m}`, t[m], 0, 2500);
    if (Number(t.protein_g) + Number(t.carbs_g) + Number(t.fat_g) <= 0) c.fail(p, 'a target needs at least one gram');
    c.string(`${p}.notes`, t.notes, true);
    c.string(`${p}.set_at_utc`, t.set_at_utc);
  });
  if (c.object('archive', raw.archive)) {
    for (const [kind, rows] of Object.entries(raw.archive)) {
      if (c.array(`archive.${kind}`, rows)) rows.forEach((r, i) => c.object(`archive.${kind}[${i}]`, r));
    }
  }

  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, document: raw as ExportDocument };
}
