/**
 * Workout loads are entered and shown in pounds (at most 0.01 lb) and stored as integer
 * grams — a physical mass, so no recorded set is ever reinterpreted. The pound is exactly
 * 453.59237 g, so the conversion is exact integer arithmetic with one half-up rounding,
 * mirroring the desktop's `domain/units.py`. Bodyweight stays kilograms.
 */

/** 453.59237 g/lb scaled by 10^5, so hundredths of a pound convert in integers. */
const G_PER_LB_E5 = 45_359_237;

/** Largest load the entry accepts, as the desktop's entry does (9999.99 lb). */
export const MAX_LOAD_LB_HUNDREDTHS = 999_999;

const LB_TEXT = /^(\d{1,4})(?:[.,](\d{1,2}))?$/;

/** "225", "72.5", "72,75" → hundredths of a pound; null when not a valid load. */
export function parseLbHundredths(text: string): number | null {
  const match = LB_TEXT.exec(text.trim());
  if (!match) return null;
  const [, whole, frac = ''] = match;
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Hundredths of a pound → integer grams, rounded half-up to the gram. */
export function lbHundredthsToGrams(hundredths: number): number {
  if (!Number.isInteger(hundredths) || hundredths < 0) throw new Error(`Not a load: ${hundredths}`);
  // grams = lb × 453.59237 = hundredths × 45359237 / 10^7
  return Math.floor((hundredths * G_PER_LB_E5 + 5_000_000) / 10_000_000);
}

/** Integer grams → hundredths of a pound, rounded half-up. */
export function gramsToLbHundredths(grams: number): number {
  if (!Number.isInteger(grams) || grams < 0) throw new Error(`Not a stored load: ${grams}`);
  // hundredths = g / 453.59237 × 100 = g × 10^7 / 45359237; half-up in integers.
  return Math.floor((2 * grams * 10_000_000 + G_PER_LB_E5) / (2 * G_PER_LB_E5));
}

/** A stored load for display: "225", "72.75", "2.5" (no padding, no exponent). */
export function formatLb(grams: number): string {
  const h = gramsToLbHundredths(grams);
  const whole = Math.floor(h / 100);
  const frac = h % 100;
  if (frac === 0) return `${whole}`;
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Entered pounds text → grams, or null when the text is not a load. */
export function lbTextToGrams(text: string): number | null {
  const h = parseLbHundredths(text);
  return h === null || h > MAX_LOAD_LB_HUNDREDTHS ? null : lbHundredthsToGrams(h);
}
