import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { fixedClock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase, type TestDb } from '@/data/db/test-database';
import { saveBodyweight } from '@/data/repo/bodyweight';
import { HistoryScreen } from '@/features/history/history-screen';
import { DataProvider } from '@/store/data-store';

import { SettingsScreen } from '../settings-screen';

const SAMPLE = readFileSync(join(__dirname, '../../../data/fixtures/desktop-export-v1.json'), 'utf8');
const mockPicked: { current: { name: string; text: string } | null } = { current: null };
const mockShared: { name: string; text: string }[] = [];

jest.mock('@/data/device-files', () => ({
  pickExportFile: async () => mockPicked.current,
  shareExportFile: async (name: string, text: string) => {
    mockShared.push({ name, text });
    return 'shared';
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), Stack: { Screen: () => null } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

const clock = fixedClock('2026-10-09');
let db: TestDb;
beforeEach(async () => {
  db = await openTestDatabase();
  mockPicked.current = { name: 'fitness-lab-export-v1.json', text: SAMPLE };
  mockShared.length = 0;
});

const withStore = (ui: React.ReactElement) => (
  <DataProvider open={async () => db as Db} clock={clock}>
    {ui}
  </DataProvider>
);

describe('J8: importing a V1 export', () => {
  it('previews the file, imports it into the empty app, and History and Settings show it', async () => {
    await render(
      withStore(
        <>
          <SettingsScreen />
          <HistoryScreen />
        </>,
      ),
    );
    expect(await screen.findByText('Nothing recorded yet.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Import a file' }));
    expect(await screen.findByText('3 workouts (2 completed, 10 sets) · 3 weigh-ins · 2 nutrition days · 2 targets')).toBeOnTheScreen();
    expect(screen.getByText('Same program as this app.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Import fitness-lab-export-v1.json' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/^Imported\./)).toBeOnTheScreen();
    // Settings: the block start and target came across; History: the days did.
    expect(await screen.findByText('Thursday 1 October')).toBeOnTheScreen();
    expect(screen.getAllByText('145 P · 348 C · 60 F').length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Upper A, shortened, 7 of 23 working sets. Open workout' })).toBeOnTheScreen();
  });

  it('shows why a bad file is refused and changes nothing', async () => {
    mockPicked.current = { name: 'broken.json', text: SAMPLE.slice(0, 200) };
    await render(withStore(<SettingsScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Import a file' }));
    expect(await screen.findByText('Not imported — nothing was changed.')).toBeOnTheScreen();
    expect(screen.getByText('This file is not JSON.')).toBeOnTheScreen();
    expect(await db.all('SELECT * FROM exercise')).toEqual([]);
  });

  it('never merges: with data on the device it offers only an explicit replace', async () => {
    await saveBodyweight(db, '2026-09-30', 83_000, clock.now());
    await render(withStore(<SettingsScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Import a file' }));
    expect(await screen.findByText('This iPhone already holds data. Importing never merges: it can only replace what is here.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Import fitness-lab-export-v1.json' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Replace all data on this iPhone' }));
    expect(screen.getByText(/A copy of the current data is kept on the device first\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(async () => expect(await db.all('SELECT count(*) AS n FROM replaced_data')).toEqual([{ n: 1 }]));
    expect(await db.all("SELECT * FROM bodyweight_entry WHERE measured_on = '2026-09-30'")).toEqual([]);
  });

  it('exports everything as one V1 file through the share sheet', async () => {
    await saveBodyweight(db, '2026-10-08', 82_400, clock.now());
    await render(withStore(<SettingsScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Export data' }));
    await screen.findByText('Export ready.');
    expect(mockShared[0].name).toBe('fitness-lab-export-v1-2026-10-09.json');
    const doc = JSON.parse(mockShared[0].text) as { format: string; format_version: number; bodyweight: unknown[] };
    expect([doc.format, doc.format_version, doc.bodyweight.length]).toEqual(['fitness-lab-export', 1, 1]);
  });
});
