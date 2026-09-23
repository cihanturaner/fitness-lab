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

    await user.selectOptions(
      within(slot).getByRole('combobox', { name: 'Set type, new set 1' }),
      'working',
    )
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

  it('never takes the set type from the plan: the lifter chooses it', async () => {
    const server = serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    expect(within(slot).getByRole('combobox', { name: 'Set type, new set 1' })).toHaveValue('')
    await user.type(within(slot).getByRole('textbox', { name: 'Reps, new set 1' }), '6{Enter}')
    expect(await within(slot).findByRole('alert')).toHaveTextContent('Choose a set type')
    expect(server.calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('offers the type of the previous recorded set of the exercise, not the plan', async () => {
    serve(entryFixture({ sets: [performed(1, { set_type: 'warmup' })] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    expect(within(slot).getByRole('combobox', { name: 'Set type, new set 2' })).toHaveValue('warmup')
  })

  it('saves a set once even when Enter is pressed twice', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/sets': async () => {
        await held
        return { status: 201, body: performed(2) }
      },
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    const reps = within(slot).getByRole('textbox', { name: 'Reps, new set 2' })
    await user.type(reps, '5{Enter}{Enter}')
    expect(within(slot).getByRole('button', { name: 'Save set' })).toBeDisabled()
    release()
    await waitFor(() =>
      expect(within(slot).getByRole('button', { name: 'Save set' })).toBeEnabled(),
    )
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('refuses numbers too large to be a real entry', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const reps = await screen.findByRole('textbox', { name: 'Reps, set 1' })
    await user.clear(reps)
    await user.type(reps, '100000000000000000000{Enter}')
    expect(reps).toHaveAttribute('aria-invalid', 'true')
    expect(server.calls.some((call) => call.method === 'PATCH')).toBe(false)
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

  // --- final council ----------------------------------------------------------------------

  it('keeps a failed edit visibly unsaved next to the field, and retries it', async () => {
    let fail = true
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'PATCH /api/sets/set-1': () =>
        fail ? { status: 503, body: { detail: 'unavailable' } } : { body: performed(1, { reps: 7 }) },
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const reps = await screen.findByRole('textbox', { name: 'Reps, set 1' })
    await user.clear(reps)
    await user.type(reps, '7{Enter}')
    const row = reps.closest('tr') as HTMLElement
    expect(await within(row).findByRole('alert')).toHaveTextContent(/not saved/i)
    expect(reps).toHaveValue('7')

    fail = false
    await user.type(reps, '{Enter}')
    await waitFor(() => expect(server.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2))
    await waitFor(() => expect(within(row).queryByRole('alert')).not.toBeInTheDocument())
  })

  it('says why an invalid edit was not saved, next to the field', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const reps = await screen.findByRole('textbox', { name: 'Reps, set 1' })
    await user.clear(reps)
    await user.type(reps, '8x')
    await user.tab()
    const row = reps.closest('tr') as HTMLElement
    expect(within(row).getByRole('alert')).toHaveTextContent(/not saved.*whole number/i)
    expect(server.calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('refuses to complete while anything typed is unsaved', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    await user.type(within(slot).getByRole('textbox', { name: 'Reps, new set 2' }), '9')
    await user.click(screen.getByRole('button', { name: 'Complete workout' }))
    const alert = await screen.findByText(/not completed/i)
    expect(alert.closest('[role="alert"]')).toHaveTextContent(/unsaved/i)
    expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(false)
    // The typed set is still there to be saved.
    expect(within(slot).getByRole('textbox', { name: 'Reps, new set 2' })).toHaveValue('9')
  })

  it('asks before closing a new set row that holds unsaved input', async () => {
    serve(entryFixture())
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    await user.type(within(slot).getByRole('textbox', { name: 'Reps, new set 1' }), '6')
    await user.click(within(slot).getByRole('button', { name: 'Done' }))
    expect(confirm).toHaveBeenCalled()
    expect(within(slot).getByRole('textbox', { name: 'Reps, new set 1' })).toHaveValue('6')
  })

  it('names blocked sets the way the screen numbers them', async () => {
    const sets = [performed(1), performed(2, { exercise_id: 'curl' }), performed(3, { reps: null })]
    serve(entryFixture({ sets, exercises: { bench: BENCH, curl: CURL } }), {
      'POST /api/workouts/w1/complete': () => ({
        status: 409,
        body: {
          detail: 'workout cannot be completed yet',
          blockers: [{ rule: 'C2', message: 'sets missing reps: [3]', set_orders: [3] }],
          advisories: [],
        },
      }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.click(await screen.findByRole('button', { name: 'Complete workout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Smith Flat Bench Press set 2')
  })

  it('flags a draft that is not dated today', async () => {
    serve(entryFixture())
    render(<EntryScreen workoutId="w1" />)
    expect(await screen.findByTestId('draft-date-notice')).toHaveTextContent(/not today/i)
  })

  it('does not flag a draft dated today', async () => {
    const today = entryFixture()
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    today.workout = { ...today.workout, performed_on: iso }
    serve(today)
    render(<EntryScreen workoutId="w1" />)
    await screen.findByTestId('slot-upper_a.01')
    expect(screen.queryByTestId('draft-date-notice')).not.toBeInTheDocument()
  })

  it('names the session the last performance came from', async () => {
    const fixture = entryFixture()
    const bench = fixture.last_performance.bench
    if (!bench) throw new Error('fixture')
    fixture.last_performance = { bench: { ...bench, planned_workout_name: 'Upper B' } }
    serve(fixture)
    render(<EntryScreen workoutId="w1" />)
    expect(await screen.findByTestId('last-performance')).toHaveTextContent('Upper B')
  })

  it('asks before deleting a recorded set', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'DELETE /api/sets/set-1': () => ({ status: 204 }),
    })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.click(await screen.findByRole('button', { name: 'Delete set 1' }))
    expect(confirm).toHaveBeenCalled()
    expect(server.calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('does not count warm-ups when hinting the next planned set', async () => {
    serve(entryFixture({ sets: [performed(1, { set_type: 'warmup' })] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    // Planned set 1 targets RIR 2; set 2 targets 0-1.
    expect(within(slot).getByRole('textbox', { name: 'RIR, new set 2' })).toHaveAttribute('placeholder', '2')
  })

  it('completes right after a set is saved without calling it unsaved', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/sets': async () => {
        await held
        return { status: 201, body: performed(2) }
      },
      'POST /api/workouts/w1/complete': () => ({
        body: { workout: entryFixture().workout, advisories: [], renumbered: false },
      }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    await user.type(within(slot).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}')
    const completing = user.click(screen.getByRole('button', { name: 'Complete workout' }))
    release()
    await completing
    await waitFor(() =>
      expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(true),
    )
    expect(screen.queryByText(/not completed/i)).not.toBeInTheDocument()
  })

  it('shows the stored spelling after a save and never sends it twice', async () => {
    const server = serve(entryFixture({ sets: [performed(1, { load_kg: '80' })] }), {
      'PATCH /api/sets/set-1': () => ({ body: performed(1, { load_kg: '82.5' }) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const load = await screen.findByRole('textbox', { name: 'Load in kg, set 1' })
    server.set(entryFixture({ sets: [performed(1, { load_kg: '82.5' })] }))
    await user.clear(load)
    await user.type(load, '82,5{Enter}')
    await waitFor(() => expect(load).toHaveValue('82.5'))
    await user.tab()
    expect(server.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
  })
})
