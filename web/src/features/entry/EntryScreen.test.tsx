import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, PerformedSet } from '@/api/types'
import { BENCH, CURL, INCLINE, entryFixture, fakeApi, type Call } from '@/test/fakeApi'
import { EntryScreen } from './EntryScreen'

/** A set as the entry serves it: bench sets are in slot 1 (the server resolves slot_id). */
function performed(order: number, overrides: Partial<PerformedSet> = {}): PerformedSet {
  return {
    slot_id: (overrides.exercise_id ?? 'bench') === 'bench' ? 'slot-1' : null,
    id: `set-${order}`,
    workout_id: 'w1',
    exercise_id: 'bench',
    set_order: order,
    set_type: 'working',
    load_lb: '82.5',
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
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    // A shortened session asks first; these tests accept unless they say otherwise.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('names the exercise once, with the target and last performance as one line each', async () => {
    serve(entryFixture())
    render(<EntryScreen workoutId="w1" />)

    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getAllByText('Smith Flat Bench Press')).toHaveLength(1)
    expect(within(block).getByTestId('target')).toHaveTextContent('Target 2 × 5–8 · RIR 2 / 0–1')
    expect(within(block).getByTestId('last-performance')).toHaveTextContent('Last (lb) 80×6@2')
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
    expect(within(block).getByRole('textbox', { name: 'Load in lb, new set 1' })).toHaveValue('')
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

    await user.type(within(block).getByRole('textbox', { name: 'Load in lb, new set 1' }), '82,5')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '6')
    await user.type(within(block).getByRole('textbox', { name: 'RIR, new set 1' }), '2{Enter}')

    await waitFor(() =>
      expect(posts(server.calls)[0]?.body).toEqual({
        exercise_id: 'bench',
        slot_id: 'slot-1',
        set_type: 'working',
        load_lb: '82.5',
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
    const load = within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })

    await user.click(load)
    await user.keyboard('85{Tab}5{Tab}1')
    expect(within(block).getByRole('textbox', { name: 'RIR, new set 2' })).toHaveFocus()
    await user.tab()

    await waitFor(() =>
      expect(posts(server.calls)[0]?.body).toEqual({
        exercise_id: 'bench',
        slot_id: 'slot-1',
        set_type: 'working',
        load_lb: '85',
        reps: 5,
        rir: 1,
        notes: null,
      }),
    )
  })

  it('never asks for a set type: set, lb, reps and RIR are the whole row', async () => {
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(1) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(block).queryByText(/set type|warm-up|back-off/i)).not.toBeInTheDocument()
    const headers = within(within(block).getByRole('table')).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['Set', 'lb', 'Reps', 'RIR', ''])
    // Reps alone is a set: saved as a working set, with no load and no RIR.
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '6{Enter}')
    await waitFor(() =>
      expect(posts(server.calls)[0]?.body).toEqual({ exercise_id: 'bench', slot_id: 'slot-1', set_type: 'working', load_lb: null, reps: 6, rir: null, notes: null }),
    )
  })

  it('logs a whole exercise from the keyboard alone: lb, reps, RIR, Enter — row after row', async () => {
    let saved: ReturnType<typeof performed>[] = []
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': (call) => {
        const body = call.body as { load_lb: string; reps: number; rir: number }
        const next = performed(saved.length + 1, { load_lb: body.load_lb, reps: body.reps, rir: body.rir })
        saved = [...saved, next]
        server.set(entryFixture({ sets: saved }))
        return { status: 201, body: next }
      },
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(block).getByRole('textbox', { name: 'Load in lb, new set 1' }))
    await user.keyboard('185{Tab}8{Tab}2{Enter}')
    await waitFor(() => expect(within(block).getAllByTestId('set-row')).toHaveLength(1))
    // Enter moved the cursor to the next row's load, which already carries 185.
    await waitFor(() => expect(within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })).toHaveFocus())
    await user.keyboard('{Tab}7{Tab}1{Enter}')
    await waitFor(() => expect(within(block).getAllByTestId('set-row')).toHaveLength(2))
    expect(posts(server.calls).map((call) => call.body)).toEqual([
      { exercise_id: 'bench', slot_id: 'slot-1', set_type: 'working', load_lb: '185', reps: 8, rir: 2, notes: null },
      { exercise_id: 'bench', slot_id: 'slot-1', set_type: 'working', load_lb: '185', reps: 7, rir: 1, notes: null },
    ])
  })

  it('starts a new row with the previous set’s load, never the plan’s', async () => {
    serve(entryFixture({ sets: [performed(1, { set_type: 'warmup', load_lb: '40' })] }))
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })).toHaveValue('40')
    // A legacy warm-up stays marked (it never counts as a working set) but has no control.
    expect(within(block).getByText('(warm-up)')).toBeInTheDocument()
    // Warm-ups do not move the hint: planned set 1 (RIR 2) is still next.
    expect(within(block).getByRole('textbox', { name: 'RIR, new set 2' })).toHaveAttribute('placeholder', '2')
  })

  it('passes the load just entered on to the next row', async () => {
    const saved = performed(1, { load_lb: '80', reps: 7, rir: null })
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': () => {
        server.set(entryFixture({ sets: [saved] }))
        return { status: 201, body: saved }
      },
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.type(within(block).getByRole('textbox', { name: 'Load in lb, new set 1' }), '80')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '7{Enter}')
    await waitFor(() =>
      expect(within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })).toHaveValue('80'),
    )
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
    await user.type(within(block).getByRole('textbox', { name: 'Load in lb, new set 1' }), '80{Enter}')
    expect(await within(block).findByRole('alert')).toHaveTextContent(/enter reps/i)
    expect(posts(server.calls)).toHaveLength(0)
  })

  it('refuses an invalid load in a row instead of rounding it', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }))
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    const load = within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })
    await user.clear(load)
    await user.type(load, '82.5555')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}')
    expect(await within(block).findByRole('alert')).toHaveTextContent(/load must be pounds/i)
    expect(posts(server.calls)).toHaveLength(0)
  })

  it('never replaces the lifter’s typing when it passes through the carried load', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(2) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    const load = within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })
    await user.clear(load)
    await user.type(load, '82.55')
    expect(load).toHaveValue('82.55')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 2' }), '5{Enter}')
    await waitFor(() => expect(posts(server.calls)[0]?.body).toMatchObject({ load_lb: '82.55', reps: 5 }))
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

  it('changes the exercise for this workout to an approved substitute', async () => {
    const server = serve(entryFixture(), {
      'PUT /api/workouts/w1/slots/slot-1/approved-substitute': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).queryByRole('region', { name: 'Change exercise, slot 1' })).not.toBeInTheDocument()
    await user.click(within(block).getByRole('button', { name: 'Change exercise, slot 1' }))
    const panel = within(block).getByRole('region', { name: 'Change exercise, slot 1' })
    expect(panel).toHaveTextContent('This workout only · the plan stays Smith Flat Bench Press')
    expect(within(panel).getByText('Approved substitutes')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Barbell Bench Press' }))
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')).toMatchObject({
        url: '/api/workouts/w1/slots/slot-1/approved-substitute',
        body: { name: 'Barbell Bench Press' },
      }),
    )
    await waitFor(() => expect(within(block).queryByRole('region', { name: 'Change exercise, slot 1' })).not.toBeInTheDocument())
  })

  it('changes the exercise for this workout to any existing exercise found by search', async () => {
    const server = serve(entryFixture(), {
      'PUT /api/workouts/w1/slots/slot-1/exercise': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(block).getByRole('button', { name: 'Change exercise, slot 1' }))
    await user.type(within(block).getByRole('textbox', { name: 'Search or type an exercise, slot 1' }), 'incl')
    const matches = within(block).getByRole('list', { name: 'Matching exercises' })
    // The planned exercise and the current one are never offered as "other".
    expect(within(matches).queryByRole('button', { name: 'Smith Flat Bench Press' })).not.toBeInTheDocument()
    await user.click(within(matches).getByRole('button', { name: 'Incline Smith Press' }))
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({ exercise_id: 'incline' }),
    )
  })

  it('uses a new exercise typed by name, shown exactly as it will be saved', async () => {
    const server = serve(entryFixture(), {
      'PUT /api/workouts/w1/slots/slot-1/typed-exercise': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(block).getByRole('button', { name: 'Change exercise, slot 1' }))
    const search = within(block).getByRole('textbox', { name: 'Search or type an exercise, slot 1' })
    await user.type(search, '  triceps   curl')
    expect(within(block).queryByRole('list', { name: 'Matching exercises' })).not.toBeInTheDocument()
    const use = within(block).getByRole('button', { name: 'Use “Triceps Curl” for this workout' })
    expect(within(block).getByText(/the plan keeps Smith Flat Bench Press/)).toBeInTheDocument()
    await user.click(use)
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')).toMatchObject({
        url: '/api/workouts/w1/slots/slot-1/typed-exercise',
        body: { name: 'Triceps Curl' },
      }),
    )
  })

  it('offers no new exercise when the typed name already exists in another case or spacing', async () => {
    const server = serve(entryFixture(), {
      'PUT /api/workouts/w1/slots/slot-1/exercise': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(block).getByRole('button', { name: 'Change exercise, slot 1' }))
    await user.type(within(block).getByRole('textbox', { name: 'Search or type an exercise, slot 1' }), 'INCLINE  smith press{Enter}')
    expect(within(block).queryByTestId('use-typed-exercise')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({ exercise_id: 'incline' }),
    )
  })

  it('keeps two slots changed to the same exercise apart: own rows, own count, own saves', async () => {
    const base = entryFixture()
    const first = base.slots[0]
    if (!first) throw new Error('fixture')
    const curl = { ...CURL, id: 'curl' }
    const fixture = entryFixture({
      slots: [
        { ...first, substitute_exercise_id: 'curl', effective_exercise_id: 'curl' },
        { ...first, id: 'slot-2', slot_key: 'upper_a.02', position: 2, exercise_id: 'incline', substitute_exercise_id: 'curl', effective_exercise_id: 'curl' },
      ],
      exercises: { bench: BENCH, incline: INCLINE, curl },
      last_performance: { curl: null, bench: null, incline: null },
      sets: [
        performed(1, { exercise_id: 'curl', slot_id: 'slot-1', load_lb: '40' }),
        performed(2, { exercise_id: 'curl', slot_id: 'slot-2', load_lb: '25' }),
        performed(3, { exercise_id: 'curl', slot_id: 'slot-2', load_lb: '25' }),
      ],
    })
    const server = serve(fixture, {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(4, { exercise_id: 'curl', slot_id: 'slot-1' }) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const one = await screen.findByTestId('slot-upper_a.01')
    const two = screen.getByTestId('slot-upper_a.02')
    expect(screen.queryByText(/recorded under exercise/)).not.toBeInTheDocument()
    expect(within(one).getAllByTestId('set-row')).toHaveLength(1)
    expect(within(two).getAllByTestId('set-row')).toHaveLength(2)
    expect(within(one).getByTitle('Working sets saved of planned')).toHaveTextContent('1/2')
    expect(within(two).getByTitle('Working sets saved of planned')).toHaveTextContent('2/2')
    expect(within(two).getByTestId('planned-exercise')).toHaveTextContent('Planned: Incline Smith Press')

    // Slot 1 still has a planned set to go; its row saves into slot 1, not slot 2.
    expect(within(two).queryAllByTestId('new-set-row')).toHaveLength(0)
    await user.type(within(one).getByRole('textbox', { name: 'Reps, new set 2' }), '12{Enter}')
    await waitFor(() => expect(posts(server.calls)[0]?.body).toMatchObject({ exercise_id: 'curl', slot_id: 'slot-1' }))
  })

  it('shows the planned exercise beside a changed one and can go back to it', async () => {
    const fixture = entryFixture({ exercises: { bench: BENCH, incline: INCLINE } })
    const slot = fixture.slots[0]
    if (!slot) throw new Error('fixture')
    fixture.slots = [{ ...slot, substitute_exercise_id: 'incline', effective_exercise_id: 'incline' }]
    fixture.last_performance = { incline: null, bench: null }
    const server = serve(fixture, {
      'PUT /api/workouts/w1/slots/slot-1/exercise': () => ({ body: entryFixture() }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).getByRole('heading', { name: 'Incline Smith Press' })).toBeInTheDocument()
    expect(within(block).getByTestId('planned-exercise')).toHaveTextContent(
      'Planned: Smith Flat Bench Press · changed for this workout',
    )
    await user.click(within(block).getByRole('button', { name: 'Change exercise, slot 1' }))
    await user.click(within(block).getByRole('button', { name: 'Back to Smith Flat Bench Press' }))
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PUT')?.body).toEqual({ exercise_id: 'bench' }),
    )
  })

  it('offers no Change and no Discard on a complete workout', async () => {
    const fixture = entryFixture({ sets: [performed(1)] })
    fixture.workout = { ...fixture.workout, status: 'complete' }
    serve(fixture)
    render(<EntryScreen workoutId="w1" />)
    const block = await screen.findByTestId('slot-upper_a.01')
    expect(within(block).queryByRole('button', { name: 'Change exercise, slot 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument()
  })

  it('asks in the page before discarding a draft that holds sets', async () => {
    const server = serve(entryFixture({ sets: [performed(1)] }), {
      'DELETE /api/workouts/w1': () => ({ status: 204 }),
    })
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await screen.findByTestId('slot-upper_a.01')
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Discard this draft and its 1 recorded set?')
    expect(ask).toHaveTextContent('Recorded here: Smith Flat Bench Press.')
    expect(ask).toHaveTextContent('the planned session and the program stay')
    await user.click(within(ask).getByRole('button', { name: 'Keep the draft' }))
    expect(server.calls.some((call) => call.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard 1 set' }))
    await waitFor(() => expect(server.calls.some((call) => call.method === 'DELETE')).toBe(true))
    expect(confirm).not.toHaveBeenCalled()
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

  it('records extra exercises outside the plan, as extra work in no slot', async () => {
    const server = serve(entryFixture(), {
      'POST /api/workouts/w1/sets': () => ({ status: 201, body: performed(1, { exercise_id: 'curl' }) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Add an exercise' }), 'curl')
    const extra = await screen.findByTestId('extra-curl')
    expect(within(extra).getByText('Preacher Curl')).toBeInTheDocument()
    await user.type(within(extra).getByRole('textbox', { name: 'Reps, new set 1' }), '10{Enter}')
    await waitFor(() => expect(posts(server.calls)[0]?.body).toMatchObject({ exercise_id: 'curl', slot_id: null }))
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
    // An RIR that is not a whole number: leaving the row cannot save it, so it stays unsaved input.
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '9')
    await user.type(within(block).getByRole('textbox', { name: 'RIR, new set 1' }), '1.5')
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
    expect(within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })).toHaveValue('82.5')
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

  it('offers to record a legacy untyped set as a working set, since no control asks for a type', async () => {
    const sets = [performed(1, { set_type: null }), performed(2)]
    const server = serve(entryFixture({ sets }), {
      'POST /api/workouts/w1/complete': () => ({
        status: 409,
        body: {
          detail: 'workout cannot be completed yet',
          blockers: [{ rule: 'C4', message: 'sets missing set_type: [1]', set_orders: [1] }],
          advisories: [],
        },
      }),
      'PATCH /api/sets/set-1': () => ({ body: performed(1) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    await user.click(await screen.findByRole('button', { name: 'Complete workout' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Set type not recorded: Smith Flat Bench Press set 1')
    await user.click(within(alert).getByRole('button', { name: 'Record it as working set' }))
    await waitFor(() =>
      expect(server.calls.find((call) => call.method === 'PATCH')).toMatchObject({ url: '/api/sets/set-1', body: { set_type: 'working' } }),
    )
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
    const server = serve(entryFixture({ sets: [performed(1, { load_lb: '80' })] }), {
      'PATCH /api/sets/set-1': () => ({ body: performed(1, { load_lb: '82.5' }) }),
    })
    const user = userEvent.setup()
    render(<EntryScreen workoutId="w1" />)
    const load = await screen.findByRole('textbox', { name: 'Load in lb, set 1' })
    server.set(entryFixture({ sets: [performed(1, { load_lb: '82.5' })] }))
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
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Discard this empty draft?'))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    const deleted = server.calls.findIndex((call) => call.method === 'DELETE')
    expect(deleted).toBeGreaterThan(-1)
    expect(server.calls.slice(deleted + 1).some((call) => call.url.includes('/entry'))).toBe(false)
  })

  it('after Enter saves a row, the cursor is in the next row’s load', async () => {
    const saved = performed(2, { load_lb: '85', reps: 5 })
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
    const load = within(block).getByRole('textbox', { name: 'Load in lb, new set 2' })
    await user.click(load)
    await user.keyboard('{Control>}a{/Control}85{Tab}5{Enter}')
    await waitFor(() => expect(posts(server.calls)).toHaveLength(1))
    await waitFor(() =>
      expect(within(block).getByRole('textbox', { name: 'Load in lb, new set 3' })).toHaveFocus(),
    )
  })

  describe('a session with fewer working sets than planned', () => {
    const short = () =>
      entryFixture({
        sets: [performed(1), performed(2)],
        work_sets: { planned: 23, actual: 2, short: true },
      })
    const completed = () => {
      const done = short()
      done.workout = { ...done.workout, status: 'complete' }
      return done
    }

    it('asks before completing, and declining completes nothing', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const server = serve(short(), {
        'POST /api/workouts/w1/complete': () => ({ body: { workout: completed().workout, advisories: [], renumbered: false } }),
      })
      const user = userEvent.setup()
      render(<EntryScreen workoutId="w1" />)
      await user.click(await screen.findByRole('button', { name: 'Complete workout' }))
      await waitFor(() =>
        expect(confirm).toHaveBeenCalledWith('2 actual working sets recorded / 23 planned. Complete anyway?'),
      )
      expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(false)
      expect(screen.getByTestId('workout-status')).toHaveTextContent('Draft')
    })

    it('completes when the lifter accepts, and never shows it as a full session', async () => {
      const server = serve(short(), {
        'POST /api/workouts/w1/complete': () => {
          server.set(completed())
          return { body: { workout: completed().workout, advisories: [], renumbered: false } }
        },
      })
      const user = userEvent.setup()
      render(<EntryScreen workoutId="w1" />)
      await user.click(await screen.findByRole('button', { name: 'Complete workout' }))
      await waitFor(() => expect(screen.getByTestId('workout-status')).toHaveTextContent('Complete'))
      expect(screen.getByTestId('workout-shortfall')).toHaveTextContent('shortened')
      expect(screen.getByRole('status')).toHaveTextContent('Saved as a shortened session: 2 of 23 planned working sets recorded.')
    })

    it('does not ask when the plan was met', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      const full = entryFixture({ sets: [performed(1), performed(2)], work_sets: { planned: 2, actual: 2, short: false } })
      const server = serve(full, {
        'POST /api/workouts/w1/complete': () => ({ body: { workout: full.workout, advisories: [], renumbered: false } }),
      })
      const user = userEvent.setup()
      render(<EntryScreen workoutId="w1" />)
      await user.click(await screen.findByRole('button', { name: 'Complete workout' }))
      await waitFor(() => expect(server.calls.some((call) => call.url.endsWith('/complete'))).toBe(true))
      expect(confirm).not.toHaveBeenCalled()
      expect(screen.queryByTestId('workout-shortfall')).not.toBeInTheDocument()
    })
  })
})
