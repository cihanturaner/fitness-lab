import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backup } from '@/api/types'
import { PROGRAM, WEEK, fakeApi } from '@/test/fakeApi'
import { TURKISH_SOURCE_SHA256, parseProgramNotes } from './programNotes'
import { SettingsScreen } from './SettingsScreen'

const REPO = path.resolve(import.meta.dirname, '../../../..')
const LOCKED_NOTES = readFileSync(path.join(REPO, 'programs/advanced-natural-12w/package/program-notes.md'), 'utf-8')
const LOCKED_PROGRAM = JSON.parse(
  readFileSync(path.join(REPO, 'programs/advanced-natural-12w/artifact/locked_workout_program.json'), 'utf-8'),
) as { substitution_matrix: Record<string, string[] | string> }

const NOTES = [
  '# 12-Week Program',
  '',
  '- Source artifact: `locked_workout_program.json`',
  '',
  '## Deload (P1)',
  '',
  '```json',
  '{"implementation": {"duration_days": 7, "set_mapping": {"4": 2, "3": 2}, "failure": "NONE"}, "automatic": false}',
  '```',
  '',
  '## Weekly schedule',
  '',
  '- Monday: Upper A (23 work sets, 85–105 min)',
].join('\n')

const BACKUP: Backup = {
  name: '20261001T070000000000Z-manual-backup.db',
  kind: 'manual',
  created_at_utc: '2026-10-01T07:00:00Z',
  size_bytes: 204_800,
}

function serve(extra: Parameters<typeof fakeApi>[0] = {}) {
  let backups: Backup[] = []
  const calls = fakeApi({
    'GET /api/program/active': () => ({ body: { ...PROGRAM, notes_text: NOTES } }),
    'GET /api/week': () => ({ body: WEEK }),
    'GET /api/backups': () => ({ body: backups }),
    'POST /api/backup': () => {
      backups = [BACKUP]
      return { status: 201, body: BACKUP }
    },
    'PUT /api/program/block-start': (call) => ({
      body: {
        version_id: 'v1',
        start_on: (call.body as { start_on: string }).start_on,
        week_1_start: '2026-09-28',
        week_1_end: '2026-10-04',
      },
    }),
    ...extra,
  })
  return calls
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the block start and its week 1, and moves it after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const calls = serve()
    const user = userEvent.setup()
    render(<SettingsScreen />)
    const block = await screen.findByRole('region', { name: 'Training block' })
    expect(within(block).getByTestId('block-start')).toHaveTextContent('Thu 1 Oct')
    expect(within(block).getByTestId('block-week-1')).toHaveTextContent('28 Sep – 4 Oct')
    const field = within(block).getByLabelText('Block start date')
    await user.clear(field)
    await user.type(field, '2026-10-05')
    await user.click(within(block).getByRole('button', { name: 'Save start date' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Week 1 becomes 5–11 Oct'))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ start_on: '2026-10-05' }),
    )
    expect(await within(block).findByRole('status')).toHaveTextContent('Block start saved')
  })

  it('says a mid-week start leaves pre-block days in week 1, and declining changes nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const calls = serve()
    const user = userEvent.setup()
    render(<SettingsScreen />)
    const block = await screen.findByRole('region', { name: 'Training block' })
    const field = within(block).getByLabelText('Block start date')
    await user.clear(field)
    await user.type(field, '2026-10-08')
    await user.click(within(block).getByRole('button', { name: 'Save start date' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Mon 5 Oct – Wed 7 Oct count as pre-block'))
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('says why the start cannot move once review decisions are recorded', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    serve({
      'PUT /api/program/block-start': () => ({
        status: 409,
        body: { detail: "1 weekly review decision(s) are recorded against this block's weeks, so its start can no longer be moved" },
      }),
    })
    const user = userEvent.setup()
    render(<SettingsScreen />)
    const block = await screen.findByRole('region', { name: 'Training block' })
    const field = within(block).getByLabelText('Block start date')
    await user.clear(field)
    await user.type(field, '2026-10-05')
    await user.click(within(block).getByRole('button', { name: 'Save start date' }))
    expect(await within(block).findByRole('alert')).toHaveTextContent('can no longer be moved')
  })

  it('backs up on request and lists the backup', async () => {
    const calls = serve()
    const user = userEvent.setup()
    render(<SettingsScreen />)
    const backups = await screen.findByRole('region', { name: 'Backups' })
    expect(within(backups).getByText(/No backups yet/)).toBeInTheDocument()
    await user.click(within(backups).getByRole('button', { name: 'Back up now' }))
    expect(await within(backups).findByRole('status')).toHaveTextContent('Backup saved')
    expect(within(backups).getAllByTestId('backup-row')).toHaveLength(1)
    expect(within(backups).getByText('Manual backup')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([{}])
  })

  it('shows the program and its rules in plain language', async () => {
    serve()
    render(<SettingsScreen />)
    const program = await screen.findByRole('region', { name: 'Program' })
    expect(within(program).getByText('12-Week Advanced Natural Hypertrophy + Strength Program')).toBeInTheDocument()
    expect(within(program).getByText('Deload (P1)')).toBeInTheDocument()
    expect(within(program).getByText('Duration days')).toBeInTheDocument()
    expect(within(program).getByText('Monday: Upper A (23 work sets, 85–105 min)')).toBeInTheDocument()
  })

  it('shows the locked program area wholly in Turkish, keeping names and tokens verbatim', async () => {
    fakeApi({
      'GET /api/program/active': () => ({
        body: {
          ...PROGRAM,
          activated_at_utc: '2026-09-24T10:00:00Z',
          notes_text: LOCKED_NOTES,
          notes_sha256: TURKISH_SOURCE_SHA256,
        },
      }),
      'GET /api/week': () => ({ body: WEEK }),
      'GET /api/backups': () => ({ body: [] }),
    })
    render(<SettingsScreen />)
    const program = await screen.findByRole('region', { name: 'Program' })
    expect(program).toHaveAttribute('lang', 'tr')
    const facts = within(program).getByTestId('program-facts')
    expect(facts).toHaveTextContent('Program12 Haftalık İleri Seviye Doğal Hipertrofi + Kuvvet Programı')
    expect(facts).toHaveTextContent('Sürüm1.0.0')
    expect(facts).toHaveTextContent('Aktifleşme tarihi24 Eylül 2026')
    for (const heading of ['Program Hakkında', 'Hafifletme Haftası (P1)', '12. Hafta (P2)', '1–11. Haftalar']) {
      expect(within(program).getByRole('button', { name: heading })).toBeInTheDocument()
    }

    // No English left: take out exercise names and the source's own tokens, then look for
    // any English word the area could still carry.
    let text = program.textContent ?? ''
    const names = new Set<string>(['Upper A', 'Lower A', 'Upper B', 'Lower B', '45° Back Extension', 'Hip Thrust'])
    for (const [key, value] of Object.entries(LOCKED_PROGRAM.substitution_matrix)) {
      if (!Array.isArray(value)) continue
      names.add(key)
      for (const item of value) names.add(item.replace(' if unavailable/intolerant', ''))
    }
    for (const name of [...names].sort((a, b) => b.length - a.length)) text = text.split(name).join(' ')
    for (const token of ['load * (1 + (reps + RIR) / 30)', 'FINAL_PATCHED_LOCKED', 'DECISION_GRADE_PASS_WITH_CAVEAT', 'locked_workout_program.json']) {
      text = text.split(token).join(' ')
    }
    const english =
      /\b(the|and|of|to|if|for|from|with|only|not|none|yes|no|true|false|week|weeks|deload|taper|version|active|since|rules?|program rules|about|source|sets|work|rest|duration|automatic|progression|calibration|warm-?up|volume|direct|fractional|notes?|importing|switching|command|line|guidance|decisions|app|unavailable|intolerant|another|hamstrings?|core|natural)\b/i
    expect(text.match(english)).toBeNull()
  })
})

describe('parseProgramNotes', () => {
  it('splits sections and parses their JSON', () => {
    const sections = parseProgramNotes(NOTES)
    expect(sections.map((section) => section.title)).toEqual(['About', 'Deload (P1)', 'Weekly schedule'])
    expect(sections[1]?.blocks[0]).toEqual({
      kind: 'json',
      value: { implementation: { duration_days: 7, set_mapping: { '4': 2, '3': 2 }, failure: 'NONE' }, automatic: false },
    })
  })
})
