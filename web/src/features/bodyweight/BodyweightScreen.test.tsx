import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BODYWEIGHT, fakeApi } from '@/test/fakeApi'
import { BodyweightScreen } from './BodyweightScreen'

describe('BodyweightScreen', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('leads with the 7-day average, and shows the change only between comparable weeks', async () => {
    fakeApi({ 'GET /api/bodyweight': () => ({ body: BODYWEIGHT }) })
    render(<BodyweightScreen />)
    expect(await screen.findByTestId('bw-avg7')).toHaveTextContent('72.30 kg (7/7 days)')
    expect(screen.getByTestId('bw-latest')).toHaveTextContent('72.6 kg')
    expect(screen.getByTestId('bw-prev7')).toHaveTextContent('71.60 kg (6/7 days)')
    expect(screen.getByTestId('bw-change')).toHaveTextContent('+0.70 kg')
    expect(screen.getByTestId('bw-change')).not.toHaveTextContent('%')
    expect(screen.getByTestId('bw-trend')).toHaveTextContent('not qualified: needs 6 weigh-ins in each week (0 + 2)')
    expect(screen.getByText(/similar clothing/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Daily bodyweight and 7-day average' })).toBeInTheDocument()
    expect(screen.getAllByTestId('bw-entry')).toHaveLength(2)
  })

  it('shows the qualified 14-day trend against the band, and no change from thin weeks', async () => {
    fakeApi({
      'GET /api/bodyweight': () => ({
        body: {
          ...BODYWEIGHT,
          summary: { ...BODYWEIGHT.summary, current_count: 7, previous_count: 2 },
          trend: { ...BODYWEIGHT.trend, weigh_ins: 13, first_half: 6, second_half: 7, pct_bw_per_week: '0.07', qualified: true, band: 'UNDER_GAIN' },
        },
      }),
    })
    render(<BodyweightScreen />)
    expect(await screen.findByTestId('bw-trend')).toHaveTextContent('+0.07 % BW/week · below the 0.10–0.25 band')
    expect(screen.getByTestId('bw-change')).toHaveTextContent('needs 4 weigh-ins in each week')
  })

  it('saves exactly the weight typed for the chosen date', async () => {
    const calls = fakeApi({
      'GET /api/bodyweight': () => ({ body: BODYWEIGHT }),
      'PUT /api/bodyweight/2026-09-01': () => ({
        body: { measured_on: '2026-09-01', bodyweight_kg: '72.35', notes: null },
      }),
    })
    const user = userEvent.setup()
    render(<BodyweightScreen />)
    const date = await screen.findByLabelText('Weigh-in date')
    await user.clear(date)
    await user.type(date, '2026-09-01')
    await user.type(screen.getByRole('textbox', { name: 'Bodyweight in kg' }), '72,35{Enter}')
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ bodyweight_kg: '72.35', notes: null }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Saved 72.35 kg')
  })

  it('refuses an implausible or over-precise weight instead of rounding it', async () => {
    const calls = fakeApi({ 'GET /api/bodyweight': () => ({ body: BODYWEIGHT }) })
    const user = userEvent.setup()
    render(<BodyweightScreen />)
    const kg = await screen.findByRole('textbox', { name: 'Bodyweight in kg' })
    for (const typed of ['724', '72.345', '12']) {
      await user.clear(kg)
      await user.type(kg, `${typed}{Enter}`)
      expect(await screen.findByRole('alert')).toHaveTextContent(/not saved/i)
    }
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('asks before removing a weigh-in', async () => {
    const calls = fakeApi({ 'GET /api/bodyweight': () => ({ body: BODYWEIGHT }) })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    render(<BodyweightScreen />)
    const row = (await screen.findAllByTestId('bw-entry'))[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: /Remove weigh-in/ }))
    expect(confirm).toHaveBeenCalled()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
})
