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
