import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { trainingFixture } from '@/data/fixtures/training';

import { SessionPlanScreen } from '../session-plan-screen';
import { TrainingScreen } from '../training-screen';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
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
