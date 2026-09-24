import { describe, expect, it } from '@jest/globals';

import { homeFixture } from '@/data/fixtures/home';
import type { HomeFacts } from '@/data/home-facts';

import { groupThousands, signedKg } from '../format';
import { buildHomeView } from '../home-view';

const withToday = (session: Partial<HomeFacts['week'][number]>): HomeFacts => ({
  ...homeFixture,
  week: homeFixture.week.map((s) => (s.date === homeFixture.today ? { ...s, ...session } : s)),
});

describe('buildHomeView (fixture)', () => {
  const view = buildHomeView(homeFixture);

  it('labels the day and the block week', () => {
    expect(view.dateLabel).toBe('Thursday 8 October');
    expect(view.blockLabel).toBe('Week 2 of 12');
  });

  it('marks each day of the week strip', () => {
    expect(view.strip.map((d) => [d.weekday, d.day, d.mark])).toEqual([
      ['M', 5, 'done'],
      ['T', 6, 'done'],
      ['W', 7, 'rest'],
      ['T', 8, 'in-progress'],
      ['F', 9, 'planned'],
      ['S', 10, 'rest'],
      ['S', 11, 'rest'],
    ]);
    expect(view.strip[3]).toMatchObject({ isToday: true });
    expect(view.strip[3].accessibilityLabel).toBe(
      'Thursday 8 October, today: Upper B, in progress',
    );
  });

  it('offers Continue on a workout under way', () => {
    expect(view.hero).toMatchObject({
      kind: 'workout',
      name: 'Upper B',
      statusLabel: 'In progress',
      setsLabel: '9 of 21 sets',
      metaLabel: '8 exercises · 80–95 min',
      nextLabel: 'Flat Converging Machine Press · set 1 of 2',
      cta: { label: 'Continue workout', emphasis: 'primary' },
    });
  });

  it('derives calories from macros and shows what is left', () => {
    expect(view.nutrition).toMatchObject({
      kcalLabel: '1,561', // 112×4 + 186×4 + 41×9
      kcalCaption: 'of 2,360 kcal',
      remainingLabel: '799 kcal left',
      incomplete: false,
    });
    expect(view.nutrition.macros.map((m) => `${m.eatenLabel} ${m.targetLabel}`)).toEqual([
      '112 / 145 g',
      '186 / 310 g',
      '41 / 60 g',
    ]);
  });

  it('summarises bodyweight in kilograms and the week in sessions', () => {
    expect(view.bodyweight).toEqual({
      valueLabel: '82.4',
      whenLabel: 'Today',
      changeLabel: '−0.3 kg / week',
      averageLabel: '7-day avg 82.5 kg',
    });
    expect(view.week).toEqual({
      finished: 2,
      scheduled: 4,
      caption: 'Next: Lower B · Fri',
      segments: ['done', 'done', 'in-progress', 'planned'],
    });
  });
});

describe('buildHomeView (other states)', () => {
  it('offers Start on a workout not yet opened', () => {
    const view = buildHomeView(withToday({ opened: false, recordedWorkSets: 0 }));
    expect(view.hero).toMatchObject({
      statusLabel: 'Not started',
      setsLabel: '21 sets',
      nextLabel: null,
      cta: { label: 'Start workout', emphasis: 'primary' },
    });
  });

  it('never presents a shortened session as done', () => {
    const view = buildHomeView(withToday({ completed: true, recordedWorkSets: 15 }));
    expect(view.hero).toMatchObject({
      status: 'shortened',
      statusLabel: 'Shortened',
      setsLabel: '15 of 21 sets',
      cta: { label: 'View workout', emphasis: 'secondary' },
    });
  });

  it('shows a rest day with the next session', () => {
    const view = buildHomeView({ ...homeFixture, today: '2026-10-07', todayWorkout: null });
    expect(view.hero).toEqual({ kind: 'rest', nextLabel: 'Next: Upper B · Thursday' });
  });

  it('flags a past planned session that was never recorded', () => {
    const view = buildHomeView({ ...homeFixture, today: '2026-10-10', todayWorkout: null });
    expect(view.strip[4].mark).toBe('not-recorded');
    expect(view.hero).toEqual({ kind: 'rest', nextLabel: 'No more sessions this week' });
  });

  it('works before the block and without a target or weigh-ins', () => {
    const view = buildHomeView({
      ...homeFixture,
      today: '2026-09-29',
      week: [],
      todayWorkout: null,
      nutrition: { intake: { protein: 100, carbs: null, fat: null }, target: null },
      bodyweight: [],
    });
    expect(view.blockLabel).toBe('Block starts in 2 days');
    expect(view.nutrition).toMatchObject({
      kcalLabel: '400',
      kcalCaption: 'kcal · no target',
      noteLabel: 'Partial · a macro is missing',
      remainingLabel: null,
      incomplete: true,
    });
    expect(view.bodyweight.valueLabel).toBeNull();
  });

  it('reports calories over target', () => {
    const view = buildHomeView({
      ...homeFixture,
      nutrition: { ...homeFixture.nutrition, intake: { protein: 200, carbs: 400, fat: 80 } },
    });
    expect(view.nutrition.remainingLabel).toBe('760 kcal over');
  });
});

describe('format', () => {
  it('groups thousands without Intl and signs kilograms with a true minus', () => {
    expect(groupThousands(1234567)).toBe('1,234,567');
    expect(groupThousands(-2360)).toBe('−2,360');
    expect(signedKg(-330)).toBe('−0.3');
    expect(signedKg(240)).toBe('+0.2');
    expect(signedKg(-40)).toBe('0.0');
  });
});
