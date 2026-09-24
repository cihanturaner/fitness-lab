import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { fixedClock } from '@/data/clock';
import type { Db } from '@/data/db/database';
import { openTestDatabase, type TestDb } from '@/data/db/test-database';
import { PROGRAM } from '@/data/program';
import { PROGRAM_NOTES_TR, TURKISH_SOURCE_SHA256 } from '@/data/program-notes-tr';
import { blockStart } from '@/data/repo/block';
import { DataProvider } from '@/store/data-store';

import { parseProgramNotes, turkishProgramName } from '../program-notes';
import { SettingsScreen } from '../settings-screen';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), Stack: { Screen: () => null } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

const ROOT = join(__dirname, '../../../../..');
const clock = fixedClock('2026-09-24');
let db: TestDb;
beforeEach(async () => {
  db = await openTestDatabase();
});

const withStore = (ui: React.ReactElement) => (
  <DataProvider open={async () => db as Db} clock={clock}>
    {ui}
  </DataProvider>
);

describe('Turkish program rules', () => {
  it('are the frozen web text, byte for byte, for exactly this program’s notes', () => {
    expect(PROGRAM_NOTES_TR).toBe(readFileSync(join(ROOT, 'web/src/features/settings/program-notes.tr.md'), 'utf8'));
    const notes = readFileSync(join(ROOT, 'programs/advanced-natural-12w/package/program-notes.md'));
    expect(createHash('sha256').update(notes).digest('hex')).toBe(TURKISH_SOURCE_SHA256);
  });

  it('parse into the web’s sections with verbatim technical content', () => {
    const sections = parseProgramNotes(PROGRAM_NOTES_TR, 'Program Hakkında');
    expect(sections[0].title).toBe('Program Hakkında');
    expect(sections.map((s) => s.title)).toEqual(
      expect.arrayContaining(['Haftalık Program', 'Uygulama Kuralları', 'İlerleme Kuralları', 'Plato / İlerleme Durması']),
    );
    expect(turkishProgramName(PROGRAM_NOTES_TR)).toBe('12 Haftalık İleri Seviye Doğal Hipertrofi + Kuvvet Programı');
    const text = JSON.stringify(sections);
    expect(text).toContain('Yama P7′');
    expect(text).toContain('Neutral-Grip Lat Pulldown');
  });
});

describe('SettingsScreen', () => {
  it('sets the block start after confirming, and shows the program in Turkish', async () => {
    await render(withStore(<SettingsScreen />));
    expect(await screen.findByText('Not set — weeks are not numbered yet')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Block start date, YYYY-MM-DD'), '2026-10-01');
    await fireEvent.press(screen.getByRole('button', { name: 'Set block start' }));
    expect(screen.getByText(/Week 1 becomes 28 Sep – 4 Oct; in week 1, Mon, Tue, Wed count as pre-block\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Set start' }));
    await waitFor(async () => expect(await blockStart(db, PROGRAM.key)).toBe('2026-10-01'));
    expect(await screen.findByText('Thursday 1 October')).toBeOnTheScreen();

    expect(screen.getByText('12 Haftalık İleri Seviye Doğal Hipertrofi + Kuvvet Programı')).toBeOnTheScreen();
    expect(screen.getByText('Program Kuralları')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Uygulama Kuralları' }));
    expect(screen.getByText('Yama P7′')).toBeOnTheScreen();
  });

  it('refuses a date that is not a calendar date', async () => {
    await render(withStore(<SettingsScreen />));
    await fireEvent.changeText(await screen.findByLabelText('Block start date, YYYY-MM-DD'), '2026-02-30');
    await fireEvent.press(screen.getByRole('button', { name: 'Set block start' }));
    expect(screen.getByText('Type the date as YYYY-MM-DD, for example 2026-10-01.')).toBeOnTheScreen();
  });
});
