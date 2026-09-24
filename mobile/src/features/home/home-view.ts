import type { HomeFacts, MuscleGroup, ScheduledSession } from '@/data/home-facts';
import { blockPhase } from '@/domain/block';
import { bodyweightTrend } from '@/domain/bodyweight';
import { dayOfMonth, parseIsoDate, weekDates, type IsoDate } from '@/domain/dates';
import { dayCalories, macroProgress, targetCalories, type Macro } from '@/domain/nutrition';
import { isFinished, sessionProgress, sessionStatus, type SessionStatus } from '@/domain/training';

import { groupThousands, kg, longDate, signedKg, weekdayName, weekdayShort } from './format';

/** Everything Home shows, as display-ready values. Pure: no React, no platform. */

export type DayMark = SessionStatus | 'not-recorded' | 'rest';

export type StripDay = {
  date: IsoDate;
  weekday: string;
  /** "Thu" — today's pill spells the weekday out. */
  weekdayShort: string;
  day: number;
  isToday: boolean;
  mark: DayMark;
  accessibilityLabel: string;
};

export type WorkoutHero = {
  kind: 'workout';
  name: string;
  status: SessionStatus;
  statusLabel: string;
  progress: number;
  setsLabel: string;
  metaLabel: string;
  focus: string[];
  nextLabel: string | null;
  cta: { label: string; emphasis: 'primary' | 'secondary' };
};

export type RestHero = { kind: 'rest'; nextLabel: string };

export type MacroRow = {
  macro: Macro;
  label: string;
  eatenLabel: string;
  targetLabel: string | null;
  fraction: number;
};

export type HomeView = {
  dateLabel: string;
  blockLabel: string | null;
  strip: StripDay[];
  hero: WorkoutHero | RestHero;
  nutrition: {
    kcalLabel: string;
    kcalCaption: string;
    remainingLabel: string | null;
    incomplete: boolean;
    macros: MacroRow[];
  };
  bodyweight: {
    valueLabel: string | null;
    whenLabel: string;
    changeLabel: string | null;
    averageLabel: string | null;
  };
  week: { finished: number; scheduled: number; caption: string; segments: DayMark[] };
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Not started',
  'in-progress': 'In progress',
  done: 'Done',
  shortened: 'Shortened',
};

const MACRO_LABEL: Record<Macro, string> = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

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

function dayMark(session: ScheduledSession | undefined, date: IsoDate, today: IsoDate): DayMark {
  if (!session) return 'rest';
  const status = sessionStatus(session);
  if (status === 'planned' && parseIsoDate(date) < parseIsoDate(today)) return 'not-recorded';
  return status;
}

const MARK_LABEL: Record<DayMark, string> = {
  planned: 'planned',
  'in-progress': 'in progress',
  done: 'done',
  shortened: 'shortened',
  'not-recorded': 'not recorded',
  rest: 'rest day',
};

function buildHero(facts: HomeFacts): WorkoutHero | RestHero {
  const session = facts.week.find((s) => s.date === facts.today);
  const detail = facts.todayWorkout;
  if (!session || !detail) {
    const next = facts.week
      .filter((s) => parseIsoDate(s.date) > parseIsoDate(facts.today))
      .sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date))[0];
    return {
      kind: 'rest',
      nextLabel: next
        ? `Next: ${next.workoutName} · ${weekdayName(next.date)}`
        : 'No more sessions this week',
    };
  }
  const status = sessionStatus(session);
  const finished = isFinished(status);
  const minutes = `${detail.estimatedMinutes.min}–${detail.estimatedMinutes.max} min`;
  return {
    kind: 'workout',
    name: session.workoutName,
    status,
    statusLabel: STATUS_LABEL[status],
    progress: sessionProgress(session),
    setsLabel:
      status === 'planned'
        ? `${session.plannedWorkSets} sets`
        : `${session.recordedWorkSets} of ${session.plannedWorkSets} sets`,
    metaLabel: `${detail.exerciseCount} exercises · ${minutes}`,
    focus: detail.focus.map((m) => MUSCLE_LABEL[m]),
    nextLabel:
      status === 'in-progress' && detail.nextExercise
        ? `${detail.nextExercise.name} · set ${detail.nextExercise.setNumber} of ${detail.nextExercise.setCount}`
        : null,
    cta: finished
      ? { label: 'View workout', emphasis: 'secondary' }
      : { label: status === 'in-progress' ? 'Continue workout' : 'Start workout', emphasis: 'primary' },
  };
}

function buildNutrition(facts: HomeFacts): HomeView['nutrition'] {
  const { intake, target } = facts.nutrition;
  const eaten = dayCalories(intake);
  const progress = target ? macroProgress(intake, target) : null;
  let remainingLabel: string | null = null;
  if (target) {
    const left = targetCalories(target) - eaten.kcal;
    remainingLabel =
      left >= 0 ? `${groupThousands(left)} kcal left` : `${groupThousands(-left)} kcal over`;
  }
  return {
    kcalLabel: groupThousands(eaten.kcal),
    kcalCaption: target ? `of ${groupThousands(targetCalories(target))} kcal` : 'kcal · no target set',
    remainingLabel,
    incomplete: !eaten.complete,
    macros: (['protein', 'carbs', 'fat'] as const).map((macro, i) => ({
      macro,
      label: MACRO_LABEL[macro],
      eatenLabel: intake[macro] === null ? '—' : `${intake[macro]}`,
      targetLabel: target ? `/ ${target[macro]} g` : 'g',
      fraction: progress ? progress[i].fraction : 0,
    })),
  };
}

function buildBodyweight(facts: HomeFacts): HomeView['bodyweight'] {
  const trend = bodyweightTrend(facts.bodyweight, facts.today);
  if (!trend.latest) {
    return { valueLabel: null, whenLabel: 'No weigh-in yet', changeLabel: null, averageLabel: null };
  }
  const when =
    trend.latest.date === facts.today
      ? 'Today'
      : `${weekdayShort(trend.latest.date)} ${dayOfMonth(trend.latest.date)}`;
  return {
    valueLabel: kg(trend.latest.grams),
    whenLabel: when,
    changeLabel:
      trend.weeklyChangeGrams === null ? null : `${signedKg(trend.weeklyChangeGrams)} kg / week`,
    averageLabel:
      trend.average7Grams === null ? null : `7-day avg ${kg(trend.average7Grams)} kg`,
  };
}

function buildWeek(facts: HomeFacts, strip: StripDay[]): HomeView['week'] {
  const scheduled = strip.filter((d) => d.mark !== 'rest');
  const finished = scheduled.filter((d) => d.mark === 'done' || d.mark === 'shortened').length;
  const upcoming = facts.week
    .filter((s) => parseIsoDate(s.date) > parseIsoDate(facts.today))
    .sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date))[0];
  return {
    finished,
    scheduled: scheduled.length,
    caption: upcoming ? `Next: ${upcoming.workoutName} · ${weekdayShort(upcoming.date)}` : 'Last session this week',
    segments: scheduled.map((d) => d.mark),
  };
}

export function buildHomeView(facts: HomeFacts): HomeView {
  const byDate = new Map(facts.week.map((s) => [s.date, s]));
  const strip = weekDates(facts.today).map((date): StripDay => {
    const session = byDate.get(date);
    const mark = dayMark(session, date, facts.today);
    const name = session ? `${session.workoutName}, ` : '';
    return {
      date,
      weekday: weekdayShort(date).slice(0, 1),
      weekdayShort: weekdayShort(date),
      day: dayOfMonth(date),
      isToday: date === facts.today,
      mark,
      accessibilityLabel: `${longDate(date)}${date === facts.today ? ', today' : ''}: ${name}${MARK_LABEL[mark]}`,
    };
  });

  let blockLabel: string | null = null;
  if (facts.block) {
    const phase = blockPhase(facts.block.start, facts.block.weeks, facts.today);
    blockLabel =
      phase.kind === 'in-block'
        ? `Week ${phase.week} of ${phase.weeks}`
        : phase.kind === 'pre-block'
          ? `Block starts in ${phase.daysToStart} ${phase.daysToStart === 1 ? 'day' : 'days'}`
          : 'Block complete';
  }

  return {
    dateLabel: longDate(facts.today),
    blockLabel,
    strip,
    hero: buildHero(facts),
    nutrition: buildNutrition(facts),
    bodyweight: buildBodyweight(facts),
    week: buildWeek(facts, strip),
  };
}
