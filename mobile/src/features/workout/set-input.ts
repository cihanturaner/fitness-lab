import type { SetValues } from '@/data/repo/workouts';
import { lbTextToGrams } from '@/domain/units';

/** What the lifter typed into one set row, before it is saved. */
export type SetText = { load: string; reps: string; rir: string };

export type ParsedSet = { ok: true; values: SetValues } | { ok: false; error: string };

/**
 * A row becomes a set only when it is saved, and only with its reps. Load (lb, to 0.01) and
 * RIR are optional — the desktop completes a workout without them, only advising.
 */
export function parseSetText(text: SetText): ParsedSet {
  const load = text.load.trim();
  const loadG = load === '' ? null : lbTextToGrams(load);
  if (loadG === null && load !== '') return { ok: false, error: 'Load is pounds, up to 9999.99 (0.01 lb steps).' };
  const reps = text.reps.trim();
  if (!/^\d{1,4}$/.test(reps)) return { ok: false, error: reps === '' ? 'Enter the reps to log this set.' : 'Reps are a whole number.' };
  const rir = text.rir.trim();
  if (rir !== '' && !/^\d{1,2}$/.test(rir)) return { ok: false, error: 'RIR is a whole number (0–99).' };
  return { ok: true, values: { loadG, reps: Number(reps), rir: rir === '' ? null : Number(rir) } };
}
