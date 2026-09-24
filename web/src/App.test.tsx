import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { HOME_ROUTES, SYSTEM_ROUTES, entryFixture, fakeApi } from './test/fakeApi'

describe('app shell', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('opens on Home — today and the key numbers — with the week planner on Training', async () => {
    fakeApi({ ...SYSTEM_ROUTES, ...HOME_ROUTES })
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('region', { name: 'Today' })).toHaveTextContent('Lower A')
    expect(screen.queryByRole('list', { name: 'This week' })).not.toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(nav).getByRole('link', { name: 'Training' }))
    expect(await screen.findByTestId('block-week')).toHaveTextContent('Week 2 of 12')
    const week = screen.getByRole('list', { name: 'This week' })
    expect(within(within(week).getByTestId('day-monday')).getByTestId('planned-upper_a')).toHaveAttribute('data-status', 'complete')
    expect(within(nav).getByRole('link', { name: 'Training' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByTestId('health-status')).toHaveTextContent('ok')
    expect(screen.getByTestId('db-source')).toHaveTextContent('sqlite')
  })

  it('still opens a pre-V3.2 week link, on Training', async () => {
    fakeApi({ ...SYSTEM_ROUTES, ...HOME_ROUTES })
    window.location.hash = '#/week/2026-10-07'
    render(<App />)
    expect(await screen.findByRole('list', { name: 'This week' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Training' })).toHaveAttribute('aria-current', 'page')
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
    window.location.hash = '#/training'
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Start Upper B' }))

    await waitFor(() => expect(window.location.hash).toBe('#/workouts/w1'))
    const open = calls.find((call) => call.method === 'POST')
    expect(open?.body).toEqual({ performed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(await screen.findByRole('heading', { name: 'Upper A', level: 1 })).toBeInTheDocument()
    // Back returns to the screen the workout was opened from.
    expect(screen.getByRole('link', { name: 'Back to Training' })).toHaveAttribute('href', '#/training')
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

  it('navigates between the six sections', async () => {
    fakeApi({
      ...SYSTEM_ROUTES,
      ...HOME_ROUTES,
      'GET /api/history/exercises': () => ({ body: [] }),
      'GET /api/history/days': () => ({ body: { days: [], next_before: null } }),
    })
    const user = userEvent.setup()
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Home',
      'Training',
      'Bodyweight',
      'Nutrition',
      'History',
      'Settings',
    ])
    await user.click(within(nav).getByRole('link', { name: 'Bodyweight' }))
    expect(await screen.findByRole('heading', { name: 'Bodyweight', level: 1 })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Nutrition' }))
    expect(await screen.findByRole('heading', { name: 'Nutrition', level: 1 })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'History' }))
    expect(await screen.findByRole('heading', { name: 'History', level: 1 })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    // History opens on the day timeline; exercise history is one secondary link away and stays
    // under History. There is no Sessions view.
    expect(await screen.findByText('Nothing recorded yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Exercise history →' }))
    expect(await screen.findByRole('heading', { name: 'Exercise history', level: 1 })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/history/exercises')
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
  })
})
