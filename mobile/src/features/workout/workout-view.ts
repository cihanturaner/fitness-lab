import type { WorkoutFacts } from '@/data/facts-source';
import type { LastPerformance } from '@/data/repo/workouts';
import type { PlannedExercise } from '@/data/training-facts';
import { blockPhase } from '@/domain/block';
import { dayOfMonth, parseIsoDate } from '@/domain/dates';
import {
  completionBlockers,
  groupSets,
  isWorkSet,
  nextPlannedSet,
  workSetTotals,
  type CompletionBlocker,
  type PerformedSet,
} from '@/domain/session';
import { approvedSubstitutes, type ApprovedSubstitute } from '@/domain/substitutes';
import { sessionStatus, type SessionStatus } from '@/domain/training';
import { formatLb } from '@/domain/units';
import { longDate, weekdayShort } from '@/features/home/format';

/**
 * Everything the workout logger shows, as display-ready values. Pure: no React, no
 * platform. Prescriptions come only from the program; what was lifted comes only from the
 * recorded sets. The two are shown side by side and never merged.
 */

export type { WorkoutFacts };

export type LoggedRow = {
  setId: number;
  number: number;
  loadText: string;
  repsText: string;
  rirText: string;
  /** "135 lb × 8 @ RIR 2" */
  summary: string;
  warmup: boolean;
};

export type PendingRow = {
  number: number;
  repsHint: string;
  rirHint: string;
  /** The load the entry starts from: the slot's previous set in this workout, if any. */
  loadPrefill: string;
};

export type ExerciseBlock = {
  slotKey: string;
  order: number;
  name: string;
  /** Set when this workout performs the slot as another exercise. */
  plannedName: string | null;
  marker: boolean;
  prescription: string;
  details: string;
  lastLabel: string;
  countLabel: string;
  complete: boolean;
  logged: LoggedRow[];
  pending: PendingRow[];
  /** The slot holding the next planned set. */
  isNext: boolean;
  substitutes: ApprovedSubstitute[];
  accessibilityLabel: string;
};

export type ExtraGroup = { key: string; name: string; logged: LoggedRow[] };

export type WorkoutView = {
  name: string;
  dateLabel: string;
  weekLabel: string | null;
  isToday: boolean;
  /** No recorded workout yet: the plan is shown, with Start when the day allows it. */
  mode: 'plan' | 'draft' | 'complete';
  canStart: boolean;
  startNote: string | null;
  workoutId: number | null;
  status: SessionStatus;
  statusLabel: string;
  progress: { actual: number; planned: number; fraction: number; label: string; percentLabel: string };
  next: { slotKey: string; setNumber: number } | null;
  blocks: ExerciseBlock[];
  extra: ExtraGroup[];
  blockers: CompletionBlocker[];
  short: boolean;
  shortenedNote: string | null;
  /** The exercises a discard would delete sets of, for the confirmation. */
  discardSummary: string | null;
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Not started',
  'in-progress': 'In progress',
  done: 'Done',
  shortened: 'Shortened',
};

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function prescription(e: PlannedExercise): string {
  const reps = [...new Set(e.sets.map((s) => range(s.reps[0], s.reps[1])))].join(' / ');
  return `${plural(e.sets.length, 'set')} × ${reps} reps · RIR ${e.sets.map((s) => range(s.rir[0], s.rir[1])).join(' · ')}`;
}

function details(e: PlannedExercise): string {
  const rest = `Rest ${range(e.restSeconds.min, e.restSeconds.max)} s`;
  return `${rest} · ${e.failure === 'prohibited' ? 'Failure prohibited' : 'Failure on final set only'}`;
}

function setSummary(s: Pick<PerformedSet, 'loadG' | 'reps' | 'rir'>): string {
  const load = s.loadG === null ? '— lb' : `${formatLb(s.loadG)} lb`;
  return `${load} × ${s.reps ?? '—'} @ RIR ${s.rir ?? '—'}`;
}

function loggedRows(sets: readonly PerformedSet[]): LoggedRow[] {
  return sets.map((s, i) => ({
    setId: s.id,
    number: i + 1,
    loadText: s.loadG === null ? '' : formatLb(s.loadG),
    repsText: s.reps === null ? '' : `${s.reps}`,
    rirText: s.rir === null ? '' : `${s.rir}`,
    summary: setSummary(s),
    warmup: s.setType === 'warmup',
  }));
}

function lastLabel(last: LastPerformance | null | undefined): string {
  if (!last) return 'Last: none yet';
  const when = `${weekdayShort(last.performedOn)} ${dayOfMonth(last.performedOn)}`;
  const sets = last.sets
    .map((s) => `${s.loadG === null ? '—' : formatLb(s.loadG)}×${s.reps ?? '—'}${s.warmup ? ' (w)' : ''}`)
    .join(' · ');
  return `Last · ${when}${last.workoutName ? ` ${last.workoutName}` : ''}: ${sets} lb`;
}

export function buildWorkoutView(facts: WorkoutFacts): WorkoutView {
  const { plan, session, date, today } = facts;
  const sets = session?.sets ?? [];
  const slots = session?.slots ?? [];
  const plannedWorkSets = plan ? plan.exercises.reduce((n, e) => n + e.sets.length, 0) : 0;
  const totals = workSetTotals(plannedWorkSets, sets);
  const grouped = groupSets(slots, sets);
  const next = plan
    ? nextPlannedSet(
        (slots.length ? slots : plan.exercises.map((e, i) => ({ slotKey: e.slotKey, position: i + 1, plannedExerciseId: -1, performedExerciseId: -1 }))).map(
          (s, i) => ({ ...s, plannedSets: plan.exercises[i].sets.length }),
        ),
        sets.filter(isWorkSet),
      )
    : null;
  const mode: WorkoutView['mode'] = !session ? 'plan' : session.workout.status === 'draft' ? 'draft' : 'complete';
  const status = sessionStatus({
    plannedWorkSets,
    recordedWorkSets: totals.actual,
    opened: session !== null,
    completed: mode === 'complete',
  });

  const inBlock = facts.block ? blockPhase(facts.block.start, facts.block.weeks, date) : null;
  const future = parseIsoDate(date) > parseIsoDate(today);
  const canStart = mode === 'plan' && plan !== null && !future && inBlock?.kind === 'in-block';
  const startNote =
    mode !== 'plan'
      ? null
      : future
        ? `Planned for ${longDate(date)}. It can be started on the day.`
        : inBlock?.kind !== 'in-block'
          ? 'This day is outside the training block.'
          : null;

  const blocks = (plan?.exercises ?? []).map((e, i): ExerciseBlock => {
    const slot = slots.find((s) => s.slotKey === e.slotKey);
    const logged = grouped.bySlot.get(e.slotKey) ?? [];
    const work = logged.filter(isWorkSet).length;
    const lastLoad = [...logged].reverse().find((s) => s.loadG !== null)?.loadG ?? null;
    const pending = e.sets.slice(Math.min(work, e.sets.length)).map((p, j) => ({
      number: logged.length + j + 1,
      repsHint: range(p.reps[0], p.reps[1]),
      rirHint: range(p.rir[0], p.rir[1]),
      loadPrefill: j === 0 && lastLoad !== null ? formatLb(lastLoad) : '',
    }));
    const name = slot?.performedName ?? e.name;
    return {
      slotKey: e.slotKey,
      order: i + 1,
      name,
      plannedName: slot?.changed ? e.name : null,
      marker: e.marker,
      prescription: prescription(e),
      details: details(e),
      lastLabel: lastLabel(facts.last.get(e.slotKey)),
      countLabel: `${work}/${e.sets.length}`,
      complete: work >= e.sets.length,
      logged: loggedRows(logged),
      pending: mode === 'complete' ? [] : pending,
      isNext: next?.slotKey === e.slotKey,
      substitutes: approvedSubstitutes(e.notes).filter((s) => s.name.toLowerCase() !== e.name.toLowerCase()),
      accessibilityLabel: `${i + 1}. ${name}${slot?.changed ? `, in place of ${e.name}` : ''}. ${work} of ${e.sets.length} sets logged.`,
    };
  });

  const extra = grouped.extra.map((g, i): ExtraGroup => ({
    key: `extra-${g.exerciseId}-${i}`,
    name: session?.exercises.get(g.exerciseId)?.name ?? 'Exercise',
    logged: loggedRows(g.sets),
  }));

  const phase = inBlock?.kind === 'in-block' ? inBlock : null;
  const fraction = totals.planned > 0 ? Math.min(1, totals.actual / totals.planned) : 0;
  const withSets = [...new Set(sets.map((s) => session?.exercises.get(s.exerciseId)?.name ?? 'Exercise'))];
  return {
    name: plan?.name ?? 'Unplanned session',
    dateLabel: longDate(date),
    weekLabel: phase ? `Week ${phase.week} of ${phase.weeks}` : null,
    isToday: date === today,
    mode,
    canStart,
    startNote,
    workoutId: session?.workout.id ?? null,
    status,
    statusLabel: STATUS_LABEL[status],
    progress: {
      actual: totals.actual,
      planned: totals.planned,
      fraction,
      label: plan ? `${totals.actual} of ${totals.planned} working sets` : plural(totals.actual, 'working set'),
      percentLabel: `${Math.round(fraction * 100)}%`,
    },
    next: mode === 'draft' && next ? { slotKey: next.slotKey, setNumber: next.setNumber } : null,
    blocks,
    extra,
    blockers: mode === 'draft' ? completionBlockers(sets) : [],
    short: totals.short,
    shortenedNote:
      mode === 'complete' && totals.short
        ? `Saved as a shortened session: ${totals.actual} of ${totals.planned} planned working sets recorded.`
        : null,
    discardSummary: sets.length
      ? `${plural(sets.length, 'recorded set')} (${withSets.join(', ')}) will be deleted.`
      : null,
  };
}

/** The shortened-session question, asked before completing (totals only). */
export function shortenedQuestion(view: Pick<WorkoutView, 'progress'>): string {
  return `${view.progress.actual} actual working sets recorded / ${view.progress.planned} planned. Complete anyway?`;
}

export const BLOCKER_TEXT: Record<CompletionBlocker, string> = {
  'no-sets': 'Log at least one set before finishing.',
  'missing-reps': 'Every set needs its reps before the workout can be finished.',
};
