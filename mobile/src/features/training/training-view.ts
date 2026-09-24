import type { ProgramWorkout, RecordedSession, TrainingFacts } from '@/data/training-facts';
import type { MuscleGroup } from '@/data/home-facts';
import { blockPhase } from '@/domain/block';
import { dayOfMonth, parseIsoDate, type IsoDate } from '@/domain/dates';
import {
  blockWeekDates,
  clampBlockWeek,
  currentBlockWeek,
  isInBlock,
  scheduledWorkout,
  type Block,
} from '@/domain/schedule';
import { dayStatus, sessionProgress, type DayStatus, type SessionFacts } from '@/domain/training';
import { longDate, weekdayName, weekdayShort } from '@/features/home/format';

/**
 * Everything the Training planner and its read-only plan preview show, as display-ready
 * values. Pure: no React, no platform. Week and day rules come from `domain/`.
 */

/** Which block week is shown and which of its days is selected. */
export type TrainingSelection = { week: number; date: IsoDate };

export type DayKind = 'workout' | 'rest' | 'outside';

export type PlannerDay = {
  date: IsoDate;
  weekday: string;
  day: number;
  isToday: boolean;
  isSelected: boolean;
  kind: DayKind;
  status: DayStatus | null;
  accessibilityLabel: string;
};

export type SessionRow = {
  date: IsoDate;
  weekday: string;
  day: number;
  name: string;
  status: DayStatus;
  statusLabel: string;
  detailLabel: string;
  progress: number | null;
  isToday: boolean;
  isSelected: boolean;
  accessibilityLabel: string;
};

export type SelectedWorkout = {
  kind: 'workout';
  date: IsoDate;
  name: string;
  eyebrow: string;
  isToday: boolean;
  status: DayStatus;
  statusLabel: string;
  metaLabel: string;
  /** Null when no source states the workout's focus. */
  focusLabel: string | null;
  /** The stated focus for the anatomy figure and its caption; empty when none is stated. */
  focus: { groups: readonly MuscleGroup[]; names: string[] };
  progress: { value: number; label: string; percentLabel: string } | null;
  /** Today or a past day opens the logger; a future day shows the plan. */
  cta: { label: string; route: 'workout' | 'plan'; accessibilityLabel: string };
};

export type SelectedDay = { kind: 'rest' | 'outside'; eyebrow: string; title: string; note: string };

export type TrainingView =
  | {
      kind: 'planner';
      blockLabel: string;
      rangeLabel: string;
      rangeAccessibilityLabel: string;
      previous: { enabled: boolean; accessibilityLabel: string };
      next: { enabled: boolean; accessibilityLabel: string };
      isCurrentWeek: boolean;
      days: PlannerDay[];
      selected: SelectedWorkout | SelectedDay;
      sessions: SessionRow[];
      summaryLabel: string;
      restLabel: string | null;
      outsideLabel: string | null;
    }
  | { kind: 'no-block'; note: string };

export type PlanExercise = {
  order: number;
  name: string;
  marker: boolean;
  setsLabel: string;
  repsLabel: string;
  rirLabel: string;
  restLabel: string;
  failureLabel: string;
  accessibilityLabel: string;
};

export type SessionPreview = {
  name: string;
  dateLabel: string;
  weekLabel: string;
  isToday: boolean;
  status: DayStatus;
  statusLabel: string;
  progressLabel: string | null;
  stats: { value: string; label: string }[];
  exercises: PlanExercise[];
};

export const STATUS_LABEL: Record<DayStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  done: 'Done',
  shortened: 'Shortened',
  'not-recorded': 'Not recorded',
};

const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abs: 'Abs',
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortMonth(date: IsoDate): string {
  return MONTHS_SHORT[new Date(parseIsoDate(date)).getUTCMonth()];
}

/** "5–11 Oct", or "28 Sep – 4 Oct" across a month boundary. */
export function weekRangeLabel(first: IsoDate, last: IsoDate): string {
  if (shortMonth(first) === shortMonth(last)) {
    return `${dayOfMonth(first)}–${dayOfMonth(last)} ${shortMonth(last)}`;
  }
  return `${dayOfMonth(first)} ${shortMonth(first)} – ${dayOfMonth(last)} ${shortMonth(last)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function plannedWorkSets(workout: ProgramWorkout): number {
  return workout.exercises.reduce((sum, e) => sum + e.sets.length, 0);
}

function recordFor(facts: TrainingFacts, date: IsoDate, workout: ProgramWorkout): RecordedSession | null {
  return facts.sessions.find((s) => s.date === date && s.workoutKey === workout.key) ?? null;
}

function sessionFacts(facts: TrainingFacts, date: IsoDate, workout: ProgramWorkout): SessionFacts {
  const record = recordFor(facts, date, workout);
  return {
    plannedWorkSets: plannedWorkSets(workout),
    recordedWorkSets: record?.recordedWorkSets ?? 0,
    opened: record?.opened ?? false,
    completed: record?.completed ?? false,
  };
}

function statedFocus(facts: TrainingFacts, workout: ProgramWorkout): SelectedWorkout['focus'] {
  const groups = facts.focus[workout.key] ?? [];
  return { groups, names: groups.map((m) => MUSCLE_LABEL[m]) };
}

function hasProgress(status: DayStatus): boolean {
  return status === 'in-progress' || status === 'done' || status === 'shortened';
}

function setsLabel(session: SessionFacts, status: DayStatus): string {
  return hasProgress(status)
    ? `${session.recordedWorkSets} of ${session.plannedWorkSets} work sets`
    : `${session.plannedWorkSets} work sets`;
}

// ── Navigation ────────────────────────────────────────────────────────────────────────

/**
 * The selection for block week `week` (clamped to the block): today if it falls in that
 * week, otherwise the week's first scheduled workout, otherwise its first in-block day.
 */
export function selectWeek(facts: TrainingFacts, week: number): TrainingSelection | null {
  const block = facts.block;
  if (!block) return null;
  const w = clampBlockWeek(block, week);
  const dates = blockWeekDates(block, w);
  const date =
    dates.find((d) => d === facts.today) ??
    dates.find((d) => scheduledWorkout(facts.program.workouts, block, d) !== null) ??
    dates.find((d) => isInBlock(block, d)) ??
    dates[0];
  return { week: w, date };
}

/** Where the planner opens: the block week containing today, with today selected. */
export function initialSelection(facts: TrainingFacts): TrainingSelection | null {
  if (!facts.block) return null;
  return selectWeek(facts, currentBlockWeek(facts.block, facts.today));
}

// ── Planner ───────────────────────────────────────────────────────────────────────────

function outsideCopy(block: Block, date: IsoDate): { title: string; note: string } {
  const phase = blockPhase(block.start, block.weeks, date);
  return phase.kind === 'pre-block'
    ? { title: 'Before the block', note: `The block starts ${longDate(block.start)}.` }
    : { title: 'After the block', note: `The ${block.weeks}-week block has ended.` };
}

function buildSelected(
  facts: TrainingFacts,
  block: Block,
  date: IsoDate,
  dates: IsoDate[],
): SelectedWorkout | SelectedDay {
  const isToday = date === facts.today;
  const eyebrow = isToday ? `Today · ${longDate(date)}` : longDate(date);
  if (!isInBlock(block, date)) return { kind: 'outside', eyebrow, ...outsideCopy(block, date) };

  const workout = scheduledWorkout(facts.program.workouts, block, date);
  if (!workout) {
    const next = dates
      .filter((d) => parseIsoDate(d) > parseIsoDate(date))
      .map((d) => ({ d, w: scheduledWorkout(facts.program.workouts, block, d) }))
      .find((x) => x.w !== null);
    return {
      kind: 'rest',
      eyebrow,
      title: 'Rest day',
      note: next?.w ? `Next: ${next.w.name} · ${weekdayName(next.d)}` : 'No more sessions this week',
    };
  }

  const session = sessionFacts(facts, date, workout);
  const status = dayStatus(session, date, facts.today);
  const progress = sessionProgress(session);
  const minutes = `${workout.estimatedMinutes.min}–${workout.estimatedMinutes.max} min`;
  const focus = statedFocus(facts, workout);
  return {
    kind: 'workout',
    date,
    name: workout.name,
    eyebrow,
    isToday,
    status,
    statusLabel: STATUS_LABEL[status],
    metaLabel: `${plural(workout.exercises.length, 'exercise')} · ${plural(session.plannedWorkSets, 'work set')} · ${minutes}`,
    focusLabel: focus.names.length ? focus.names.join(' · ') : null,
    focus,
    progress: hasProgress(status)
      ? {
          value: progress,
          label: setsLabel(session, status),
          percentLabel: `${Math.round(progress * 100)}%`,
        }
      : null,
    cta: selectedCta(status, date, facts.today, workout.name),
  };
}

const CTA_LABEL: Record<DayStatus, string> = {
  planned: 'Start workout',
  'in-progress': 'Continue workout',
  done: 'View workout',
  shortened: 'View workout',
  'not-recorded': 'Log workout',
};

function selectedCta(status: DayStatus, date: IsoDate, today: IsoDate, name: string): SelectedWorkout['cta'] {
  const future = parseIsoDate(date) > parseIsoDate(today);
  const label = future ? 'View plan' : CTA_LABEL[status];
  return { label, route: future ? 'plan' : 'workout', accessibilityLabel: `${label}, ${name}, ${longDate(date)}` };
}

export function buildTrainingView(facts: TrainingFacts, selection: TrainingSelection): TrainingView {
  const block = facts.block;
  if (!block) {
    return { kind: 'no-block', note: 'Set the block start date to lay out the 12-week plan.' };
  }
  const week = clampBlockWeek(block, selection.week);
  const dates = blockWeekDates(block, week);
  const current = currentBlockWeek(block, facts.today);

  const days = dates.map((date): PlannerDay => {
    const inBlock = isInBlock(block, date);
    const workout = scheduledWorkout(facts.program.workouts, block, date);
    const status = workout ? dayStatus(sessionFacts(facts, date, workout), date, facts.today) : null;
    const kind: DayKind = !inBlock ? 'outside' : workout ? 'workout' : 'rest';
    const what =
      kind === 'outside'
        ? 'outside the block'
        : workout && status
          ? `${workout.name}, ${STATUS_LABEL[status].toLowerCase()}`
          : 'rest day';
    return {
      date,
      weekday: weekdayShort(date),
      day: dayOfMonth(date),
      isToday: date === facts.today,
      isSelected: date === selection.date,
      kind,
      status,
      accessibilityLabel: `${longDate(date)}${date === facts.today ? ', today' : ''}: ${what}`,
    };
  });

  const sessions = dates.flatMap((date): SessionRow[] => {
    const workout = scheduledWorkout(facts.program.workouts, block, date);
    if (!workout) return [];
    const session = sessionFacts(facts, date, workout);
    const status = dayStatus(session, date, facts.today);
    const detail = `${plural(workout.exercises.length, 'exercise')} · ${setsLabel(session, status)}`;
    return [
      {
        date,
        weekday: weekdayShort(date),
        day: dayOfMonth(date),
        name: workout.name,
        status,
        statusLabel: STATUS_LABEL[status],
        detailLabel: detail,
        progress: hasProgress(status) ? sessionProgress(session) : null,
        isToday: date === facts.today,
        isSelected: date === selection.date,
        accessibilityLabel: `${longDate(date)}${date === facts.today ? ', today' : ''}: ${workout.name}, ${STATUS_LABEL[status].toLowerCase()}, ${detail}`,
      },
    ];
  });

  const finished = sessions.filter((s) => s.status === 'done' || s.status === 'shortened').length;
  const planned = dates.reduce((sum, d) => {
    const w = scheduledWorkout(facts.program.workouts, block, d);
    return sum + (w ? plannedWorkSets(w) : 0);
  }, 0);
  const dayList = (kind: DayKind) =>
    days.filter((d) => d.kind === kind).map((d) => `${d.weekday} ${d.day}`);
  const rest = dayList('rest');
  const outside = days.filter((d) => d.kind === 'outside');

  return {
    kind: 'planner',
    blockLabel: `Week ${week} of ${block.weeks}`,
    rangeLabel: weekRangeLabel(dates[0], dates[6]),
    rangeAccessibilityLabel: `Week ${week} of ${block.weeks}, ${longDate(dates[0])} to ${longDate(dates[6])}`,
    previous: {
      enabled: week > 1,
      accessibilityLabel: week > 1 ? `Previous week, week ${week - 1}` : 'Previous week, unavailable in week 1',
    },
    next: {
      enabled: week < block.weeks,
      accessibilityLabel:
        week < block.weeks ? `Next week, week ${week + 1}` : `Next week, unavailable in week ${block.weeks}`,
    },
    isCurrentWeek: week === current,
    days,
    selected: buildSelected(facts, block, selection.date, dates),
    sessions,
    summaryLabel: `${finished} of ${plural(sessions.length, 'session')} finished · ${planned} work sets`,
    restLabel: rest.length ? `Rest · ${rest.join(' · ')}` : null,
    outsideLabel: outside.length
      ? `${blockPhase(block.start, block.weeks, outside[0].date).kind === 'pre-block' ? 'Before the block' : 'After the block'} · ${outside.map((d) => `${d.weekday} ${d.day}`).join(' · ')}`
      : null,
  };
}

// ── Read-only plan preview ─────────────────────────────────────────────────────────────

function range(min: number, max: number): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

export function buildSessionPreview(facts: TrainingFacts, date: IsoDate): SessionPreview | null {
  const block = facts.block;
  if (!block) return null;
  let workout: ProgramWorkout | null;
  try {
    workout = scheduledWorkout(facts.program.workouts, block, date);
  } catch {
    return null; // not a calendar date
  }
  if (!workout) return null;

  const session = sessionFacts(facts, date, workout);
  const status = dayStatus(session, date, facts.today);
  const phase = blockPhase(block.start, block.weeks, date);
  const exercises = workout.exercises.map((e, i): PlanExercise => {
    const reps = [...new Set(e.sets.map((s) => range(s.reps[0], s.reps[1])))];
    const setsLabel = plural(e.sets.length, 'set');
    const repsLabel = `${reps.join(' / ')} reps`;
    const rirLabel = `RIR ${e.sets.map((s) => range(s.rir[0], s.rir[1])).join(' · ')}`;
    const restLabel = `Rest ${range(e.restSeconds.min, e.restSeconds.max)} s`;
    const failureLabel = e.failure === 'prohibited' ? 'Failure prohibited' : 'Failure on final set only';
    return {
      order: i + 1,
      name: e.name,
      marker: e.marker,
      setsLabel,
      repsLabel,
      rirLabel,
      restLabel,
      failureLabel,
      accessibilityLabel: [
        `${i + 1}. ${e.name}${e.marker ? ', marker lift' : ''}`,
        `${setsLabel} of ${repsLabel}`,
        rirLabel.replaceAll(' · ', ', '),
        restLabel.replace(' s', ' seconds'),
        failureLabel,
      ].join('. '),
    };
  });

  return {
    name: workout.name,
    dateLabel: longDate(date),
    weekLabel: phase.kind === 'in-block' ? `Week ${phase.week} of ${phase.weeks}` : '',
    isToday: date === facts.today,
    status,
    statusLabel: STATUS_LABEL[status],
    progressLabel: hasProgress(status) ? `${session.recordedWorkSets} of ${session.plannedWorkSets} work sets recorded` : null,
    stats: [
      { value: `${workout.exercises.length}`, label: 'exercises' },
      { value: `${session.plannedWorkSets}`, label: 'work sets' },
      { value: range(workout.estimatedMinutes.min, workout.estimatedMinutes.max), label: 'min, est.' },
    ],
    exercises,
  };
}
