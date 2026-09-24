import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Week, WeekDay } from '@/api/types'
import { HOME_ROUTES, WEEK, entryFixture, fakeApi, session } from '@/test/fakeApi'
import { TrainingScreen } from './TrainingScreen'

function withDays(week: Week, change: (day: WeekDay, index: number) => WeekDay): Week {
  return { ...week, days: week.days.map(change) }
}

function day(name: string) {
  return within(screen.getByRole('list', { name: 'This week' })).getByTestId(`day-${name}`)
}

const notStarted = { status: 'not_started', workout_id: null, workout_on: null, actual_work_sets: null, open_draft_id: null, open_draft_on: null } as const

describe('TrainingScreen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('shows the block week, each weekday with its status, and the week’s progress', async () => {
    fakeApi(HOME_ROUTES)
    render(<TrainingScreen />)
    expect(await screen.findByTestId('block-week')).toHaveTextContent('Week 2 of 12')
    expect(screen.getByTestId('week-sessions-done')).toHaveTextContent('1 of 4 sessions done this week')
    const monday = day('monday')
    expect(within(monday).getByTestId('planned-upper_a')).toHaveAttribute('data-status', 'complete')
    expect(within(monday).getByRole('link', { name: 'View Upper A' })).toHaveAttribute('href', '#/workouts/w-done')
    expect(within(day('tuesday')).getByTestId('session-status')).toHaveTextContent('Draft')
    expect(within(day('tuesday')).getByRole('button', { name: 'Resume draft of Lower A' })).toBeInTheDocument()
    expect(day('wednesday')).toHaveTextContent('Rest')
    expect(day('wednesday')).toHaveAttribute('aria-current', 'date')
    expect(within(day('thursday')).getByRole('button', { name: 'Start Upper B' })).toBeInTheDocument()
  })

  it('never shows a shortened session as a full one', async () => {
    const short = withDays(WEEK, (item, index) =>
      index === 0
        ? { ...item, sessions: [session({ status: 'complete', workout_id: 'w-short', workout_on: '2026-10-05', actual_work_sets: 2 })] }
        : item,
    )
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: short }) })
    render(<TrainingScreen />)
    const monday = await waitFor(() => day('monday'))
    expect(within(monday).getByTestId('session-status')).toHaveTextContent('Shortened')
    expect(within(monday).getByTestId('session-sets')).toHaveTextContent('2 of 23 working sets')
    expect(within(monday).queryByText('9 exercises · 23 sets')).not.toBeInTheDocument()
  })

  it('shows the plan against what a draft has recorded so far', async () => {
    fakeApi(HOME_ROUTES)
    render(<TrainingScreen />)
    const tuesday = await waitFor(() => day('tuesday'))
    expect(within(tuesday).getByTestId('session-sets')).toHaveTextContent('4 of 18 working sets')
  })

  it('before the block, days before the start recede and nothing is offered as block work', async () => {
    const pre: Week = {
      ...withDays(WEEK, (item, index) => ({ ...item, phase: index < 3 ? 'pre_block' : 'block', sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) })),
      today: '2026-10-05',
      date: '2026-10-05',
      block: { start_on: '2026-10-08', week: 1, weeks: 12, phase: 'pre_block' },
    }
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: pre }) })
    render(<TrainingScreen />)
    expect(await screen.findByTestId('block-phase')).toHaveTextContent('Before the block · starts Thu 8 Oct · in 3 days')
    expect(screen.queryByTestId('block-week')).not.toBeInTheDocument()
    const monday = day('monday')
    expect(within(monday).getByTestId('session-status')).toHaveTextContent('Before block')
    expect(within(monday).queryByRole('button', { name: 'Start Upper A' })).not.toBeInTheDocument()
    expect(within(day('thursday')).getByRole('button', { name: 'Start Upper B' })).toBeInTheDocument()
  })

  it('after week 12 the block is finished, not still running', async () => {
    const post: Week = {
      ...withDays(WEEK, (item) => ({ ...item, phase: 'post_block', sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) })),
      block: { start_on: '2026-10-01', week: 13, weeks: 12, phase: 'post_block' },
    }
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: post }) })
    render(<TrainingScreen />)
    expect(await screen.findByTestId('block-phase')).toHaveTextContent('After the block · finished Sun 20 Dec')
  })

  it('moves between weeks, and a past week offers only what fits the past', async () => {
    const past: Week = {
      ...withDays(WEEK, (item) => ({ ...item, sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) })),
      is_current_week: false,
      today: '2026-10-14',
    }
    const calls = fakeApi({
      ...HOME_ROUTES,
      'GET /api/week': () => ({ body: past }),
      'POST /api/planned-workouts/pw-upper/open': () => ({
        body: { workout_id: 'w9', created: true, workout: entryFixture().workout, origin: null },
      }),
    })
    const user = userEvent.setup()
    render(<TrainingScreen week="2026-10-07" />)
    const nav = await screen.findByRole('navigation', { name: 'Weeks' })
    expect(within(nav).getByRole('link', { name: 'Previous week' })).toHaveAttribute('href', '#/training/2026-09-28')
    expect(within(nav).getByRole('link', { name: 'Next week' })).toHaveAttribute('href', '#/training/2026-10-12')
    expect(within(nav).getByRole('link', { name: 'This week' })).toHaveAttribute('href', '#/training')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Week 2 of 12')
    expect(screen.getByTestId('week-mode')).toHaveTextContent('A past week')
    const monday = day('monday')
    expect(within(monday).getByTestId('session-status')).toHaveTextContent('Not logged')
    expect(within(monday).queryByRole('button', { name: 'Start Upper A' })).not.toBeInTheDocument()
    await user.click(within(monday).getByRole('button', { name: 'Log Upper A for Mon 5 Oct' }))
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ performed_on: '2026-10-05' }))
    expect(calls.find((call) => call.url.startsWith('/api/week'))?.url).toContain('date=2026-10-07')
  })

  it('a future week is the plan only', async () => {
    const future: Week = { ...WEEK, is_current_week: false, today: '2026-09-23', week_start: '2026-10-05' }
    fakeApi({
      ...HOME_ROUTES,
      'GET /api/week': () => ({ body: { ...future, days: future.days.map((item) => ({ ...item, sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) })) } }),
    })
    render(<TrainingScreen week="2026-10-07" />)
    const thursday = await waitFor(() => day('thursday'))
    expect(within(thursday).getByTestId('session-status')).toHaveTextContent('Planned')
    expect(within(thursday).queryByRole('button')).not.toBeInTheDocument()
  })

  it('points to a draft of another week from its planned day', async () => {
    const stale: Week = {
      ...withDays(WEEK, (item, index) =>
        index === 0
          ? { ...item, sessions: [session({ open_draft_id: 'w-old', open_draft_on: '2026-09-28' })] }
          : index === 1
            ? { ...item, sessions: item.sessions.map((s) => ({ ...s, ...notStarted })) }
            : item,
      ),
      open_drafts: [{ workout_id: 'w-old', planned_workout_id: 'pw-upper', name: 'Upper A', performed_on: '2026-09-28', block_week: 1 }],
    }
    fakeApi({ ...HOME_ROUTES, 'GET /api/week': () => ({ body: stale }) })
    render(<TrainingScreen />)
    const monday = await waitFor(() => day('monday'))
    expect(within(monday).getByTestId('session-status')).toHaveTextContent('Draft Mon 28 Sep')
    expect(within(monday).getByRole('button', { name: 'Resume Upper A draft from Mon 28 Sep' })).toBeInTheDocument()
  })
})
