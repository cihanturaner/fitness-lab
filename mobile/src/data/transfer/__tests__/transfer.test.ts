import { describe, expect, it } from '@jest/globals';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { groupSets } from '@/domain/session';

import { fixedClock } from '../../clock';
import type { Db } from '../../db/database';
import { openTestDatabase } from '../../db/test-database';
import { loadHomeFacts } from '../../facts-source';
import { loadHistoryPage } from '../../history-source';
import { PROGRAM, PROGRAM_JSON_SHA256 } from '../../program';
import { saveBodyweight } from '../../repo/bodyweight';
import { macroTargets } from '../../repo/nutrition';
import { loadSession, workoutsBetween } from '../../repo/workouts';
import { exportDevice } from '../export';
import { parseExport, type ExportDocument } from '../format';
import { deviceHasData, ImportRefused, planImport, runImport } from '../import';

const SAMPLE_TEXT = readFileSync(join(__dirname, '../../fixtures/desktop-export-v1.json'), 'utf8');
const sample = (): ExportDocument => JSON.parse(SAMPLE_TEXT) as ExportDocument;
const clock = fixedClock('2026-10-09');

function parsed(doc: unknown): ExportDocument {
  const r = parseExport(JSON.stringify(doc));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.document;
}

async function imported() {
  const db = await openTestDatabase();
  await runImport(db, parsed(sample()), 'into-empty', clock.now());
  return db;
}

/** Everything recorded, with exercises by name instead of ids — comparable across databases. */
function semantic(doc: ExportDocument) {
  const name = new Map(doc.exercises.map((e) => [e.id, e.name]));
  return {
    block: doc.training_block?.start_on ?? null,
    workouts: doc.workouts.map((w) => ({
      on: w.performed_on,
      status: w.status,
      key: w.origin?.workout_key ?? null,
      subs: w.substitutions.map((s) => [s.slot_key, name.get(s.exercise_id)]),
      sets: w.sets.map((s) => [s.set_order, name.get(s.exercise_id), s.set_type, s.load_g, s.reps, s.rir, s.placement]),
    })),
    bodyweight: doc.bodyweight.map((b) => [b.measured_on, b.bodyweight_g, b.notes]),
    nutrition: doc.nutrition_days.map((n) => [n.logged_on, n.protein_g, n.carbs_g, n.fat_g, n.notes]),
    targets: doc.macro_targets.map((t) => [t.effective_on, t.protein_g, t.carbs_g, t.fat_g, t.notes, t.set_at_utc]),
  };
}

describe('the bundled program is the package the desktop records', () => {
  it('has the package file’s sha256', () => {
    const bytes = readFileSync(join(__dirname, '../../../../../programs/advanced-natural-12w/package/program.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PROGRAM_JSON_SHA256);
  });
});

describe('parseExport: nothing is trusted until checked', () => {
  it('accepts the desktop exporter’s output', () => {
    const r = parseExport(SAMPLE_TEXT);
    expect(r.ok).toBe(true);
  });

  it('rejects a truncated or foreign file cleanly', () => {
    expect(parseExport(SAMPLE_TEXT.slice(0, 500))).toEqual({ ok: false, errors: ['This file is not JSON.'] });
    expect(parseExport('{"format":"something-else"}')).toEqual({ ok: false, errors: ['This is not a Fitness Lab export.'] });
    const v2 = parseExport(JSON.stringify({ ...sample(), format_version: 2 }));
    expect(v2).toEqual({ ok: false, errors: ['Export format version 2 is not supported; this app reads version 1.'] });
  });

  it('names what is wrong: bad dates, dangling references, duplicates, out-of-range values', () => {
    const doc = sample();
    doc.workouts[1].performed_on = '2026-02-30';
    doc.workouts[1].sets[0].exercise_id = 'nope';
    doc.workouts[1].sets[1].set_order = doc.workouts[1].sets[0].set_order;
    doc.bodyweight[0].bodyweight_g = 19_999;
    const r = parseExport(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/workouts\[1\]\.performed_on: not a calendar date/),
        expect.stringMatching(/workouts\[1\]\.sets\[0\]\.exercise_id: names no exported exercise/),
        expect.stringMatching(/sets\[1\]\.set_order: appears twice/),
        expect.stringMatching(/bodyweight\[0\]\.bodyweight_g/),
      ]),
    );
  });
});

describe('planImport: slots must be this app’s slots', () => {
  it('summarises a valid export and matches the program exactly', async () => {
    const db = await openTestDatabase();
    const plan = await planImport(db, parsed(sample()));
    expect(plan).toEqual({
      ok: true,
      programMatch: 'exact',
      deviceHasData: false,
      summary: {
        workouts: 3,
        completed: 2,
        sets: 10,
        bodyweight: 3,
        nutritionDays: 2,
        targets: 2,
        firstDate: '2026-10-03',
        lastDate: '2026-10-08',
        blockStart: '2026-10-01',
      },
    });
  });

  it('refuses another program, an unknown slot, or a set placed in a slot of another exercise', async () => {
    const db = await openTestDatabase();
    const other = sample();
    other.program!.key = 'some-other-program';
    expect(await planImport(db, parsed(other))).toMatchObject({ ok: false });

    const moved = sample();
    moved.program_slots[0].exercise_name = 'Barbell Bench Press';
    expect(await planImport(db, parsed(moved))).toMatchObject({ ok: false, errors: [expect.stringMatching(/Slot upper_a\.01 differs/)] });

    const misplaced = sample();
    misplaced.workouts.find((w) => w.id === 'w-1')!.sets.find((s) => s.id === 's-01')!.placement = { slot_key: 'upper_a.02' };
    expect(await planImport(db, parsed(misplaced))).toMatchObject({ ok: false, errors: [expect.stringMatching(/not that slot’s exercise/)] });

    const unknown = sample();
    unknown.workouts.find((w) => w.id === 'w-1')!.substitutions[0].slot_key = 'upper_a.99';
    expect(await planImport(db, parsed(unknown))).toMatchObject({ ok: false });
  });
});

describe('runImport', () => {
  it('imports every fact with its dates, statuses and slots', async () => {
    const db = await imported();
    const workouts = await workoutsBetween(db, '2026-01-01', '2026-12-31');
    expect(workouts.map((w) => [w.performedOn, w.workoutKey, w.status])).toEqual([
      ['2026-10-03', null, 'complete'],
      ['2026-10-05', 'upper_a', 'complete'],
      ['2026-10-08', 'upper_b', 'draft'],
    ]);
    const home = await loadHomeFacts(db, '2026-10-08');
    expect(home.block).toMatchObject({ start: '2026-10-01' });
    expect(home.bodyweight.at(-1)).toEqual({ date: '2026-10-08', grams: 82_400 });
    expect((await macroTargets(db)).map((t) => [t.effectiveOn, t.carbs, t.notes])).toEqual([
      ['2026-10-01', 310, null],
      ['2026-10-06', 348, 'Weeks 1–2 exception: illness'],
    ]);
    const history = await loadHistoryPage(db);
    expect(history.days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03']);
  });

  it('keeps duplicate-exercise slots independent (V3.3.1 regression): 06 and 07 never merge', async () => {
    const db = await imported();
    const upperA = (await workoutsBetween(db, '2026-10-05', '2026-10-05'))[0];
    const session = await loadSession(db, upperA.id);
    const s06 = session.slots.find((s) => s.slotKey === 'upper_a.06')!;
    const s07 = session.slots.find((s) => s.slotKey === 'upper_a.07')!;
    expect([s06.performedName, s07.performedName, s07.changed]).toEqual(['Cable Lateral Raise', 'Cable Lateral Raise', true]);
    expect(s06.performedExerciseId).toBe(s07.performedExerciseId);
    const grouped = groupSets(session.slots, session.sets);
    expect(grouped.bySlot.get('upper_a.06')?.map((s) => s.reps)).toEqual([15]);
    expect(grouped.bySlot.get('upper_a.07')?.map((s) => s.reps)).toEqual([18, 16]);
    // a set from before placements existed falls to the first slot of its exercise
    expect(grouped.bySlot.get('upper_a.09')?.map((s) => s.reps)).toEqual([12]);
    // recorded extra work stays extra work
    expect(grouped.extra.map((g) => g.sets.map((s) => s.reps))).toEqual([[15]]);
  });

  it('round-trips: device export → import elsewhere → export holds the same facts', async () => {
    const first = await imported();
    const exported = await exportDevice(first, clock.now());
    expect(semantic(exported)).toEqual(semantic(parsed(sample())));
    const second = await openTestDatabase();
    await runImport(second, parsed(exported), 'into-empty', clock.now());
    expect(semantic(await exportDevice(second, clock.now()))).toEqual(semantic(exported));
  });

  it('refuses to merge into a device that holds data, and changes nothing', async () => {
    const db = await openTestDatabase();
    await saveBodyweight(db, '2026-09-30', 83_000, clock.now());
    expect(await deviceHasData(db)).toBe(true);
    await expect(runImport(db, parsed(sample()), 'into-empty', clock.now())).rejects.toBeInstanceOf(ImportRefused);
    expect(await db.all('SELECT measured_on FROM bodyweight_entry')).toEqual([{ measured_on: '2026-09-30' }]);
    expect(await db.all('SELECT * FROM workout')).toEqual([]);
  });

  it('replaces only on explicit request, keeping the replaced data as a V1 export', async () => {
    const db = await openTestDatabase();
    await saveBodyweight(db, '2026-09-30', 83_000, clock.now());
    await runImport(db, parsed(sample()), 'replace', clock.now());
    expect((await db.all<{ measured_on: string }>('SELECT measured_on FROM bodyweight_entry')).map((r) => r.measured_on)).toEqual([
      '2026-10-04',
      '2026-10-06',
      '2026-10-08',
    ]);
    const kept = await db.all<{ export_json: string }>('SELECT export_json FROM replaced_data');
    const backup = parseExport(kept[0].export_json);
    expect(backup.ok && backup.document.bodyweight).toEqual([
      expect.objectContaining({ measured_on: '2026-09-30', bodyweight_g: 83_000 }),
    ]);
  });

  it('rolls back completely when anything fails part-way (nothing half-imported)', async () => {
    const db = await openTestDatabase();
    let writes = 0;
    const failing: Db = {
      ...db,
      run: async (sql, params) => {
        if (/INSERT INTO performed_set /.test(sql) && ++writes === 4) throw new Error('disk I/O error (simulated)');
        return db.run(sql, params);
      },
    };
    await expect(runImport(failing, parsed(sample()), 'into-empty', clock.now())).rejects.toThrow('simulated');
    for (const table of ['exercise', 'workout', 'performed_set', 'performed_set_slot', 'training_block', 'bodyweight_entry', 'import_log']) {
      expect([table, await db.all(`SELECT * FROM ${table}`)]).toEqual([table, []]);
    }
    // and the same file imports cleanly afterwards
    await runImport(db, parsed(sample()), 'into-empty', clock.now());
    expect((await db.all('SELECT * FROM performed_set')).length).toBe(10);
  });

  it('keeps what this app does not use (the desktop archive) and logs the import', async () => {
    const doc = sample();
    doc.archive.controller_event = [{ id: 'ce-1', block_week: 3, user_choice: 'KEPT' }];
    const db = await openTestDatabase();
    await runImport(db, parsed(doc), 'into-empty', clock.now());
    expect(await db.all('SELECT kind, payload_json FROM imported_record')).toEqual([
      { kind: 'controller_event', payload_json: '{"id":"ce-1","block_week":3,"user_choice":"KEPT"}' },
    ]);
    const log = await db.all<{ mode: string; format_version: number }>('SELECT mode, format_version FROM import_log');
    expect(log).toEqual([{ mode: 'into-empty', format_version: 1 }]);
    expect(PROGRAM.key).toBe('advanced-natural-12w');
  });
});
