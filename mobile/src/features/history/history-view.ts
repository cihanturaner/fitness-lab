import type { HistoryDay, HistoryPage } from '@/data/history-source';
import type { SessionRecord } from '@/data/repo/workouts';
import { dayOfMonth, parseIsoDate } from '@/domain/dates';
import { dayCalories, MACROS, targetCalories, targetOn } from '@/domain/nutrition';
import { groupSets, workSetTotals, type PerformedSet } from '@/domain/session';
import { formatLb } from '@/domain/units';
import { kgExact } from '@/features/bodyweight/bodyweight-view';
import { groupThousands, weekdayShort } from '@/features/home/format';

/** History as a day timeline, newest first. Pure. */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export type HistoryWorkout = {
  id: number;
  name: string;
  shortened: boolean;
  setsLabel: string;
  slots: { key: string; name: string; plannedName: string | null; setsText: string }[];
  accessibilityLabel: string;
};

export type HistoryDayView = {
  date: string;
  weekday: string;
  dayMonth: string;
  isToday: boolean;
  workouts: HistoryWorkout[];
  bodyweightLabel: string | null;
  nutrition: { kcalLabel: string; detail: string; partial: boolean } | null;
};

export function setText(s: Pick<PerformedSet, 'loadG' | 'reps' | 'rir' | 'setType'>): string {
  const lb = s.loadG === null ? '—' : formatLb(s.loadG);
  return `${lb} lb × ${s.reps ?? '—'} @ RIR ${s.rir ?? '—'}${s.setType === 'warmup' ? ' warm-up' : ''}`;
}

export function historyWorkout(session: SessionRecord): HistoryWorkout {
  const planned = session.plan ? session.plan.exercises.reduce((n, e) => n + e.sets.length, 0) : 0;
  const totals = workSetTotals(planned, session.sets);
  const grouped = groupSets(session.slots, session.sets);
  const slots = session.slots
    .map((slot) => {
      const sets = grouped.bySlot.get(slot.slotKey) ?? [];
      return {
        key: slot.slotKey,
        name: slot.performedName,
        plannedName: slot.changed ? slot.plannedName : null,
        setsText: sets.map(setText).join(' · '),
      };
    })
    .filter((s) => s.setsText !== '');
  const extra = grouped.extra.map((g, i) => ({
    key: `extra-${i}`,
    name: `${session.exercises.get(g.exerciseId)?.name ?? 'Exercise'} (extra)`,
    plannedName: null,
    setsText: g.sets.map(setText).join(' · '),
  }));
  const name = session.plan?.name ?? 'Unplanned session';
  const setsLabel = session.plan
    ? `${totals.actual} of ${totals.planned} working sets`
    : `${totals.actual} working set${totals.actual === 1 ? '' : 's'}`;
  const shortened = session.plan !== null && totals.short;
  return {
    id: session.workout.id,
    name,
    shortened,
    setsLabel,
    slots: [...slots, ...extra],
    accessibilityLabel: `${name}${shortened ? ', shortened' : ''}, ${setsLabel}. Open workout`,
  };
}

export function historyDayView(day: HistoryDay, page: Pick<HistoryPage, 'targets'>, today: string): HistoryDayView {
  const kcal = day.nutrition ? dayCalories(day.nutrition.grams) : null;
  const target = day.nutrition ? targetOn(page.targets, day.date) : null;
  return {
    date: day.date,
    weekday: weekdayShort(day.date).toUpperCase(),
    dayMonth: `${dayOfMonth(day.date)} ${MONTHS[new Date(parseIsoDate(day.date)).getUTCMonth()]}`,
    isToday: day.date === today,
    workouts: day.workouts.map(historyWorkout),
    bodyweightLabel: day.bodyweight ? `${kgExact(day.bodyweight.grams)} kg` : null,
    nutrition:
      day.nutrition && kcal
        ? {
            kcalLabel: `${groupThousands(kcal.kcal)} kcal`,
            detail: [
              MACROS.map((m) => `${day.nutrition!.grams[m] ?? '—'}${m[0].toUpperCase()}`).join(' · '),
              target ? `target ${groupThousands(targetCalories(target))}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            partial: !kcal.complete,
          }
        : null,
  };
}
