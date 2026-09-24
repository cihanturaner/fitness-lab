/**
 * Calories are never entered or stored: they are derived from macro grams,
 * protein × 4 + carbs × 4 + fat × 9. An unrecorded macro adds nothing and marks the day
 * incomplete.
 */

export type Macro = 'protein' | 'carbs' | 'fat';

export const MACROS: readonly Macro[] = ['protein', 'carbs', 'fat'];

const KCAL_PER_GRAM: Record<Macro, number> = { protein: 4, carbs: 4, fat: 9 };

/** Integer grams per macro; `null` means not recorded. */
export type MacroGrams = Record<Macro, number | null>;

/** A target always has all three macros. */
export type MacroTarget = Record<Macro, number>;

export type DayCalories = { kcal: number; complete: boolean };

export function dayCalories(grams: MacroGrams): DayCalories {
  let kcal = 0;
  let complete = true;
  for (const macro of MACROS) {
    const g = grams[macro];
    if (g === null) complete = false;
    else kcal += g * KCAL_PER_GRAM[macro];
  }
  return { kcal, complete };
}

export function targetCalories(target: MacroTarget): number {
  return MACROS.reduce((sum, macro) => sum + target[macro] * KCAL_PER_GRAM[macro], 0);
}

export type MacroProgress = {
  macro: Macro;
  eaten: number | null;
  target: number;
  /** Grams still to eat; negative once over target. */
  left: number;
  /** 0–1, clamped, for a progress bar. */
  fraction: number;
};

export function macroProgress(intake: MacroGrams, target: MacroTarget): MacroProgress[] {
  return MACROS.map((macro) => {
    const eaten = intake[macro];
    const done = eaten ?? 0;
    return {
      macro,
      eaten,
      target: target[macro],
      left: target[macro] - done,
      fraction: target[macro] > 0 ? Math.min(1, Math.max(0, done / target[macro])) : 0,
    };
  });
}

/** Whole grams a day's macro or a target's macro may hold (the desktop's limit). */
export const MAX_MACRO_G = 1500;

/** "145" → 145; blank → null (not recorded); anything else (145.5, -1, 1e3) → 'invalid'. */
export function parseMacroText(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,5}$/.test(t)) return 'invalid';
  const g = Number(t);
  return g <= MAX_MACRO_G ? g : 'invalid';
}

/** One effective-dated target as recorded (append-only history). */
export type TargetRecord = MacroTarget & { id: number; effectiveOn: string; setAt: string };

/**
 * The target in force on `date`: the latest `effectiveOn` on or before it; ties go to the
 * one set last (then the higher id). Null before the first target.
 */
export function targetOn<T extends TargetRecord>(targets: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const t of targets) {
    if (t.effectiveOn > date) continue;
    if (
      best === null ||
      t.effectiveOn > best.effectiveOn ||
      (t.effectiveOn === best.effectiveOn &&
        (t.setAt > best.setAt || (t.setAt === best.setAt && t.id > best.id)))
    ) {
      best = t;
    }
  }
  return best;
}

/** A target's derived calories must be 1–10 000 kcal (the desktop's rule). */
export function targetError(target: MacroTarget): string | null {
  for (const macro of MACROS) {
    const g = target[macro];
    if (!Number.isInteger(g) || g < 0 || g > MAX_MACRO_G) return `Each macro is 0–${MAX_MACRO_G} g.`;
  }
  const kcal = targetCalories(target);
  return kcal < 1 || kcal > 10_000 ? 'A target is 1–10,000 kcal.' : null;
}

/** The weeks 1–2 exceptions the source allows for changing an established target. */
export const EARLY_EXCEPTIONS = [
  'GI intolerance',
  'obvious logging error',
  'illness',
  'clearly falling trend',
  'implementation mistake',
] as const;
