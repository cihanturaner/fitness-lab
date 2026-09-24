import { describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { Clock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase } from '@/data/db/test-database';

import { DataProvider, useToday } from '../data-store';

function Today() {
  return <Text>{useToday()}</Text>;
}

describe('DataProvider', () => {
  it('rolls over to the new day while the app stays open', async () => {
    jest.useFakeTimers();
    const db = await openTestDatabase();
    let today = '2026-10-08';
    const clock: Clock = { today: () => today, now: () => `${today}T23:59:00.000Z` };
    await render(
      <DataProvider open={async () => db as Db} clock={clock}>
        <Today />
      </DataProvider>,
    );
    expect(await screen.findByText('2026-10-08')).toBeOnTheScreen();
    today = '2026-10-09';
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('2026-10-09')).toBeOnTheScreen();
    jest.useRealTimers();
  });

  it('shows what went wrong instead of the app when the database cannot open — changing nothing', async () => {
    await render(
      <DataProvider open={async () => Promise.reject(new Error('written by a newer Fitness Lab'))} renderError={(e) => <Text>{e.message}</Text>}>
        <Today />
      </DataProvider>,
    );
    expect(await screen.findByText('written by a newer Fitness Lab')).toBeOnTheScreen();
  });
});
