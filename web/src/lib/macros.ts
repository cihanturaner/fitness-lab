/**
 * A day's calories come from its macros, never from a typed number. Mirrors backend
 * domain/nutrition.py (Atwater: protein 4, carbohydrate 4, fat 9 kcal per gram); the
 * server derives the stored day the same way, so the live total is what will be saved.
 */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

export type Macro = keyof typeof KCAL_PER_G

export interface Macros {
  protein: number | null
  carbs: number | null
  fat: number | null
}

export interface MacroCalories {
  /** protein × 4 + carbs × 4 + fat × 9; an unrecorded macro adds nothing. */
  total: number
  /** Each macro's share of the total, in kcal (0 when unrecorded). */
  parts: Record<Macro, number>
  /** Every macro was recorded (0 counts as recorded). */
  complete: boolean
  /** At least one macro was recorded: there is a day to save. */
  any: boolean
}

export function macroCalories({ protein, carbs, fat }: Macros): MacroCalories {
  const parts = {
    protein: (protein ?? 0) * KCAL_PER_G.protein,
    carbs: (carbs ?? 0) * KCAL_PER_G.carbs,
    fat: (fat ?? 0) * KCAL_PER_G.fat,
  }
  return {
    total: parts.protein + parts.carbs + parts.fat,
    parts,
    complete: protein !== null && carbs !== null && fat !== null,
    any: protein !== null || carbs !== null || fat !== null,
  }
}
