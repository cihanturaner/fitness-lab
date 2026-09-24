import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MacroTarget, NutritionReview, Review } from '@/api/types'
import { NUTRITION, REVIEW, fakeApi } from '@/test/fakeApi'
import { NutritionScreen } from './NutritionScreen'

function reviewWith(changes: Partial<Review>, extra: Partial<NutritionReview> = {}): NutritionReview {
  return { ...REVIEW, ...extra, review: { ...(REVIEW.review as Review), ...changes } }
}

const UNDER = reviewWith({
  phase: 'decision',
  block_week: 3,
  week_start: '2026-10-12',
  week_end: '2026-10-18',
  trend: {
    window_first: '2026-10-05',
    window_last: '2026-10-18',
    weigh_ins: 14,
    first_half: 7,
    second_half: 7,
    pct_bw_per_week: '0.07',
    reason: 'OK',
    band: 'UNDER_GAIN',
  },
  status: 'UNDER_GAIN',
  decision_due: true,
  recommended_action: 'ADD_CALORIES',
  recommended_delta_kcal: 150,
  current_target_kcal: 2430,
  recommended_target_kcal: 2582,
  recommended_carbs_g: 338,
  current_macros: { protein_g: 150, carbs_g: 300, fat_g: 70, calories_kcal: 2430 },
  recommended_macros: { protein_g: 150, carbs_g: 338, fat_g: 70, calories_kcal: 2582 },
  note: null,
})

const TARGET: MacroTarget = {
  id: 't1',
  effective_on: '2026-09-30',
  protein_g: 150,
  carbs_g: 300,
  fat_g: 70,
  calories_kcal: 2430,
  legacy_calories_kcal: null,
  notes: 'Starting rule',
  set_at_utc: '2026-09-30T07:00:00Z',
}

function serve(review: NutritionReview, extra: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: TARGET, target_history: [TARGET] } }),
    'GET /api/nutrition/review': () => ({ body: review }),
    ...extra,
  })
}

describe('Weekly review', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    // "Today" is the fixtures' day, Wed 7 Oct 2026: the 1 Oct target is established by then.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('shows trend, status and recommendation, and changes nothing until the lifter chooses', async () => {
    const calls = serve(UNDER, {
      'POST /api/nutrition/review/decision': () => ({ status: 201, body: {} }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const panel = await screen.findByRole('region', { name: 'Weekly review' })
    expect(within(panel).getByTestId('review-trend')).toHaveTextContent('+0.07 % BW/week')
    expect(within(panel).getByTestId('review-status')).toHaveTextContent('UNDER_GAINSlow gainHEURISTIC')
    // Current macro targets and exactly what Apply would record, before anything changes.
    expect(within(panel).getByTestId('review-current-targets')).toHaveTextContent('150 P · 300 C · 70 F = 2430 kcal')
    expect(within(panel).getByTestId('review-recommendation')).toHaveTextContent(
      '+150 kcal/day → carbs +38 g: 150 P · 338 C · 70 F = 2582 kcal',
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    await user.click(within(panel).getByRole('button', { name: 'Apply +150 kcal' }))
    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/nutrition/review/decision')?.body).toMatchObject({
        block_week: 3,
        choice: 'APPLIED',
        expected_status: 'UNDER_GAIN',
        expected_delta_kcal: 150,
        expected_target_kcal: 2582,
        expected_macros: { protein_g: 150, carbs_g: 338, fat_g: 70 },
      }),
    )
  })

  it('records keeping the current target as a decision too', async () => {
    const calls = serve(UNDER, { 'POST /api/nutrition/review/decision': () => ({ status: 201, body: {} }) })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const panel = await screen.findByRole('region', { name: 'Weekly review' })
    await user.click(within(panel).getByRole('button', { name: 'Keep current' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ choice: 'KEPT' }),
    )
  })

  it('offers nothing to decide on insufficient data, and says when the next decision is', async () => {
    const thin = reviewWith({
      phase: 'decision',
      block_week: 4,
      trend: { ...UNDER.review!.trend!, weigh_ins: 9, first_half: 4, second_half: 5, pct_bw_per_week: null, reason: 'TOO_FEW_WEIGH_INS', band: null },
      status: 'INSUFFICIENT_DATA',
      decision_due: false,
      next_decision_week: 5,
      next_decision_on: '2026-11-01',
    })
    serve(thin)
    render(<NutritionScreen />)
    const panel = await screen.findByRole('region', { name: 'Weekly review' })
    expect(within(panel).getByTestId('review-trend')).toHaveTextContent('Not qualified: 9/14 weigh-ins (needs 6 in each week: 4 + 5).')
    expect(within(panel).queryByRole('button', { name: /Apply|Keep/ })).not.toBeInTheDocument()
    expect(within(panel).getByTestId('review-next')).toHaveTextContent('Next routine decision: end of week 5 (Sun 1 Nov).')
  })

  it('opens the diagnostic gate: underfeeding can be confirmed only on reliable inputs', async () => {
    const gate = reviewWith({ ...UNDER.review!, status: 'DIAGNOSTIC_GATE', recommended_action: 'AUDIT_BEFORE_CONTINUING', recommended_delta_kcal: null, recommended_target_kcal: null, recommended_carbs_g: null, recommended_macros: null, failed_corrections: 2, block_week: 7 })
    const calls = serve(gate, { 'POST /api/nutrition/review/gate': () => ({ status: 201, body: {} }) })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const audit = await screen.findByRole('group', { name: 'Diagnostic gate audit' })
    const screenPanel = screen.getByRole('region', { name: 'Weekly review' })
    expect(within(screenPanel).queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument()
    const confirm = within(audit).getByRole('button', { name: 'Underfeeding confirmed' })
    expect(confirm).toBeDisabled()
    for (const name of REVIEW.gate_checks) {
      const reliable = REVIEW.reliability_checks.includes(name)
      const group = within(audit).getAllByRole('radiogroup')[REVIEW.gate_checks.indexOf(name)] as HTMLElement
      await user.click(within(group).getByRole('radio', { name: reliable ? 'Yes' : 'No' }))
    }
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/nutrition/review/gate')?.body).toMatchObject({
        block_week: 7,
        result: 'GENUINE_UNDERFEEDING_CONFIRMED',
        checks: expect.objectContaining({ adherence_consistent: true, illness_travel: false }),
      }),
    )
  })

  it('after “inputs unreliable” the audit can be redone, and the current target kept', async () => {
    const fix = reviewWith({ ...UNDER.review!, status: 'DIAGNOSTIC_GATE', recommended_action: 'FIX_INPUT_PROBLEM_FIRST', recommended_delta_kcal: null, recommended_target_kcal: null, recommended_carbs_g: null, recommended_macros: null, failed_corrections: 2, block_week: 7 })
    serve(fix)
    render(<NutritionScreen />)
    expect(await screen.findByRole('group', { name: 'Diagnostic gate audit' })).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Weekly review' })
    expect(within(panel).getByTestId('review-recommendation')).toHaveTextContent('Fix the input problem first')
    expect(within(panel).getByRole('button', { name: 'Keep current' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument()
  })

  it('lists the target history and scores each day against the target in force on it', async () => {
    const raised: MacroTarget = {
      ...TARGET,
      id: 't2',
      effective_on: '2026-10-06',
      carbs_g: 338,
      calories_kcal: 2582,
      notes: 'Week 3 review: UNDER_GAIN, +152 kcal/day applied',
    }
    const day = (logged_on: string, carbs_g: number, target: MacroTarget | null) => ({
      logged_on,
      // As the server derives them: 150 x 4 + carbs x 4 + 70 x 9.
      calories_kcal: 600 + carbs_g * 4 + 630,
      calories_complete: true,
      protein_g: 150,
      carbs_g,
      fat_g: 70,
      notes: null,
      target,
    })
    fakeApi({
      'GET /api/nutrition': () => ({
        body: {
          ...NUTRITION,
          target: raised,
          recent: [day('2026-10-07', 338, raised), day('2026-10-05', 310, TARGET), day('2026-09-28', 300, null)],
          target_history: [raised, TARGET],
        },
      }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'History (2)' }))
    const history = await screen.findByRole('region', { name: 'Target history' })
    const rows = within(history).getAllByTestId('target-row')
    expect(rows[0]).toHaveTextContent('15033870' + '2582+152Week 3 review')
    expect(rows[1]).toHaveTextContent('150300702430first')
    const days = screen.getAllByTestId('nut-day')
    expect(days[0]).toHaveTextContent('25820150') // on target that day: 0
    expect(days[1]).toHaveTextContent('2470+40') // against 2430 in force on 5 Oct, not 2582
    expect(days[2]).not.toHaveTextContent('+') // no target existed on 28 Sep
  })

  it('computes the starting rule from the recent stable intake the lifter types', async () => {
    fakeApi({
      'GET /api/nutrition': () => ({ body: NUTRITION }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Set targets' }))
    await user.type(screen.getByRole('textbox', { name: 'Recent stable intake in kcal' }), '2500')
    expect(screen.getByTestId('starting-target')).toHaveTextContent('2650 kcal')
    // At the source's 145 g protein and 60 g fat: (2650 - 1120) / 4 = 382.5 -> 383 g.
    await user.click(screen.getByRole('button', { name: 'Use 383 g carbs' }))
    expect(screen.getByRole('textbox', { name: 'Carbs target g' })).toHaveValue('383')
  })

  it('in weeks 1–2 a target change needs one of the source’s exceptions', async () => {
    const early = reviewWith({ phase: 'early', current_target_kcal: 2430 })
    const calls = fakeApi({
      'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: TARGET, target_history: [TARGET] } }),
      'GET /api/nutrition/review': () => ({ body: early }),
      'POST /api/nutrition/targets': () => ({ status: 201, body: TARGET }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await screen.findByRole('region', { name: 'Weekly review' })
    await user.click(screen.getByRole('button', { name: 'Edit targets' }))
    // The form starts from the target in force.
    expect(screen.getByRole('textbox', { name: 'Carbs target g' })).toHaveValue('300')
    await user.clear(screen.getByRole('textbox', { name: 'Carbs target g' }))
    await user.type(screen.getByRole('textbox', { name: 'Carbs target g' }), '260')
    await user.click(screen.getByRole('button', { name: 'Save targets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('choose the exception')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Target reason' }), 'illness')
    await user.click(screen.getByRole('button', { name: 'Save targets' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
        carbs_g: 260,
        notes: 'Weeks 1–2 exception: illness',
      }),
    )
  })
})
