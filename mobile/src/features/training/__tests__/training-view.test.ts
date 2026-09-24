import { describe, expect, it } from '@jest/globals';

import { homeFixture } from '@/data/fixtures/home';
import { trainingFixture } from '@/data/fixtures/training';
import type { TrainingFacts } from '@/data/training-facts';
import { buildHomeView } from '@/features/home/home-view';

import {
  buildSessionPreview,
  buildTrainingView,
  initialSelection,
  selectWeek,
  weekRangeLabel,
  type TrainingSelection,
} from '../training-view';

function planner(facts: TrainingFacts, selection: TrainingSelection) {
  const view = buildTrainingView(facts, selection);
  if (view.kind !== 'planner') throw new Error('expected a planner view');
  return view;
}

const start = initialSelection(trainingFixture)!;

describe('selection and week navigation', () => {
  it('opens on today in block week 2', () => {
    expect(start).toEqual({ week: 2, date: '2026-10-08' });
  });

  it('selects the first scheduled workout in a week that does not hold today', () => {
    expect(selectWeek(trainingFixture, 1)).toEqual({ week: 1, date: '2026-10-01' });
    expect(selectWeek(trainingFixture, 3)).toEqual({ week: 3, date: '2026-10-12' });
    expect(selectWeek(trainingFixture, 2)).toEqual(start);
  });

  it('never leaves weeks 1–12', () => {
    expect(selectWeek(trainingFixture, 0)?.week).toBe(1);
    expect(selectWeek(trainingFixture, 13)?.week).toBe(12);
    const first = planner(trainingFixture, selectWeek(trainingFixture, 1)!);
    expect(first.previous.enabled).toBe(false);
    expect(first.next).toEqual({ enabled: true, accessibilityLabel: 'Next week, week 2' });
    const last = planner(trainingFixture, selectWeek(trainingFixture, 12)!);
    expect(last.next.enabled).toBe(false);
    expect(last.previous.enabled).toBe(true);
    expect(last.rangeLabel).toBe('14–20 Dec');
  });

  it('walks forward and back without drifting', () => {
    let sel = start;
    for (let i = 0; i < 20; i++) sel = selectWeek(trainingFixture, sel.week + 1)!;
    expect(sel.week).toBe(12);
    for (let i = 0; i < 20; i++) sel = selectWeek(trainingFixture, sel.week - 1)!;
    expect(sel.week).toBe(1);
    expect(selectWeek(trainingFixture, 2)).toEqual(start);
  });

  it('opens on week 1 before the block and week 12 after it', () => {
    expect(initialSelection({ ...trainingFixture, today: '2026-09-20' })?.week).toBe(1);
    expect(initialSelection({ ...trainingFixture, today: '2027-01-04' })?.week).toBe(12);
  });
});

describe('buildTrainingView (fixture week 2)', () => {
  const view = planner(trainingFixture, start);

  it('labels the block week and its dates', () => {
    expect(view.blockLabel).toBe('Week 2 of 12');
    expect(view.rangeLabel).toBe('5–11 Oct');
    expect(view.isCurrentWeek).toBe(true);
  });

  it('lays out training and rest days with today selected', () => {
    expect(view.days.map((d) => [d.weekday, d.day, d.kind, d.status])).toEqual([
      ['Mon', 5, 'workout', 'done'],
      ['Tue', 6, 'workout', 'done'],
      ['Wed', 7, 'rest', null],
      ['Thu', 8, 'workout', 'in-progress'],
      ['Fri', 9, 'workout', 'planned'],
      ['Sat', 10, 'rest', null],
      ['Sun', 11, 'rest', null],
    ]);
    expect(view.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-10-08']);
    expect(view.days.filter((d) => d.isSelected).map((d) => d.date)).toEqual(['2026-10-08']);
    expect(view.days[3].accessibilityLabel).toBe('Thursday 8 October, today: Upper B, in progress');
  });

  it('lists the four sessions and folds rest days into one line', () => {
    expect(view.sessions.map((s) => [s.weekday, s.name, s.statusLabel, s.detailLabel])).toEqual([
      ['Mon', 'Upper A', 'Done', '9 exercises · 23 of 23 work sets'],
      ['Tue', 'Lower A', 'Done', '6 exercises · 18 of 18 work sets'],
      ['Thu', 'Upper B', 'In progress', '8 exercises · 9 of 21 work sets'],
      ['Fri', 'Lower B', 'Planned', '6 exercises · 19 work sets'],
    ]);
    expect(view.summaryLabel).toBe('2 of 4 sessions finished · 81 work sets');
    expect(view.restLabel).toBe('Rest · Wed 7 · Sat 10 · Sun 11');
    expect(view.outsideLabel).toBeNull();
  });

  it('features today’s session with its progress and a read-only plan action', () => {
    expect(view.selected).toEqual({
      kind: 'workout',
      date: '2026-10-08',
      name: 'Upper B',
      eyebrow: 'Today · Thursday 8 October',
      isToday: true,
      status: 'in-progress',
      statusLabel: 'In progress',
      metaLabel: '8 exercises · 21 work sets · 80–95 min',
      focusLabel: 'Back · Chest · Shoulders · Triceps · Biceps',
      focus: {
        groups: ['back', 'chest', 'shoulders', 'triceps', 'biceps'],
        names: ['Back', 'Chest', 'Shoulders', 'Triceps', 'Biceps'],
      },
      progress: { value: 9 / 21, label: '9 of 21 work sets', percentLabel: '43%' },
      planAccessibilityLabel: 'View plan, Upper B, Thursday 8 October',
    });
  });

  it('agrees with Home on the week, the day and the session', () => {
    const home = buildHomeView(homeFixture);
    expect(view.blockLabel).toBe(home.blockLabel);
    expect(view.days.map((d) => d.status ?? 'rest')).toEqual(home.strip.map((d) => d.mark));
    if (home.hero.kind !== 'workout' || view.selected.kind !== 'workout') throw new Error('workout day');
    expect(view.selected.name).toBe(home.hero.name);
    expect(view.selected.statusLabel).toBe(home.hero.statusLabel);
    expect(home.hero.setsLabel).toBe('9 of 21 sets');
    expect(view.selected.progress?.label).toBe('9 of 21 work sets');
  });
});

describe('buildTrainingView (other days and weeks)', () => {
  it('shows a selected rest day compactly, with the next session', () => {
    const view = planner(trainingFixture, { week: 2, date: '2026-10-07' });
    expect(view.selected).toEqual({
      kind: 'rest',
      eyebrow: 'Wednesday 7 October',
      title: 'Rest day',
      note: 'Next: Upper B · Thursday',
    });
    expect(planner(trainingFixture, { week: 2, date: '2026-10-11' }).selected).toMatchObject({
      note: 'No more sessions this week',
    });
  });

  it('treats week 1 days before the start date as outside the block', () => {
    const view = planner(trainingFixture, selectWeek(trainingFixture, 1)!);
    expect(view.rangeLabel).toBe('28 Sep – 4 Oct');
    expect(view.isCurrentWeek).toBe(false);
    expect(view.days.map((d) => d.kind)).toEqual([
      'outside',
      'outside',
      'outside',
      'workout',
      'workout',
      'rest',
      'rest',
    ]);
    expect(view.sessions.map((s) => [s.name, s.statusLabel, s.detailLabel])).toEqual([
      ['Upper B', 'Done', '8 exercises · 21 of 21 work sets'],
      ['Lower B', 'Shortened', '6 exercises · 16 of 19 work sets'],
    ]);
    expect(view.summaryLabel).toBe('2 of 2 sessions finished · 40 work sets');
    expect(view.outsideLabel).toBe('Before the block · Mon 28 · Tue 29 · Wed 30');
    expect(planner(trainingFixture, { week: 1, date: '2026-09-28' }).selected).toEqual({
      kind: 'outside',
      eyebrow: 'Monday 28 September',
      title: 'Before the block',
      note: 'The block starts Thursday 1 October.',
    });
  });

  it('shows no focus for workouts without a source focus, never an inferred one', () => {
    const labels = ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16'].map((date) => {
      const view = planner(trainingFixture, { week: 3, date });
      return view.selected.kind === 'workout'
        ? [view.selected.name, view.selected.focusLabel, view.selected.focus.groups.length]
        : null;
    });
    expect(labels).toEqual([
      ['Upper A', null, 0],
      ['Lower A', null, 0],
      ['Upper B', 'Back · Chest · Shoulders · Triceps · Biceps', 5],
      ['Lower B', null, 0],
    ]);
    const none = planner({ ...trainingFixture, focus: {} }, start);
    expect(none.selected).toMatchObject({
      name: 'Upper B',
      focusLabel: null,
      focus: { groups: [], names: [] },
    });
  });

  it('never presents a shortened session as done', () => {
    const view = planner(trainingFixture, { week: 1, date: '2026-10-02' });
    expect(view.selected).toMatchObject({
      status: 'shortened',
      statusLabel: 'Shortened',
      progress: { label: '16 of 19 work sets', percentLabel: '84%' },
    });
  });

  it('marks a past session never opened as not recorded', () => {
    const facts = { ...trainingFixture, today: '2026-10-13' };
    const view = planner(facts, initialSelection(facts)!);
    expect(view.sessions.map((s) => s.statusLabel)).toEqual(['Not recorded', 'Planned', 'Planned', 'Planned']);
  });

  it('asks for a block start when there is none', () => {
    const facts = { ...trainingFixture, block: null };
    expect(initialSelection(facts)).toBeNull();
    expect(buildTrainingView(facts, start).kind).toBe('no-block');
  });

  it('formats week ranges across months and years', () => {
    expect(weekRangeLabel('2026-12-28', '2027-01-03')).toBe('28 Dec – 3 Jan');
  });
});

describe('buildSessionPreview', () => {
  it('lists today’s workout in program order with its exact prescriptions', () => {
    const preview = buildSessionPreview(trainingFixture, '2026-10-08')!;
    expect(preview).toMatchObject({
      name: 'Upper B',
      dateLabel: 'Thursday 8 October',
      weekLabel: 'Week 2 of 12',
      isToday: true,
      status: 'in-progress',
      statusLabel: 'In progress',
      progressLabel: '9 of 21 work sets recorded',
      stats: [
        { value: '8', label: 'exercises' },
        { value: '21', label: 'work sets' },
        { value: '80–95', label: 'min, est.' },
      ],
    });
    expect(preview.exercises.map((e) => `${e.order}. ${e.name} · ${e.setsLabel}`)).toEqual([
      '1. Neutral-Grip Lat Pulldown · 3 sets',
      '2. Incline Smith Press · 3 sets',
      '3. Chest-Supported Upper-Back Row · 3 sets',
      '4. Flat Converging Machine Press · 2 sets',
      '5. Cable Lateral Raise · 4 sets',
      '6. Reverse Pec Deck · 2 sets',
      '7. Cable Pressdown · 2 sets',
      '8. Bayesian Cable Curl · 2 sets',
    ]);
    expect(preview.exercises[0]).toEqual({
      order: 1,
      name: 'Neutral-Grip Lat Pulldown',
      marker: true,
      setsLabel: '3 sets',
      repsLabel: '6–10 reps',
      rirLabel: 'RIR 2 · 2 · 1',
      restLabel: 'Rest 180 s',
      failureLabel: 'Failure prohibited',
      accessibilityLabel:
        '1. Neutral-Grip Lat Pulldown, marker lift. 3 sets of 6–10 reps. RIR 2, 2, 1. Rest 180 seconds. Failure prohibited',
    });
    expect(preview.exercises[4]).toMatchObject({ rirLabel: 'RIR 1 · 1 · 1 · 0–1', failureLabel: 'Failure on final set only' });
  });

  it('sums to the program’s set counts for all four workouts', () => {
    const counts = ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16'].map((d) => {
      const p = buildSessionPreview(trainingFixture, d)!;
      return [p.name, p.exercises.length, p.stats[1].value, p.progressLabel];
    });
    expect(counts).toEqual([
      ['Upper A', 9, '23', null],
      ['Lower A', 6, '18', null],
      ['Upper B', 8, '21', null],
      ['Lower B', 6, '19', null],
    ]);
  });

  it('has no plan for a rest day, a pre-block day or a malformed date', () => {
    expect(buildSessionPreview(trainingFixture, '2026-10-07')).toBeNull();
    expect(buildSessionPreview(trainingFixture, '2026-09-28')).toBeNull();
    expect(buildSessionPreview(trainingFixture, 'not-a-date')).toBeNull();
  });
});
