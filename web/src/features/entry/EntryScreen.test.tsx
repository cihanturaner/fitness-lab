import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, PerformedSet } from '@/api/types'
import { BENCH, CURL, INCLINE, entryFixture, fakeApi } from '@/test/fakeApi'
import { EntryScreen } from './EntryScreen'

function performed(order: number, overrides: Partial<PerformedSet> = {}): PerformedSet {
  return {
    id: `set-${order}`,
    workout_id: 'w1',
    exercise_id: 'bench',
    set_order: order,
    set_type: 'working',
    load_kg: '82.5',
    reps: 6,
    rir: 2,
    notes: null,
    entered_at_utc: 'x',
    updated_at_utc: 'x',
    ...overrides,
  }
}

function serve(initial: Entry, extra: Parameters<typeof fakeApi>[0] = {}) {
  let current = initial
  const calls = fakeApi({
    'GET /api/workouts/w1/entry': () => ({ body: current }),
    'GET /api/exercises': () => ({ body: [BENCH, INCLINE, CURL] }),
    ...extra,
  })
  return {
    calls,
    set(next: Entry) {
      current = next
    },
  }
}

describe('EntryScreen', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('keeps the plan and the actual record visibly separate', async () => {
    serve(entryFixture())
    render(<EntryScreen workoutId="w1" />)

    const slot = await screen.findByTestId('slot-upper_a.01')
    const planned = within(slot).getByRole('region', { name: /^Planned/ })
    const actual = within(slot).getByRole('region', { name: /^Actual/ })
    expect(within(planned).getByRole('table', { name: 'Planned sets' })).toHaveTextContent('5–8')
    expect(within(planned).getByText('0–1')).toBeInTheDocument()
    expect(within(actual).getByText(/No sets recorded/)).toBeInTheDocument()
    expect(within(actual).getByTestId('last-performance')).toHaveTextContent('80 kg × 6 @ RIR 2')
    expect(screen.getByTestId('workout-status')).toHaveTextContent('Draft')
  })

  it('saves a new set only when the lifter saves it, with exactly what was typed', async () => {
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(1) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')

    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    const load = within(slot).getByRole('textbox', { name: 'Load in kg, new set 1' })
    expect(load).toHaveValue('')
    expect(within(slot).getByRole('textbox', { name: 'Reps, new set 1' })).toHaveAttribute(
      'placeholder',
      '5–8',
    )
    expect(server.calls.some((call) => call.method === 'POST')).toBe(false)

    await user.type(load, '82,5')
    await user.type(within(slot).getByRole('textbox', { name: 'Reps, new set 1' }), '6')
    await user.type(within(slot).getByRole('textbox', { name: 'RIR, new set 1' }), '2{Enter}')

    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'POST')?.body).toEqual({
        exercise_id: 'bench',
        set_type: 'working',
        load_kg: '82.5',
        reps: 6,
        rir: 2,
        notes: null,
      }),
    )
  })

  it('refuses to save a new set without reps', async () => {
    const server = serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    await user.type(within(slot).getByRole('textbox', { name: 'Load in kg, new set 1' }), '80{Enter}')
    expect(await within(slot).findByRole('alert')).toHaveTextContent('Enter reps')
    expect(server.calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('edits an actual set field on commit', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'PATCH /api/sets/set-1': () => ({ body: performed(1, { reps: 7 }) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const reps = await screen.findByRole('textbox', { name: 'Reps, set 1' })
    await user.clear(reps)
    await user.type(reps, '7{Enter}')
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ reps: 7 }),
    )
  })

  it('reorders within an exercise by swapping global positions', async () => {
    const sets = [performed(1), performed(2, { exercise_id: 'curl' }), performed(3)]
    const server = serve(entryFixture({ sets, exercises: { bench: BENCH, curl: CURL } }), {
      'PUT /api/workouts/w1/set-order': () => ({ body: [] }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Move set 2 earlier' }))
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({
        set_ids: ['set-3', 'set-2', 'set-1'],
      }),
    )
  })

  it('substitutes the whole slot', async () => {
    const server = serve(entryFixture(), {
      'PUT /api/workouts/w1/slots/slot-1/exercise': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Exercise performed for slot 1' }),
      'incline',
    )
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({
        exercise_id: 'incline',
      }),
    )
  })

  it('shows why a workout cannot be completed yet', async () => {
    serve(entryFixture(), {
      'POST /api/workouts/w1/complete': () => ({
        status: 409,
        body: {
          detail: 'workout cannot be completed yet',
          blockers: [{ rule: 'C1', message: 'a workout with no sets is not evidence of training', set_orders: [] }],
          advisories: [],
        },
      }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.click(await screen.findByRole('button', { name: 'Complete workout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no sets is not evidence')
  })

  it('locks a complete workout until it is reopened', async () => {
    const complete = entryFixture({ sets: [performed(1)] })
    complete.workout = { ...complete.workout, status: 'complete' }
    const server = serve(complete, {
      'POST /api/workouts/w1/reopen': () => ({ body: { ...complete.workout, status: 'draft' } }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)

    expect(await screen.findByRole('textbox', { name: 'Reps, set 1' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add set' })).not.toBeInTheDocument()
    server.set(entryFixture({ sets: [performed(1)] }))
    await user.click(screen.getByRole('button', { name: 'Reopen to correct' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reps, set 1' })).toBeEnabled())
  })

  it('records extra exercises outside the plan', async () => {
    serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Add an exercise' }), 'curl')
    const extra = await screen.findByTestId('extra-curl')
    expect(within(extra).getByText('Preacher Curl')).toBeInTheDocument()
    expect(within(extra).getByRole('textbox', { name: 'Reps, new set 1' })).toBeInTheDocument()
  })
})
