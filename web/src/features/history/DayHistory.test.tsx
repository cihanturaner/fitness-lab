import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryDay, HistoryDays, PerformedSet } from '@/api/types'
import { BENCH, CURL, INCLINE, TARGET, fakeApi } from '@/test/fakeApi'
import { DayHistory } from './DayHistory'

function set(id: string, exerciseId: string, load: string, reps: number, rir: number | null): PerformedSet {
  return {
    id,
    workout_id: 'w1',
    exercise_id: exerciseId,
    set_order: 1,
    set_type: 'working',
    load_lb: load,
    reps,
    rir,
    notes: null,
    entered_at_utc: 'x',
    updated_at_utc: 'x',
  }
}

const THURSDAY: HistoryDay = {
  date: '2026-09-24',
  workouts: [
    {
      workout_id: 'w1',
      performed_time_local: null,
      planned_workout_name: 'Lower B',
      planned_work_sets: 19,
      actual_work_sets: 2,
      shortened: true,
      exercises: [
        { exercise: BENCH, planned_exercise: null, slot_id: 's1', sets: [set('a', 'bench', '44', 3, null)] },
        { exercise: INCLINE, planned_exercise: BENCH, slot_id: 's2', sets: [set('b', 'incline', '11', 11, 2)] },
      ],
    },
  ],
  bodyweight_kg: '72',
  nutrition: {
    calories_kcal: 1850,
    calories_complete: true,
    protein_g: 150,
    carbs_g: 200,
    fat_g: 50,
    target: TARGET,
  },
}

const WEDNESDAY: HistoryDay = {
  date: '2026-09-23',
  workouts: [],
  bodyweight_kg: '71.8',
  nutrition: null,
}

describe('DayHistory', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('shows one card per date, newest first, holding only what was recorded that day', async () => {
    fakeApi({ 'GET /api/history/days': () => ({ body: { days: [THURSDAY, WEDNESDAY], next_before: null } }) })
    render(<DayHistory />)
    const days = await screen.findAllByTestId('history-day')
    expect(days.map((day) => day.getAttribute('aria-label'))).toEqual(['THU 24 SEP', 'WED 23 SEP'])

    const thursday = days[0] as HTMLElement
    const workout = within(thursday).getByTestId('day-workout')
    expect(workout).toHaveTextContent('Lower B')
    expect(within(workout).getByTestId('day-shortened')).toHaveTextContent('Shortened')
    expect(workout).toHaveTextContent('2 of 19 working sets')
    const exercises = within(workout).getAllByTestId('day-exercise')
    expect(exercises[0]).toHaveTextContent('Smith Flat Bench Press44 lb × 3 @ RIR —')
    // A changed exercise shows what was performed and what was planned.
    expect(exercises[1]).toHaveTextContent('Performed: Incline Smith Press')
    expect(exercises[0]).not.toHaveTextContent('Performed:')
    expect(within(exercises[1] as HTMLElement).getByTestId('day-planned')).toHaveTextContent('Planned: Smith Flat Bench Press')
    // The exercise name opens its history, the secondary view.
    expect(within(exercises[1] as HTMLElement).getByRole('link', { name: 'Incline Smith Press' })).toHaveAttribute(
      'href',
      '#/history/incline',
    )
    expect(within(thursday).getByTestId('day-bodyweight')).toHaveTextContent('Bodyweight72 kg')
    expect(within(thursday).getByTestId('day-nutrition')).toHaveTextContent('Nutrition1850 kcal · 150P · 200C · 50Ftarget 2430')

    const wednesday = days[1] as HTMLElement
    expect(within(wednesday).queryByTestId('day-workout')).not.toBeInTheDocument()
    expect(within(wednesday).queryByTestId('day-nutrition')).not.toBeInTheDocument()
    expect(within(wednesday).getByTestId('day-bodyweight')).toHaveTextContent('71.8 kg')
  })

  it('filters by kind and pages to earlier days', async () => {
    const pages: Record<string, HistoryDays> = {
      all: { days: [THURSDAY], next_before: '2026-09-24' },
      earlier: { days: [WEDNESDAY], next_before: null },
      bodyweight: { days: [WEDNESDAY], next_before: null },
    }
    const calls = fakeApi({
      'GET /api/history/days': (call) => {
        const url = new URL(call.url, 'http://x')
        if (url.searchParams.get('before')) return { body: pages.earlier }
        return { body: url.searchParams.get('kind') === 'bodyweight' ? pages.bodyweight : pages.all }
      },
    })
    const user = userEvent.setup()
    render(<DayHistory />)
    expect(await screen.findAllByTestId('history-day')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Earlier days' }))
    await waitFor(() => expect(screen.getAllByTestId('history-day')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: 'Earlier days' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Bodyweight' }))
    await waitFor(() => expect(screen.getAllByTestId('history-day')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Bodyweight' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls.map((call) => call.url)).toEqual([
      '/api/history/days?kind=all&limit=21',
      '/api/history/days?kind=all&limit=21&before=2026-09-24',
      '/api/history/days?kind=bodyweight&limit=21',
    ])
  })

  it('says plainly when nothing is recorded', async () => {
    fakeApi({ 'GET /api/history/days': () => ({ body: { days: [], next_before: null } }) })
    render(<DayHistory />)
    expect(await screen.findByText('Nothing recorded yet.')).toBeInTheDocument()
  })

  it('is the only primary History view: no Sessions, no tabs, exercise history one link away', async () => {
    fakeApi({ 'GET /api/history/days': () => ({ body: { days: [THURSDAY], next_before: null } }) })
    render(<DayHistory />)
    await screen.findAllByTestId('history-day')
    expect(screen.queryByRole('navigation', { name: 'History views' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Exercise history →' })).toHaveAttribute('href', '#/history/exercises')
  })

  it('keeps two slots performed as the same exercise as two lines, each with its planned exercise', async () => {
    const twin: HistoryDay = {
      ...THURSDAY,
      workouts: [
        {
          ...(THURSDAY.workouts[0] as HistoryDay['workouts'][number]),
          exercises: [
            { exercise: INCLINE, planned_exercise: BENCH, slot_id: 's1', sets: [set('a', 'incline', '40', 12, 2), set('b', 'incline', '40', 11, 2)] },
            { exercise: INCLINE, planned_exercise: CURL, slot_id: 's7', sets: [set('c', 'incline', '25', 15, 2)] },
          ],
        },
      ],
    }
    fakeApi({ 'GET /api/history/days': () => ({ body: { days: [twin], next_before: null } }) })
    render(<DayHistory />)
    const lines = await screen.findAllByTestId('day-exercise')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('Performed: Incline Smith PressPlanned: Smith Flat Bench Press40 lb × 12 @ RIR 2 · 40 lb × 11 @ RIR 2')
    expect(lines[1]).toHaveTextContent(`Performed: Incline Smith PressPlanned: ${CURL.name}25 lb × 15 @ RIR 2`)
  })
})
