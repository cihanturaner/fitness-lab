import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Week, WeekDay } from '@/api/types'
import { HOME_ROUTES, NUTRITION, REVIEW, TARGET, WEEK, entryFixture, fakeApi, session } from '@/test/fakeApi'
import { HomeScreen } from './HomeScreen'

function withDays(week: Week, change: (day: WeekDay, index: number) => WeekDay): Week {
  return { ...week, days: week.days.map(change) }
}

const notStarted = { status: 'not_started', workout_id: null, workout_on: null, actual_work_sets: null, open_draft_id: null, open_draft_on: null } as const

/** WEEK with no draft, and `sessions` planned today (Wednesday 7 Oct). */
function todayWith(...sessions: ReturnType<typeof session>[]): Week {
  return withDays(WEEK, (item, index) =>
    index === 1 ? { ...item, sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) } : index === 2 ? { ...item, sessions } : item,
  )
}

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('answers today, the workout status and the key numbers — and holds no weekly planner', async () => {
    fakeApi(HOME_ROUTES)
    render(<HomeScreen />)
    const today = await screen.findByRole('region', { name: 'Today' })
    // The open draft is today's answer: continue it.
    expect(within(today).getByTestId('today-status')).toHaveTextContent('In progress')
    expect(today).toHaveTextContent('Lower A')
    expect(today).toHaveTextContent('4 of 18 working sets')
    expect(within(today).getByRole('button', { name: 'Continue Lower A' })).toBeInTheDocument()
    // The next session is small context that leads to Training.
    const next = within(today).getByTestId('today-next')
    expect(next).toHaveTextContent('Upper B')
    expect(next).toHaveTextContent('Thu 8 Oct')
    expect(next).toHaveAttribute('href', '#/training')
    // Three summary cards, nothing else: no Monday–Sunday strip, no week navigation.
    expect(screen.getByTestId('home-bodyweight')).toBeInTheDocument()
    expect(screen.getByTestId('home-nutrition')).toBeInTheDocument()
    expect(screen.getByTestId('home-recent')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'This week' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Weeks' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-monday')).not.toBeInTheDocument()
    expect(screen.getByTestId('home-context')).toHaveTextContent('Block week 2 of 12')
  })

  it('summarises bodyweight and today’s nutrition, truthfully about unknown targets', async () => {
    fakeApi(HOME_ROUTES)
    render(<HomeScreen />)
    const bodyweight = await screen.findByTestId('home-bodyweight')
    // The source's display metric (7-day average) leads; the latest weigh-in is secondary.
    expect(within(bodyweight).getByTestId('home-bw-avg')).toHaveTextContent('72.30 kg7-day average · 7/7 days')
    expect(within(bodyweight).getByTestId('home-bw-latest')).toHaveTextContent('72.6 kg')
    // Two weigh-ins are no trend: no single-day change is presented as a rate.
    expect(within(bodyweight).getByTestId('home-bw-trend')).toHaveTextContent('not enough weigh-ins (2/14)')
    const nutrition = screen.getByTestId('home-nutrition')
    // No macro target recorded yet: none is shown, not even the source's defaults.
    expect(within(nutrition).getByTestId('home-nut-protein')).toHaveTextContent('150 gtarget not set')
    expect(within(nutrition).getByTestId('home-nut-fat')).toHaveTextContent('62 gtarget not set')
    // Derived from the macros (150 x 4 + 290 x 4 + 62 x 9), never typed.
    expect(within(nutrition).getByTestId('home-nut-kcal')).toHaveTextContent('2318kcal')
    expect(nutrition).toHaveTextContent('No macro target set yet.')
  })

  it('compares today’s macros with the macro target in force', async () => {
    fakeApi({ ...HOME_ROUTES, 'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: TARGET } }) })
    render(<HomeScreen />)
    const nutrition = await screen.findByTestId('home-nutrition')
    expect(within(nutrition).getByTestId('home-nut-protein')).toHaveTextContent('150 gtarget 150 g')
    expect(within(nutrition).getByTestId('home-nut-carbs')).toHaveTextContent('290 gtarget 300 g')
    expect(within(nutrition).getByTestId('home-nut-kcal')).toHaveTextContent('2318of 2430')
    expect(nutrition).not.toHaveTextContent('No macro target set yet.')
  })

  it('starts today’s planned session as a draft and routes to it', async () => {
    const calls = fakeApi({
      ...HOME_ROUTES,
      'GET /api/week': () => ({
        body: todayWith(session({ planned_workout_id: 'pw-upper-b', workout_key: 'upper_b', name: 'Upper B', day_label: 'Wednesday' })),
      }),
      'POST /api/planned-workouts/pw-upper-b/open': () => ({
        body: { workout_id: 'w1', created: true, workout: entryFixture().workout, origin: null },
      }),
    })
    const user = userEvent.setup()
    render(<HomeScreen />)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByTestId('today-status')).toHaveTextContent('Today')
    await user.click(within(today).getByRole('button', { name: 'Start today: Upper B' }))
    await waitFor(() => expect(window.location.hash).toBe('#/workouts/w1'))
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ performed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('reviews a finished session, and never calls a shortened one Done', async () => {
    const done = session({ status: 'complete', workout_id: 'w-today', workout_on: '2026-10-07', actual_work_sets: 23 })
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: todayWith(done) }) })
    const { unmount } = render(<HomeScreen />)
    let today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByTestId('today-status')).toHaveTextContent('Done today')
    expect(within(today).getByRole('link', { name: 'Review Upper A' })).toHaveAttribute('href', '#/workouts/w-today')
    unmount()

    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: todayWith({ ...done, actual_work_sets: 9 }) }) })
    render(<HomeScreen />)
    today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByTestId('today-status')).toHaveTextContent('Shortened')
    expect(today).not.toHaveTextContent('Done')
    expect(today).toHaveTextContent('Completed with 9 of 23 working sets')
  })

  it('a rest day says so, with the next session as context', async () => {
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: todayWith() }) })
    render(<HomeScreen />)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(today).toHaveTextContent('Rest day')
    expect(within(today).getByTestId('today-next')).toHaveTextContent('Upper B')
  })

  it('before the block, the hero counts down instead of offering block work', async () => {
    const pre: Week = {
      ...withDays(WEEK, (item, index) => ({ ...item, phase: index < 3 ? 'pre_block' : 'block', sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) })),
      today: '2026-10-05',
      date: '2026-10-05',
      block: { start_on: '2026-10-08', week: 1, weeks: 12, phase: 'pre_block' },
    }
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: pre }) })
    render(<HomeScreen />)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(today).toHaveTextContent('Before the block')
    expect(today).toHaveTextContent('Block starts Thu 8 Oct')
    expect(within(today).queryByRole('button', { name: /^Start today/ })).not.toBeInTheDocument()
  })

  it('after week 12 the block is finished, not still running', async () => {
    const post: Week = {
      ...withDays(WEEK, (item) => ({ ...item, phase: 'post_block', sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) })),
      block: { start_on: '2026-10-01', week: 13, weeks: 12, phase: 'post_block' },
    }
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: post }) })
    render(<HomeScreen />)
    expect(await screen.findByRole('region', { name: 'Today' })).toHaveTextContent('Block complete')
  })

  it('points to a draft of another week instead of letting it take over this one', async () => {
    const stale: Week = {
      ...withDays(WEEK, (item, index) =>
        index === 1 ? { ...item, sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) } : item,
      ),
      open_drafts: [{ workout_id: 'w-old', planned_workout_id: 'pw-upper', name: 'Upper A', performed_on: '2026-09-28', block_week: 1 }],
    }
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: stale }) })
    render(<HomeScreen />)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(today).toHaveTextContent('Unfinished draft')
    expect(today).toHaveTextContent('Dated Mon 28 Sep (week 1)')
    expect(within(today).getByRole('link', { name: 'Open the Upper A draft from Mon 28 Sep' })).toHaveAttribute('href', '#/workouts/w-old')
  })

  it('explains what to do when no program is active', async () => {
    fakeApi({
      ...HOME_ROUTES,
      'GET /api/week': () => ({ body: { ...WEEK, program: null, block: null, days: WEEK.days.map((item) => ({ ...item, sessions: [] })) } }),
    })
    render(<HomeScreen />)
    expect(await screen.findByRole('heading', { name: 'No active program' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start unplanned session' })).toBeInTheDocument()
  })

  it('says when a weekly nutrition review is due', async () => {
    const due = { ...REVIEW, review: { ...REVIEW.review!, phase: 'decision' as const, block_week: 3, decision_due: true } }
    fakeApi({ ...HOME_ROUTES, 'GET /api/nutrition/review': () => ({ body: due }) })
    render(<HomeScreen />)
    expect(await screen.findByTestId('home-review-due')).toHaveTextContent('Weekly review due · week 3')
  })
})
