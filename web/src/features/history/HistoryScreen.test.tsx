import { render, screen, within } from '@testing-library/react'
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
    load_kg: load,
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
      sets: [set('a', '40', 8, null, 'warmup'), set('b', '82.5', 6, 2), set('c', '82.5', 6, 2), set('d', '82.5', 5, 1)],
    },
    {
      workout_id: 'w2',
      performed_on: '2026-09-30',
      performed_time_local: null,
      planned_workout_name: 'Upper A',
      block_week: 2,
      sets: [set('e', '85', 6, 2), set('f', '85', 5, 1), set('g', '85', 5, 1)],
    },
  ],
}

describe('HistoryScreen', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('shows every completed exposure in order with its exact kg × reps @ RIR', async () => {
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
    expect(within(first).getAllByTestId('history-set').map((cell) => cell.textContent)).toEqual([
      '40×8w',
      '82.5×6@2',
      '82.5×6@2',
      '82.5×5@1',
    ])
    expect(first).toHaveTextContent('Upper A')
    expect(within(second).getAllByTestId('history-set').map((cell) => cell.textContent)).toEqual([
      '85×6@2',
      '85×5@1',
      '85×5@1',
    ])
    expect(screen.getByRole('img', { name: 'Top recorded load per session' })).toBeInTheDocument()
  })

  it('says so when nothing is complete yet', async () => {
    fakeApi({ 'GET /api/history/exercises': () => ({ body: [] }) })
    render(<HistoryScreen exerciseId={null} />)
    expect(await screen.findByText(/Completed sessions appear here/)).toBeInTheDocument()
  })
})
