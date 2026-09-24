import { describe, expect, it } from '@jest/globals';

import { parseKgToGrams } from '../bodyweight';
import { parseMacroText, targetError, targetOn, type TargetRecord } from '../nutrition';
import {
  completionBlockers,
  groupSets,
  nextPlannedSet,
  placeSets,
  workSetTotals,
  type PerformedSet,
  type SlotIdentity,
} from '../session';
import { approvedSubstitutes, exerciseNameKey, typedExerciseName } from '../substitutes';
import { formatLb, gramsToLbHundredths, lbHundredthsToGrams, lbTextToGrams, parseLbHundredths } from '../units';

describe('pounds ↔ grams (exact, desktop units.py)', () => {
  it('converts entered pounds to whole grams, half-up', () => {
    expect(lbTextToGrams('225')).toBe(102_058); // 225 × 453.59237 = 102058.28
    expect(lbTextToGrams('72.75')).toBe(32_999); // 32998.84
    expect(lbTextToGrams('2.5')).toBe(1_134); // 1133.98
    expect(lbTextToGrams('0')).toBe(0);
    expect(lbTextToGrams('72,5')).toBe(lbTextToGrams('72.5'));
  });

  it('reads every entered value back exactly', () => {
    for (let h = 0; h <= 60_000; h += 7) {
      expect(gramsToLbHundredths(lbHundredthsToGrams(h))).toBe(h);
    }
    expect(formatLb(lbTextToGrams('225')!)).toBe('225');
    expect(formatLb(lbTextToGrams('72.75')!)).toBe('72.75');
    expect(formatLb(lbTextToGrams('72.50')!)).toBe('72.5');
    expect(formatLb(33_000)).toBe('72.75'); // a stored mass keeps its meaning
  });

  it('refuses anything that is not a load of at most 0.01 lb precision', () => {
    for (const bad of ['', '-5', '1e3', '72.555', 'abc', '10000', '.5']) {
      expect([bad, lbTextToGrams(bad)]).toEqual([bad, null]);
    }
    expect(parseLbHundredths('9999.99')).toBe(999_999);
  });
});

describe('approved substitutes (desktop substitutes.py)', () => {
  it('reads the notes line, keeping a trailing condition apart from the name', () => {
    const notes = 'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Another Seated/Hip-Flexed Leg Curl, Lying Leg Curl if unavailable/intolerant.';
    expect(approvedSubstitutes(notes)).toEqual([
      { name: 'Another Seated/Hip-Flexed Leg Curl', condition: null },
      { name: 'Lying Leg Curl', condition: 'if unavailable/intolerant' },
    ]);
    expect(approvedSubstitutes('Rest: 90 s.')).toEqual([]);
    expect(approvedSubstitutes(null)).toEqual([]);
  });

  it('title-cases an all-lowercase typed name and keeps any other casing', () => {
    expect(typedExerciseName('  triceps   curl ')).toEqual({ ok: true, name: 'Triceps Curl' });
    expect(typedExerciseName('ez-bar curl (wide)')).toEqual({ ok: true, name: 'Ez-Bar Curl (Wide)' });
    expect(typedExerciseName('EZ-bar curl')).toEqual({ ok: true, name: 'EZ-bar curl' });
    expect(typedExerciseName('   ').ok).toBe(false);
    expect(typedExerciseName('x'.repeat(81)).ok).toBe(false);
    expect(exerciseNameKey('Triceps  CURL')).toBe(exerciseNameKey('triceps curl'));
  });
});

const set = (id: number, exerciseId: number, placement: string | null | undefined, extra: Partial<PerformedSet> = {}): PerformedSet => ({
  id,
  exerciseId,
  setOrder: id,
  setType: 'working',
  loadG: 50_000,
  reps: 8,
  rir: 1,
  placement,
  ...extra,
});

// Cable Lateral Raise (exercise 7) is planned in two slots of one workout.
const slots: (SlotIdentity & { plannedSets: number })[] = [
  { slotKey: 'w.01', position: 1, plannedExerciseId: 1, performedExerciseId: 1, plannedSets: 2 },
  { slotKey: 'w.02', position: 2, plannedExerciseId: 7, performedExerciseId: 7, plannedSets: 3 },
  { slotKey: 'w.03', position: 3, plannedExerciseId: 7, performedExerciseId: 7, plannedSets: 2 },
];

describe('slot identity (desktop placement.py, migration 0008)', () => {
  it('keeps two slots performed as the same exercise independent', () => {
    const sets = [set(1, 7, 'w.03'), set(2, 7, 'w.02'), set(3, 7, 'w.03')];
    const grouped = groupSets(slots, sets);
    expect(grouped.bySlot.get('w.02')?.map((s) => s.id)).toEqual([2]);
    expect(grouped.bySlot.get('w.03')?.map((s) => s.id)).toEqual([1, 3]);
    expect(grouped.extra).toEqual([]);
  });

  it('places a legacy set (no placement) in the first slot performed as its exercise', () => {
    expect(placeSets(slots, [set(1, 7, undefined)]).get(1)).toBe('w.02');
    expect(placeSets(slots, [set(1, 99, undefined)]).get(1)).toBeNull();
  });

  it('keeps recorded extra work extra, and an unknown slot is extra work', () => {
    const placed = placeSets(slots, [set(1, 7, null), set(2, 7, 'gone.09')]);
    expect(placed.get(1)).toBeNull();
    expect(placed.get(2)).toBeNull();
    expect(groupSets(slots, [set(1, 7, null)]).extra).toEqual([{ exerciseId: 7, sets: [set(1, 7, null)] }]);
  });

  it('follows a substitution: the first-slot rule uses the performed exercise', () => {
    const changed = slots.map((s) => (s.slotKey === 'w.02' ? { ...s, performedExerciseId: 8 } : s));
    expect(placeSets(changed, [set(1, 7, undefined)]).get(1)).toBe('w.03');
  });

  it('finds the next planned set slot by slot, never pooling a shared exercise', () => {
    expect(nextPlannedSet(slots, [])).toEqual({ slotKey: 'w.01', setNumber: 1, setCount: 2 });
    const sets = [set(1, 1, 'w.01'), set(2, 1, 'w.01'), set(3, 7, 'w.03'), set(4, 7, 'w.03')];
    expect(nextPlannedSet(slots, sets)).toEqual({ slotKey: 'w.02', setNumber: 1, setCount: 3 });
  });
});

describe('completion (desktop completion.py)', () => {
  it('blocks with no sets or a set without reps; missing load or RIR never blocks', () => {
    expect(completionBlockers([])).toEqual(['no-sets']);
    expect(completionBlockers([set(1, 1, 'w.01', { reps: null })])).toEqual(['missing-reps']);
    expect(completionBlockers([set(1, 1, 'w.01', { loadG: null, rir: null })])).toEqual([]);
  });

  it('is shortened on totals only: non-warm-up sets, extra work included', () => {
    const sets = [set(1, 1, 'w.01'), set(2, 1, 'w.01', { setType: 'warmup' }), set(3, 9, null)];
    expect(workSetTotals(7, sets)).toEqual({ planned: 7, actual: 2, short: true });
    expect(workSetTotals(2, sets).short).toBe(false);
  });
});

describe('nutrition entry and targets', () => {
  it('accepts whole grams only, blank as not recorded', () => {
    expect(parseMacroText('145')).toBe(145);
    expect(parseMacroText(' ')).toBeNull();
    for (const bad of ['145.5', '-1', '1e3', '1501']) expect(parseMacroText(bad)).toBe('invalid');
  });

  it('judges each day by the target in force on it', () => {
    const t = (id: number, effectiveOn: string, setAt: string, carbs: number): TargetRecord => ({
      id,
      effectiveOn,
      setAt,
      protein: 145,
      carbs,
      fat: 60,
    });
    const targets = [t(1, '2026-10-01', '2026-10-01T08:00:00Z', 300), t(2, '2026-10-06', '2026-10-06T08:00:00Z', 340), t(3, '2026-10-06', '2026-10-06T09:00:00Z', 350)];
    expect(targetOn(targets, '2026-09-30')).toBeNull();
    expect(targetOn(targets, '2026-10-05')?.carbs).toBe(300);
    expect(targetOn(targets, '2026-10-06')?.carbs).toBe(350);
    expect(targetOn(targets, '2027-01-01')?.carbs).toBe(350);
  });

  it('validates a target: whole grams, 1–10 000 kcal', () => {
    expect(targetError({ protein: 145, carbs: 300, fat: 60 })).toBeNull();
    expect(targetError({ protein: 0, carbs: 0, fat: 0 })).not.toBeNull();
    expect(targetError({ protein: 1501, carbs: 0, fat: 0 })).not.toBeNull();
  });
});

describe('bodyweight entry', () => {
  it('takes kilograms to 0.01 kg, 20–300 kg, as integer grams', () => {
    expect(parseKgToGrams('82.4')).toBe(82_400);
    expect(parseKgToGrams('82,45')).toBe(82_450);
    expect(parseKgToGrams('82')).toBe(82_000);
    for (const bad of ['19.99', '300.01', '82.456', '', 'x']) expect(parseKgToGrams(bad)).toBeNull();
  });
});
