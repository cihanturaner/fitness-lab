import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PROGRAM, SYSTEM_ROUTES, entryFixture, fakeApi } from './test/fakeApi'

describe('home', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('shows the active program, its planned sessions and the local server status', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      'GET /api/program/active': () => ({ body: PROGRAM }),
      'GET /api/workouts': () => ({ body: [] }),
    })

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: PROGRAM.version?.name }),
    ).toBeInTheDocument()
    const sessions = screen.getByRole('list', { name: 'Planned sessions' })
    expect(within(sessions).getByText('Upper A')).toBeInTheDocument()
    expect(within(sessions).getByRole('button', { name: 'Start Upper A' })).toBeInTheDocument()
    expect(within(sessions).getByRole('button', { name: 'Resume draft of Lower A' })).toBeInTheDocument()
    // Resuming is never silent about which record it continues.
    expect(within(sessions).getByTestId('planned-lower_a')).toHaveTextContent(/draft dated/i)
    expect(await screen.findByTestId('health-status')).toHaveTextContent('ok')
    expect(screen.getByTestId('db-source')).toHaveTextContent('sqlite')
  })

  it('explains what to do when no program is active', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      'GET /api/program/active': () => ({
        body: { version: null, activated_at_utc: null, notes_text: null, planned_workouts: [] },
      }),
      'GET /api/workouts': () => ({ body: [] }),
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'No active program' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start unplanned session' })).toBeInTheDocument()
  })

  it('opens a planned session as a draft and routes to it', async () => {
    const calls = fakeApi({
      ...SYSTEM_ROUTES,
      'GET /api/program/active': () => ({ body: PROGRAM }),
      'GET /api/workouts': () => ({ body: [] }),
      'POST /api/planned-workouts/pw-upper/open': () => ({
        body: { workout_id: 'w1', created: true, workout: entryFixture().workout, origin: null },
      }),
      'GET /api/workouts/w1/entry': () => ({ body: entryFixture() }),
      'GET /api/exercises': () => ({ body: [] }),
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Start Upper A' }))

    await waitFor(() => expect(window.location.hash).toBe('#/workouts/w1'))
    const open = calls.find((call) => call.method === 'POST')
    expect(open?.body).toEqual({ performed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(await screen.findByRole('heading', { name: 'Upper A', level: 1 })).toBeInTheDocument()
  })

  it('keeps the lifter on the workout when Back would drop unsaved input', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      'GET /api/workouts/w1/entry': () => ({ body: entryFixture() }),
      'GET /api/exercises': () => ({ body: [] }),
      'GET /api/program/active': () => ({ body: PROGRAM }),
      'GET /api/workouts': () => ({ body: [] }),
    })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    window.location.hash = '#/workouts/w1'
    const user = userEvent.setup()
    render(<App />)
    const slot = await screen.findByTestId('slot-upper_a.01')
    await user.click(within(slot).getByRole('button', { name: 'Add set' }))
    await user.type(within(slot).getByRole('textbox', { name: 'Reps, new set 1' }), '6')

    window.location.hash = '#/' // what Back or a trackpad swipe does
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(window.location.hash).toBe('#/workouts/w1')
    expect(within(slot).getByRole('textbox', { name: 'Reps, new set 1' })).toHaveValue('6')
  })
})
