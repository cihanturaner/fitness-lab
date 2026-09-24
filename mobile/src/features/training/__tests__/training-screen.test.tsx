import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { trainingFixture } from '@/data/fixtures/training';

import { SessionPlanScreen } from '../session-plan-screen';
import { TrainingScreen } from '../training-screen';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

// useFocusEffect runs on mount like the real one; `mockFocus.run()` re-focuses the screen
// the way returning to the Training tab (e.g. from Home's workout CTA) does.
const mockFocus: { run: () => void } = { run: () => {} };

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    Stack: { Screen: () => null },
    useFocusEffect: (effect: () => void) => {
      mockFocus.run = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TrainingScreen', () => {
  it('opens on today’s session in week 2 with no placeholder left', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    expect(screen.getByRole('header', { name: 'Training' })).toBeOnTheScreen();
    expect(screen.getByText('Week 2 of 12')).toBeOnTheScreen();
    expect(screen.getByText('This week')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Upper B' })).toBeOnTheScreen();
    expect(screen.getByText('9 of 21 work sets')).toBeOnTheScreen();
    expect(
      screen.getByRole('tab', { name: 'Thursday 8 October, today: Upper B, in progress' }),
    ).toBeSelected();
    expect(screen.queryByText('Not built yet')).toBeNull();
  });

  it('offers only a read-only plan action — no start, continue or logging', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    expect(screen.queryByText(/start workout|continue workout/i)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'View plan, Upper B, Thursday 8 October' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/plan/[date]', params: { date: '2026-10-08' } });
  });

  it('selects a rest day and navigates weeks within the block', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Wednesday 7 October: rest day' }));
    expect(screen.getByRole('header', { name: 'Rest day' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous week, week 1' }));
    expect(screen.getByText('Week 1 of 12')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Previous week, unavailable in week 1' })).toBeDisabled();
    expect(screen.getByText('Shortened')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to this week' }));
    expect(screen.getByText('Week 2 of 12')).toBeOnTheScreen();
  });
});

describe('TrainingScreen day selector accessibility', () => {
  it('exposes selected on exactly one day, keeps today and each day’s status in the labels', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    const days = screen.getAllByRole('tab', { name: /October/ });
    expect(days).toHaveLength(7);
    expect(days.map((d) => [d.props.accessibilityLabel, d.props.accessibilityState?.selected])).toEqual([
      ['Monday 5 October: Upper A, done', false],
      ['Tuesday 6 October: Lower A, done', false],
      ['Wednesday 7 October: rest day', false],
      ['Thursday 8 October, today: Upper B, in progress', true],
      ['Friday 9 October: Lower B, planned', false],
      ['Saturday 10 October: rest day', false],
      ['Sunday 11 October: rest day', false],
    ]);
    expect(screen.getByRole('tab', { name: /today/ })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Friday 9 October: Lower B, planned' })).not.toBeSelected();
  });

  it('moves selected with the selection; today stays labelled as today', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Wednesday 7 October: rest day' }));
    expect(screen.getByRole('tab', { name: 'Wednesday 7 October: rest day' })).toBeSelected();
    const today = screen.getByRole('tab', { name: 'Thursday 8 October, today: Upper B, in progress' });
    expect(today).not.toBeSelected();
    expect(today.props.accessibilityState).toEqual({ selected: false });
  });
});

describe('TrainingScreen entry', () => {
  const todayTab = 'Thursday 8 October, today: Upper B, in progress';

  it('lands on the current week and today when entered again (Home → Training), even after browsing', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    for (const week of [3, 4, 5]) {
      await fireEvent.press(screen.getByRole('button', { name: `Next week, week ${week}` }));
    }
    expect(screen.getByText('Week 5 of 12')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Tuesday 27 October: Lower A, planned' }));

    // Leaving for Home and tapping its workout CTA re-focuses Training.
    await act(async () => mockFocus.run());

    expect(screen.getByText('Week 2 of 12')).toBeOnTheScreen();
    expect(screen.getByText('This week')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: todayTab })).toBeSelected();
    expect(screen.getByRole('header', { name: 'Upper B' })).toBeOnTheScreen();
    expect(screen.getByText('9 of 21 work sets')).toBeOnTheScreen();
  });

  it('keeps the browsed week when coming back from its own plan preview', async () => {
    await render(<TrainingScreen facts={trainingFixture} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Previous week, week 1' }));
    await fireEvent.press(screen.getByRole('button', { name: 'View plan, Upper B, Thursday 1 October' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/plan/[date]', params: { date: '2026-10-01' } });
    await act(async () => mockFocus.run()); // back from the plan

    expect(screen.getByText('Week 1 of 12')).toBeOnTheScreen();
    // The next entry from elsewhere resets again.
    await act(async () => mockFocus.run());
    expect(screen.getByText('Week 2 of 12')).toBeOnTheScreen();
  });
});

describe('SessionPlanScreen', () => {
  it('shows the plan in order without any inputs', async () => {
    await render(<SessionPlanScreen facts={trainingFixture} date="2026-10-08" />);

    expect(screen.getByRole('header', { name: 'Upper B' })).toBeOnTheScreen();
    expect(screen.getByLabelText(/^1\. Neutral-Grip Lat Pulldown, marker lift/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/^8\. Bayesian Cable Curl/)).toBeOnTheScreen();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByDisplayValue(/.*/)).toBeNull(); // no text inputs
  });

  it('says so when the day has no workout', async () => {
    await render(<SessionPlanScreen facts={trainingFixture} date="2026-10-07" />);
    expect(screen.getByText('No workout planned')).toBeOnTheScreen();
  });
});
