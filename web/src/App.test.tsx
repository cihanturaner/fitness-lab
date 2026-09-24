import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { HOME_ROUTES, SYSTEM_ROUTES, WEEK, entryFixture, fakeApi } from './test/fakeApi'

describe('home: the week', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('shows the block week, the sessions on their weekdays with their status, and the server', async () => {
    fakeApi({ ...SYSTEM_ROUTES, ...HOME_ROUTES })
    render(<App />)

    expect(await screen.findByTestId('block-week')).toHaveTextContent('Week 2 of 12')
    const week = screen.getByRole('list', { name: 'This week' })
    const monday = within(week).getByTestId('day-monday')
    expect(within(monday).getByTestId('planned-upper_a')).toHaveAttribute('data-status', 'complete')
    expect(within(monday).getByRole('link', { name: 'View Upper A' })).toHaveAttribute('href', '#/workouts/w-done')
    const tuesday = within(week).getByTestId('day-tuesday')
    expect(within(tuesday).getByTestId('session-status')).toHaveTextContent('Draft')
    expect(within(tuesday).getByRole('button', { name: 'Resume draft of Lower A' })).toBeInTheDocument()
    expect(within(week).getByTestId('day-wednesday')).toHaveTextContent('Rest')
    expect(within(week).getByRole('button', { name: 'Start Upper B' })).toBeInTheDocument()
    expect(await screen.findByTestId('health-status')).toHaveTextContent('ok')
    expect(screen.getByTestId('db-source')).toHaveTextContent('sqlite')
  })

  it('summarises bodyweight and today’s nutrition, truthfully about unknown targets', async () => {
    fakeApi({ ...SYSTEM_ROUTES, ...HOME_ROUTES })
    render(<App />)
    const bodyweight = await screen.findByTestId('home-bodyweight')
    // The source's display metric (7-day average) leads; the latest weigh-in is secondary.
    expect(within(bodyweight).getByTestId('home-bw-avg')).toHaveTextContent('72.30 kg7-day average · 7/7 days')
    expect(within(bodyweight).getByTestId('home-bw-latest')).toHaveTextContent('72.6 kg')
    // Two weigh-ins are no trend: no single-day change is presented as a rate.
    expect(within(bodyweight).getByTestId('home-bw-trend')).toHaveTextContent('not enough weigh-ins (2/14)')
    const nutrition = screen.getByTestId('home-nutrition')
    expect(within(nutrition).getByTestId('home-nut-protein')).toHaveTextContent('150 gtarget 145 g')
    expect(within(nutrition).getByTestId('home-nut-fat')).toHaveTextContent('62 gtarget 60 g')
    expect(within(nutrition).getByTestId('home-nut-kcal')).toHaveTextContent('2410 kcaltarget not set')
    expect(nutrition).toHaveTextContent('Calorie target not calibrated yet.')
  })

  it('explains what to do when no program is active', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      ...HOME_ROUTES,
      'GET /api/week': () => ({
        body: { ...WEEK, program: null, block: null, days: WEEK.days.map((day) => ({ ...day, sessions: [] })) },
      }),
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'No active program' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start unplanned session' })).toBeInTheDocument()
  })

  it('opens a planned session as a draft and routes to it', async () => {
    const calls = fakeApi({
      ...SYSTEM_ROUTES,
      ...HOME_ROUTES,
      'POST /api/planned-workouts/pw-upper-b/open': () => ({
        body: { workout_id: 'w1', created: true, workout: entryFixture().workout, origin: null },
      }),
      'GET /api/workouts/w1/entry': () => ({ body: entryFixture() }),
      'GET /api/exercises': () => ({ body: [] }),
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Start Upper B' }))

    await waitFor(() => expect(window.location.hash).toBe('#/workouts/w1'))
    const open = calls.find((call) => call.method === 'POST')
    expect(open?.body).toEqual({ performed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(await screen.findByRole('heading', { name: 'Upper A', level: 1 })).toBeInTheDocument()
  })

  it('keeps the lifter on the workout when Back would drop unsaved input', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      ...HOME_ROUTES,
      'GET /api/workouts/w1/entry': () => ({ body: entryFixture() }),
      'GET /api/exercises': () => ({ body: [] }),
    })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    window.location.hash = '#/workouts/w1'
    const user = userEvent.setup()
    render(<App />)
    const block = await screen.findByTestId('slot-upper_a.01')
    await user.type(within(block).getByRole('textbox', { name: 'Reps, new set 1' }), '6')

    window.location.hash = '#/' // what Back or a trackpad swipe does
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(window.location.hash).toBe('#/workouts/w1')
    expect(within(block).getByRole('textbox', { name: 'Reps, new set 1' })).toHaveValue('6')
  })

  it('navigates between the five sections', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      ...HOME_ROUTES,
      'GET /api/history/exercises': () => ({ body: [] }),
    })
    const user = userEvent.setup()
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'Bodyweight' }))
    expect(await screen.findByRole('heading', { name: 'Bodyweight', level: 1 })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Nutrition' }))
    expect(await screen.findByRole('heading', { name: 'Nutrition', level: 1 })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'History' }))
    expect(await screen.findByRole('heading', { name: 'History', level: 1 })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
  })
})
