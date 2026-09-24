import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { homeFixture } from '@/data/fixtures/home';

import { HomeScreen } from '../home-screen';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('HomeScreen', () => {
  it('renders today, the workout hero and the daily summaries', async () => {
    await render(<HomeScreen facts={homeFixture} />);

    expect(screen.getByRole('header', { name: 'Thursday 8 October' })).toBeOnTheScreen();
    expect(screen.getByText('Week 2 of 12')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Upper B' })).toBeOnTheScreen();
    expect(screen.getByText('9 of 21 sets')).toBeOnTheScreen();
    expect(screen.getByLabelText('Focus: Back, Chest, Shoulders, Triceps, Biceps')).toBeOnTheScreen();
    expect(screen.getByText('799 kcal left')).toBeOnTheScreen();
    expect(screen.getByText('82.4')).toBeOnTheScreen();
    expect(screen.getByLabelText('Thursday 8 October, today: Upper B, in progress')).toBeOnTheScreen();
  });

  it('has exactly one workout CTA, which opens today’s workout in the logger', async () => {
    await render(<HomeScreen facts={homeFixture} />);

    const ctas = screen.getAllByRole('button', { name: /workout/i });
    expect(ctas).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: 'Continue workout, Upper B' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[date]', params: { date: '2026-10-08' } });
  });

  it('opens Settings from the header', async () => {
    await render(<HomeScreen facts={homeFixture} />);

    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('draws the stated focus on the front/back figures, and invents none when there is none', async () => {
    await render(<HomeScreen facts={homeFixture} />);
    expect(screen.getByTestId('anatomy-figure', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Back · Chest · Shoulders · Triceps · Biceps')).toBeOnTheScreen();

    const noFocus = { ...homeFixture, todayWorkout: homeFixture.todayWorkout && { ...homeFixture.todayWorkout, focus: [] } };
    await render(<HomeScreen facts={noFocus} />);
    expect(screen.getByLabelText('No muscle focus stated for this workout')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Focus:/)).toBeNull();
  });

  it('shows no workout CTA on a rest day', async () => {
    await render(<HomeScreen facts={{ ...homeFixture, today: '2026-10-07', todayWorkout: null }} />);

    expect(screen.getByRole('header', { name: 'Rest day' })).toBeOnTheScreen();
    expect(screen.getByText('Next: Upper B · Thursday')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /workout/i })).toBeNull();
  });
});
