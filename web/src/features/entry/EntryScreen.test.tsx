import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, PerformedSet } from '@/api/types'
import { BENCH, CURL, INCLINE, entryFixture, fakeApi, type Call } from '@/test/fakeApi'
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

const posts = (calls: Call[]) =>
  calls.filter((call) => call.method === 'POST' && call.url.endsWith('/sets'))

describe('EntryScreen — one compact block per exercise', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('names the exercise once, with the target and last performance as one line each', async () => {
    serve(entryFixture())
    render(<EntryScreen workoutId="w1" />)

    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getAllByText('Smith Flat Bench Press')).toHaveLength(1)
    expect(within(block).getByTestId('target')).toHaveTextContent('Target 2 × 5–8 · RIR 2 / 0–1')
    expect(within(block).getByTestId('last-performance')).toHaveTextContent('Last 80×6@2')
    expect(within(block).queryByText(/Planned/)).not.toBeInTheDocument()
    expect(screen.getByTestId('workout-status')).toHaveTextContent('Draft')
  })

  it('keeps slot notes behind a small control', async () => {
    serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).queryByText(/Marker lift/)).not.toBeInTheDocument()
    await user.click(within(block).getByRole('button', { name: 'Notes, Smith Flat Bench Press' }))
    expect(within(block).getByText(/Marker lift/)).toBeInTheDocument()
  })

  it('shows one empty row per planned set and writes nothing until the lifter saves', async () => {
    const server = serve(entryFixture())
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getAllByTestId('new-set-row')).toHaveLength(2)
    expect(within(block).getByRole('textbox', { name: 'Load in kg, new set 1' })).toHaveValue('')
    expect(within(block).getByRole('textbox', { name: 'Reps, new set 1' })).toHaveAttribute('placeholder', '5–8')
    expect(within(block).getByRole('textbox', { name: 'RIR, new set 2' })).toHaveAttribute('placeholder', '0–1')
    expect(server.calls.some((call) => call.method !== 'GET')).toBe(false)
  })

  it('saves a row with exactly what was typed when Enter is pressed', async () => {
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(1) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')

    await user.type(within(block).getByRole('textbox', { name: 'Load in kg, new set 1' }), '82,5')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '6')
    await user.type(within(block).getByRole('textbox', { name: 'RIR, new set 1' }), '2')
    await user.selectOptions(within(block).getByRole('combobox', { name: 'Set type, new set 1' }), 'working')
    await user.type(within(block).getByRole('textbox', { name: 'RIR, new set 1' }), '{Enter}')

    await waitFor(() =>
      expect(posts(server.calls)[0]?.body).toEqual({
        exercise_id: 'bench',
        set_type: 'working',
        load_kg: '82.5',
        reps: 6,
        rir: 2,
        notes: null,
      }),
    )
  })

  it('saves a row when the lifter tabs out of it: load, reps, RIR, next', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(2) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    // Saved set 1 was a working set: the pending row offers that type, so Tab skips it.
    expect(within(block).getByRole('combobox', { name: 'Set type, new set 2' })).toHaveValue('working')
    const load = within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })

    await user.click(load)
    await user.keyboard('85{Tab}5{Tab}1')
    expect(within(block).getByRole('textbox', { name: 'RIR, new set 2' })).toHaveFocus()
    await user.tab()

    await waitFor(() =>
      expect(posts(server.calls)[0]?.body).toEqual({
        exercise_id: 'bench',
        set_type: 'working',
        load_kg: '85',
        reps: 5,
        rir: 1,
        notes: null,
      }),
    )
  })

  it('never takes the set type from the plan: the first set needs the lifter’s choice', async () => {
    const server = serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getByRole('combobox', { name: 'Set type, new set 1' })).toHaveValue('')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '6{Enter}')
    expect(await within(block).findByRole('alert')).toHaveTextContent(/choose the set type/i)
    expect(posts(server.calls)).toHaveLength(0)
  })

  it('starts a new row with the previous set’s load and type, never the plan’s', async () => {
    serve(entryFixture({ sets: [performed(1, { set_type: 'warmup', load_kg: '40' })] }))
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getByRole('combobox', { name: 'Set type, new set 2' })).toHaveValue('warmup')
    expect(within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })).toHaveValue('40')
    // Warm-ups do not move the hint: planned set 1 (RIR 2) is still next.
    expect(within(block).getByRole('textbox', { name: 'RIR, new set 2' })).toHaveAttribute('placeholder', '2')
  })

  it('passes the load just entered on to the next row', async () => {
    const saved = performed(1, { load_kg: '80', reps: 7, rir: null })
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': () => {
        server.set(entryFixture({ sets: [saved] }))
        return { status: 201, body: saved }
      },
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.type(within(block).getByRole('textbox', { name: 'Load in kg, new set 1' }), '80')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '7')
    await user.selectOptions(within(block).getByRole('combobox', { name: 'Set type, new set 1' }), 'working')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '{Enter}')
    await waitFor(() =>
      expect(within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })).toHaveValue('80'),
    )
    expect(within(block).getByRole('combobox', { name: 'Set type, new set 2' })).toHaveValue('working')
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
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}{Enter}')
    release()
    await waitFor(() => expect(posts(server.calls)).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(posts(server.calls)).toHaveLength(1)
  })

  it('refuses to save a row without reps, and says so next to it', async () => {
    const server = serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.type(within(block).getByRole('textbox', { name: 'Load in kg, new set 1' }), '80{Enter}')
    expect(await within(block).findByRole('alert')).toHaveTextContent(/enter reps/i)
    expect(posts(server.calls)).toHaveLength(0)
  })

  it('refuses an invalid load in a row instead of rounding it', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    const load = within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })
    await user.clear(load)
    await user.type(load, '82.5555')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}')
    expect(await within(block).findByRole('alert')).toHaveTextContent(/load must be kilograms/i)
    expect(posts(server.calls)).toHaveLength(0)
  })

  it('never replaces the lifter’s typing when it passes through the carried load', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(2) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    const load = within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })
    await user.clear(load)
    await user.type(load, '82.55')
    expect(load).toHaveValue('82.55')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}')
    await waitFor(() => expect(posts(server.calls)[0]?.body).toMatchObject({ load_kg: '82.55', reps: 5 }))
  })

  it('Escape clears what was typed in a row', async () => {
    serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    const reps = within(block).getByRole('textbox', { name: 'Reps, new set 1' })
    await user.type(reps, '6{Escape}')
    expect(reps).toHaveValue('')
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

  it('edits a recorded set field on commit', async () => {
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
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(block).getByRole('button', { name: 'Move set 2 earlier' }))
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({
        set_ids: ['set-3', 'set-2', 'set-1'],
      }),
    )
  })

  it('substitutes the whole slot from a secondary control', async () => {
    const server = serve(entryFixture(), {
      'PUT /api/workouts/w1/slots/slot-1/exercise': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).queryByRole('combobox', { name: 'Exercise performed for slot 1' })).not.toBeInTheDocument()
    await user.click(within(block).getByRole('button', { name: 'Substitute, slot 1' }))
    await user.selectOptions(within(block).getByRole('combobox', { name: 'Exercise performed for slot 1' }), 'incline')
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({ exercise_id: 'incline' }),
    )
  })

  it('says whose slot a substitute replaces', async () => {
    const fixture = entryFixture({ exercises: { bench: BENCH, incline: INCLINE } })
    const slot = fixture.slots[0]
    if (!slot) throw new Error('fixture')
    fixture.slots = [{ ...slot, substitute_exercise_id: 'incline', effective_exercise_id: 'incline' }]
    fixture.last_performance = { incline: null, bench: null }
    serve(fixture)
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getByRole('heading', { name: 'Incline Smith Press' })).toBeInTheDocument()
    expect(within(block).getByText('replaces Smith Flat Bench Press')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: /^Add set/ })).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('new-set-row')).toHaveLength(0)
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
    const cell = reps.closest('td') as HTMLElement
    expect(await within(cell).findByRole('alert')).toHaveTextContent(/not saved/i)
    expect(reps).toHaveValue('7')

    fail = false
    await user.type(reps, '{Enter}')
    await waitFor(() => expect(server.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2))
    await waitFor(() => expect(within(cell).queryByRole('alert')).not.toBeInTheDocument())
  })

  it('says why an invalid edit was not saved, next to the field', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const reps = await screen.findByRole('textbox', { name: 'Reps, set 1' })
    await user.clear(reps)
    await user.type(reps, '8x')
    await user.tab()
    const cell = reps.closest('td') as HTMLElement
    expect(within(cell).getByRole('alert')).toHaveTextContent(/not saved.*whole number/i)
    expect(server.calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('refuses to complete while a typed row cannot be saved', async () => {
    const server = serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    // No set type chosen: leaving the row cannot save it, so it stays unsaved input.
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '9')
    await user.click(screen.getByRole('button', { name: 'Complete workout' }))
    const alert = await screen.findByText(/not completed/i)
    expect(alert.closest('[role="alert"]')).toHaveTextContent(/unsaved/i)
    expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(false)
    expect(within(block).getByRole('textbox', { name: 'Reps, new set 1' })).toHaveValue('9')
  })

  it('does not count a carried load as unsaved input', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/complete': () => ({
        body: { workout: entryFixture().workout, advisories: [], renumbered: false },
      }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })).toHaveValue('82.5')
    await user.click(screen.getByRole('button', { name: 'Complete workout' }))
    await waitFor(() => expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(true))
    expect(posts(server.calls)).toHaveLength(0)
  })

  it('completes right after a row is saved without calling it unsaved', async () => {
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
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}')
    const completing = user.click(screen.getByRole('button', { name: 'Complete workout' }))
    release()
    await completing
    await waitFor(() => expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(true))
    expect(screen.queryByText(/not completed/i)).not.toBeInTheDocument()
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

  it('keeps session details behind a Details control', async () => {
    serve(entryFixture())
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await screen.findByTestId('slot-upper_a.01')
    expect(screen.queryByRole('textbox', { name: 'Session notes' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('textbox', { name: 'Session notes' })).toBeInTheDocument()
  })

  it('discards an empty draft and leaves without asking for it again', async () => {
    const server = serve(entryFixture(), {
      'DELETE /api/workouts/w1': () => ({ status: 204 }),
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await screen.findByTestId('slot-upper_a.01')
    await user.click(screen.getByRole('button', { name: 'Details' }))
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    const deleted = server.calls.findIndex((call) => call.method === 'DELETE')
    expect(deleted).toBeGreaterThan(-1)
    expect(server.calls.slice(deleted + 1).some((call) => call.url.includes('/entry'))).toBe(false)
  })

  it('after Enter saves a row, the cursor is in the next row’s load', async () => {
    const saved = performed(2, { load_kg: '85', reps: 5 })
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/sets': () => {
        server.set(entryFixture({ sets: [performed(1), saved] }))
        return { status: 201, body: saved }
      },
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    // 2 planned sets, 1 saved: one pending row; add a second so Enter has somewhere to go.
    await user.click(within(block).getByRole('button', { name: /^Add set/ }))
    const load = within(block).getByRole('textbox', { name: 'Load in kg, new set 2' })
    await user.click(load)
    await user.keyboard('{Control>}a{/Control}85{Tab}5{Enter}')
    await waitFor(() => expect(posts(server.calls)).toHaveLength(1))
    await waitFor(() =>
      expect(within(block).getByRole('textbox', { name: 'Load in kg, new set 3' })).toHaveFocus(),
    )
  })
})
