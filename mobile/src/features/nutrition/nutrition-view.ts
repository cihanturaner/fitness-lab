import type { NutritionFacts } from '@/data/facts-source';
import { bodyweightTrend } from '@/domain/bodyweight';
import { parseIsoDate, type IsoDate } from '@/domain/dates';
import {
  dayCalories,
  isEarlyPhase,
  MACROS,
  targetCalories,
  targetOn,
  type Macro,
  type MacroGrams,
  type MacroTarget,
} from '@/domain/nutrition';
import { kgExact, shortDay } from '@/features/bodyweight/bodyweight-view';
import { groupThousands } from '@/features/home/format';

/**
 * Nutrition as the screen shows it: the day's macro grams, calories derived from them
 * (never entered), each judged by the target in force on that day. Pure.
 */

export const MACRO_LABEL: Record<Macro, string> = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const KCAL: Record<Macro, number> = { protein: 4, carbs: 4, fat: 9 };

export type MacroSummary = {
  macro: Macro;
  label: string;
  eatenLabel: string;
  targetLabel: string | null;
  leftLabel: string | null;
  fraction: number;
  /** Protein reaching its target is the one goal met; going over carbs or fat is only stated. */
  met: boolean;
};

export type NutritionView = {
  dateLabel: string;
  isToday: boolean;
  gauge: {
    eatenLabel: string;
    fraction: number;
    targetLabel: string | null;
    leftLabel: string | null;
    over: boolean;
  };
  logged: boolean;
  partialNote: string | null;
  macros: MacroSummary[];
  target: { summary: string; kcalLabel: string; sinceLabel: string } | null;
  recent: { date: IsoDate; dayLabel: string; kcalLabel: string; detail: string; partial: boolean }[];
  bodyweight: { valueLabel: string | null; caption: string };
  /** Changing an established target in the early weeks needs one of the source's exceptions. */
  targetChangeNeedsException: boolean;
  /** Values the target form starts from: the current target, else the source's defaults. */
  targetDefaults: { protein: string; carbs: string; fat: string };
};

/** "112 × 4 + 186 × 4 + 41 × 9 = 1,561 kcal" — the derivation, shown as the lifter types. */
export function calorieEquation(grams: MacroGrams): string {
  const parts = MACROS.filter((m) => grams[m] !== null).map((m) => `${grams[m]} × ${KCAL[m]}`);
  if (parts.length === 0) return 'Calories = protein × 4 + carbs × 4 + fat × 9';
  return `${parts.join(' + ')} = ${groupThousands(dayCalories(grams).kcal)} kcal`;
}

export function buildNutritionView(facts: NutritionFacts): NutritionView {
  const grams = facts.day?.grams ?? { protein: null, carbs: null, fat: null };
  const logged = facts.day !== null;
  const eaten = dayCalories(grams);
  const target = targetOn(facts.targets, facts.date);
  const targetKcal = target ? targetCalories(target) : null;
  const left = targetKcal === null ? null : targetKcal - eaten.kcal;

  const macros = MACROS.map((macro): MacroSummary => {
    const g = grams[macro];
    const t = target ? target[macro] : null;
    const done = g ?? 0;
    return {
      macro,
      label: MACRO_LABEL[macro],
      eatenLabel: g === null ? '—' : `${g}`,
      targetLabel: t === null ? null : `${t} g`,
      leftLabel:
        t === null || g === null ? null : done <= t ? `${t - done} g left` : `${done - t} g over`,
      fraction: t ? Math.min(1, done / t) : 0,
      met: macro === 'protein' && t !== null && g !== null && g >= t,
    };
  });

  const current = targetOn(facts.targets, facts.today);
  const established = facts.targets.some((t) => t.effectiveOn < facts.today);
  const trend = bodyweightTrend(facts.bodyweight, facts.today);

  return {
    dateLabel: facts.date === facts.today ? 'Today' : shortDay(facts.date),
    isToday: facts.date === facts.today,
    gauge: {
      eatenLabel: logged ? groupThousands(eaten.kcal) : '0',
      fraction: targetKcal ? Math.min(1, eaten.kcal / targetKcal) : 0,
      targetLabel: targetKcal === null ? null : groupThousands(targetKcal),
      leftLabel: left === null ? null : groupThousands(Math.abs(left)),
      over: left !== null && left < 0,
    },
    logged,
    partialNote:
      logged && !eaten.complete
        ? 'Not every macro is recorded for this day, so its calories cover the recorded ones only.'
        : null,
    macros,
    target: target
      ? {
          summary: `${target.protein} P · ${target.carbs} C · ${target.fat} F`,
          kcalLabel: `${groupThousands(targetKcal!)} kcal`,
          sinceLabel: `Since ${shortDay(target.effectiveOn)}`,
        }
      : null,
    recent: [...facts.recent]
      .sort((a, b) => parseIsoDate(b.date) - parseIsoDate(a.date))
      .map((d) => {
        const kcal = dayCalories(d.grams);
        const t = targetOn(facts.targets, d.date);
        const fmt = (m: Macro) => `${d.grams[m] ?? '—'}${m[0].toUpperCase()}`;
        return {
          date: d.date,
          dayLabel: d.date === facts.today ? 'Today' : shortDay(d.date),
          kcalLabel: `${groupThousands(kcal.kcal)} kcal`,
          detail: `${MACROS.map(fmt).join(' · ')}${t ? ` · target ${groupThousands(targetCalories(t))}` : ''}`,
          partial: !kcal.complete,
        };
      }),
    bodyweight: {
      valueLabel: trend.latest ? `${kgExact(trend.latest.grams)} kg` : null,
      caption: trend.latest
        ? `${trend.latest.date === facts.today ? 'Today' : shortDay(trend.latest.date)}${trend.average7Grams !== null ? ` · 7-day avg ${(Math.round(trend.average7Grams / 100) / 10).toFixed(1)} kg` : ''}`
        : 'No weigh-in yet',
    },
    targetChangeNeedsException: current !== null && established && isEarlyPhase(facts.blockStart, facts.today),
    targetDefaults: current
      ? { protein: `${current.protein}`, carbs: `${current.carbs}`, fat: `${current.fat}` }
      : { protein: '145', carbs: '', fat: '60' },
  };
}

/** A target's derived calories for the form, or null while a field is not a whole number. */
export function targetPreview(target: Partial<MacroTarget>): number | null {
  if (MACROS.some((m) => target[m] === undefined)) return null;
  return targetCalories(target as MacroTarget);
}
