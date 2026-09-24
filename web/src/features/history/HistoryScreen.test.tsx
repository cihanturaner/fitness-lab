import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExerciseHistory, PerformedSet } from '@/api/types'
import { BENCH, fakeApi } from '@/test/fakeApi'
import { HistoryScreen } from './HistoryScreen'

function set(id: string, load: string, reps: number, rir: number | null, type: PerformedSet['set_type'] = 'working'): PerformedSet {
  return {
    id,
    workout_id: 'w',
    exercise_id: 'bench',
    set_order: 1,
    set_type: type,
    load_lb: load,
    reps,
    rir,
    notes: null,
    entered_at_utc: 'x',
    updated_at_utc: 'x',
  }
}

const HISTORY: ExerciseHistory = {
  exercise: BENCH,
  block_start_on: '2026-09-21',
  exposures: [
    {
      workout_id: 'w1',
      performed_on: '2026-09-23',
      performed_time_local: null,
      planned_workout_name: 'Upper A',
      block_week: 1,
      phase: 'block',
      sets: [set('a', '40', 8, null, 'warmup'), set('b', '82.5', 6, 2), set('c', '82.5', 6, 2), set('d', '82.5', 5, 1)],
    },
    {
      workout_id: 'w2',
      performed_on: '2026-09-30',
      performed_time_local: null,
      planned_workout_name: 'Upper A',
      block_week: 2,
      phase: 'block',
      sets: [set('e', '85', 6, 2), set('f', '85', 5, 1), set('g', '85', 5, 1)],
    },
  ],
}

describe('HistoryScreen', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('shows every completed exposure in order with its exact lb × reps @ RIR', async () => {
    fakeApi({
      'GET /api/history/exercises': () => ({
        body: [{ exercise: BENCH, exposures: 2, last_performed_on: '2026-09-30' }],
      }),
      'GET /api/exercises/bench/history': () => ({ body: HISTORY }),
    })
    render(<HistoryScreen exerciseId={null} />)
    const rows = await screen.findAllByTestId('history-exposure')
    expect(rows).toHaveLength(2)
    const first = rows[0] as HTMLElement
    const second = rows[1] as HTMLElement
    // Working sets aligned by set number, every unit spelled out; the warm-up is counted.
    expect(within(first).getAllByTestId('history-set').map((cell) => cell.textContent)).toEqual([
      '82.5 lb × 6 @ RIR 2',
      '82.5 lb × 6 @ RIR 2',
      '82.5 lb × 5 @ RIR 1',
    ])
    expect(first).toHaveTextContent('Upper A+1 warm-up')
    expect(within(second).getAllByTestId('history-set').map((cell) => cell.textContent)).toEqual([
      '85 lb × 6 @ RIR 2',
      '85 lb × 5 @ RIR 1',
      '85 lb × 5 @ RIR 1',
    ])
    expect(within(first).getByTestId('history-week')).toHaveTextContent('1')
    expect(within(second).getByTestId('history-week')).toHaveTextContent('2')
    expect(screen.getByRole('img', { name: 'Top recorded load per session' })).toBeInTheDocument()
  })

  it('compares each exposure with the previous one of the same session, week to week', async () => {
    const exposure = (id: string, day: string, session: string, week: number, load: string, phase: 'pre_block' | 'block' = 'block') => ({
      workout_id: id,
      performed_on: day,
      performed_time_local: null,
      planned_workout_name: session,
      block_week: week,
      phase,
      sets: [set(`${id}-1`, load, 8, 2)],
    })
    fakeApi({
      'GET /api/history/exercises': () => ({
        body: [{ exercise: BENCH, exposures: 5, last_performed_on: '2026-10-15' }],
      }),
      'GET /api/exercises/bench/history': () => ({
        body: {
          exercise: BENCH,
          block_start_on: '2026-10-01',
          exposures: [
            exposure('p', '2026-09-28', 'Upper A', 1, '50', 'pre_block'),
            exposure('a1', '2026-10-05', 'Upper A', 2, '60'),
            exposure('b1', '2026-10-08', 'Upper B', 2, '70'),
            exposure('a2', '2026-10-12', 'Upper A', 3, '62.5'),
            exposure('b2', '2026-10-15', 'Upper B', 3, '70'),
          ],
        } satisfies ExerciseHistory,
      }),
    })
    const user = userEvent.setup()
    render(<HistoryScreen exerciseId={null} />)
    const rows = await screen.findAllByTestId('history-exposure')
    expect(rows.map((row) => within(row).getByTestId('history-week').textContent)).toEqual(['Pre', '2', '2', '3', '3'])
    // a2 against a1 (+2.5 lb), b2 against b1 (same) — never Upper A against Upper B.
    expect(rows[3]).toHaveTextContent('+2.5 lb')
    expect(rows[4]).toHaveTextContent('same')
    // Since week 1 of the latest session (Upper B): from its first in-block exposure.
    expect(screen.getByText(/Since week 2 · Upper B/)).toBeInTheDocument()
    expect(screen.getByTestId('history-since')).toHaveTextContent('same')

    await user.click(screen.getByRole('button', { name: 'Upper A' }))
    expect(await screen.findAllByTestId('history-exposure')).toHaveLength(3)
    expect(screen.getByTestId('history-since')).toHaveTextContent('+2.5 lb')
    expect(screen.getByRole('img', { name: 'Top recorded load per session' })).toBeInTheDocument()
  })

  it('says so when nothing is complete yet', async () => {
    fakeApi({ 'GET /api/history/exercises': () => ({ body: [] }) })
    render(<HistoryScreen exerciseId={null} />)
    expect(await screen.findByText(/Completed sessions appear here/)).toBeInTheDocument()
  })
})
