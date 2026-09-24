import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MacroTarget, Nutrition, NutritionReview, Review } from '@/api/types'
import { NUTRITION, REVIEW, TARGET, fakeApi } from '@/test/fakeApi'
import { NutritionScreen } from './NutritionScreen'

const EMPTY: Nutrition = { ...NUTRITION, day: null, recent: [] }
const EARLY: NutritionReview = { ...REVIEW, review: { ...(REVIEW.review as Review), phase: 'early' } }

describe('NutritionScreen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    // "Today" is the fixtures' day: Wed 7 Oct 2026, in block week 1.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('has no target until the lifter records one, and says so', async () => {
    fakeApi({ 'GET /api/nutrition': () => ({ body: NUTRITION }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }), })
    render(<NutritionScreen />)
    expect(await screen.findByTestId('nut-target-protein')).toHaveTextContent('no target')
    expect(screen.getByTestId('nut-target-carbs')).toHaveTextContent('no target')
    expect(screen.getByTestId('nut-target-fat')).toHaveTextContent('no target')
    expect(screen.getByTestId('nut-target-calories')).toHaveTextContent('No target yet.')
    expect(screen.getByTestId('nut-target-line')).toHaveTextContent('Current targets: none yet')
    expect(screen.getByRole('textbox', { name: 'Protein g' })).toHaveValue('150')
  })

  it('shows the targets in force and their derived calories', async () => {
    fakeApi({
      'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: TARGET, target_history: [TARGET] } }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    render(<NutritionScreen />)
    expect(await screen.findByTestId('nut-target-protein')).toHaveTextContent('150 g')
    expect(screen.getByTestId('nut-target-carbs')).toHaveTextContent('300 g')
    expect(screen.getByTestId('nut-target-fat')).toHaveTextContent('70 g')
    expect(screen.getByTestId('nut-target-calories')).toHaveTextContent('2430 kcal')
    expect(screen.getByTestId('nut-target-line')).toHaveTextContent('Current targets: 150P · 300C · 70F / 2430 kcal')
    expect(screen.getByRole('region', { name: 'Nutrition targets' })).toHaveTextContent('Since Thu 1 Oct.')
  })

  it('keeps the target a setting: the day form holds only what was eaten', async () => {
    fakeApi({
      'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: TARGET, target_history: [TARGET] } }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    render(<NutritionScreen />)
    const day = await screen.findByRole('form', { name: 'Log the day' })
    expect(within(day).getAllByRole('textbox').map((box) => box.getAttribute('aria-label'))).toEqual([
      'Protein g',
      'Carbs g',
      'Fat g',
      'Nutrition notes',
    ])
    expect(within(day).queryByText(/target/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Macro targets' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit targets' })).toBeInTheDocument()
  })

  it('saves the day with exactly what was typed; an empty field is unknown, not zero', async () => {
    const calls = fakeApi({
      'GET /api/nutrition': () => ({ body: EMPTY }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
      'PUT /api/nutrition/2026-09-01': () => ({ body: NUTRITION.day }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const date = await screen.findByLabelText('Nutrition date')
    await user.clear(date)
    await user.type(date, '2026-09-01')
    // Calories are never typed: there is no field for them.
    expect(screen.queryByRole('textbox', { name: /calories/i })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Protein g' }), '150')
    await user.type(screen.getByRole('textbox', { name: 'Fat g' }), '62')
    // 150 x 4 + 62 x 9, live, before anything is saved.
    expect(screen.getByTestId('nut-live-kcal')).toHaveTextContent('1158 kcal')
    await user.click(screen.getByRole('button', { name: 'Save day' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        protein_g: 150,
        carbs_g: null,
        fat_g: 62,
        notes: null,
      }),
    )
  })

  it('computes calories live from the macros as they are typed and edited', async () => {
    fakeApi({
      'GET /api/nutrition': () => ({ body: EMPTY }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const live = await screen.findByTestId('nut-live-kcal')
    expect(live).toHaveTextContent('0 kcal')
    await user.type(screen.getByRole('textbox', { name: 'Fat g' }), '10')
    expect(live).toHaveTextContent('90 kcal')
    await user.type(screen.getByRole('textbox', { name: 'Protein g' }), '10')
    expect(live).toHaveTextContent('130 kcal')
    await user.type(screen.getByRole('textbox', { name: 'Carbs g' }), '10')
    expect(live).toHaveTextContent('170 kcal')
    // An edit re-derives: 76 P, 210 C, 70 F is 304 + 840 + 630.
    for (const [name, value] of [['Protein g', '76'], ['Carbs g', '210'], ['Fat g', '70']] as const) {
      await user.clear(screen.getByRole('textbox', { name }))
      await user.type(screen.getByRole('textbox', { name }), value)
    }
    expect(live).toHaveTextContent('1774 kcal')
    expect(screen.getByText('304 + 840 + 630 kcal')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Fat g' }))
    await user.type(screen.getByRole('textbox', { name: 'Fat g' }), '0')
    expect(live).toHaveTextContent('1144 kcal')
  })

  it('shows a logged day with the calories derived from its macros', async () => {
    fakeApi({
      'GET /api/nutrition': () => ({ body: NUTRITION }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    render(<NutritionScreen />)
    const recent = await screen.findByRole('region', { name: 'Recent days' })
    const row = within(recent).getAllByTestId('nut-day')[0]
    expect(row).toHaveTextContent('2318')
    expect(screen.getByRole('region', { name: 'Daily summary' })).toHaveTextContent('2318')
  })

  it('refuses decimals and empty days', async () => {
    const calls = fakeApi({ 'GET /api/nutrition': () => ({ body: EMPTY }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }), })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Save day' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one/i)
    await user.type(screen.getByRole('textbox', { name: 'Protein g' }), '145.5')
    await user.click(screen.getByRole('button', { name: 'Save day' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i)
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('records protein, carbs and fat targets; the calorie target is derived, never typed', async () => {
    const calls = fakeApi({
      'GET /api/nutrition': () => ({ body: NUTRITION }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
      'POST /api/nutrition/targets': () => ({ status: 201, body: TARGET }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Set targets' }))
    const form = screen.getByRole('form', { name: 'Macro targets' })
    // Effective from today unless the lifter picks another date.
    expect(within(form).getByLabelText('Targets effective from')).toHaveValue('2026-10-07')
    // The locked source's protein and fat are offered; carbs are the lifter's to set.
    expect(within(form).getByRole('textbox', { name: 'Protein target g' })).toHaveValue('145')
    expect(within(form).getByRole('textbox', { name: 'Fat target g' })).toHaveValue('60')
    expect(within(form).queryByRole('textbox', { name: /calorie/i })).not.toBeInTheDocument()
    for (const [name, value] of [['Protein target g', '150'], ['Carbs target g', '300'], ['Fat target g', '70']] as const) {
      await user.clear(within(form).getByRole('textbox', { name }))
      await user.type(within(form).getByRole('textbox', { name }), value)
    }
    expect(within(form).getByTestId('target-form-kcal')).toHaveTextContent('150 × 4 + 300 × 4 + 70 × 9 = 2430 kcal')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    await user.click(within(form).getByRole('button', { name: 'Save targets' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
        protein_g: 150,
        carbs_g: 300,
        fat_g: 70,
      }),
    )
  })

  it('refuses a target missing a macro', async () => {
    const calls = fakeApi({ 'GET /api/nutrition': () => ({ body: NUTRITION }),
      'GET /api/nutrition/review': () => ({ body: REVIEW }), })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Set targets' }))
    await user.click(screen.getByRole('button', { name: 'Save targets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/protein, carbs and fat/)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('sets up the first target in weeks 1–2 without asking for an exception', async () => {
    const calls = fakeApi({
      'GET /api/nutrition': () => ({ body: NUTRITION }),
      'GET /api/nutrition/review': () => ({ body: EARLY }),
      'POST /api/nutrition/targets': () => ({ status: 201, body: TARGET }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Set targets' }))
    const form = screen.getByRole('form', { name: 'Macro targets' })
    expect(within(form).queryByRole('combobox', { name: 'Target reason' })).not.toBeInTheDocument()
    expect(form).not.toHaveTextContent(/exception/i)
    await user.type(within(form).getByRole('textbox', { name: 'Carbs target g' }), '300')
    await user.click(within(form).getByRole('button', { name: 'Save targets' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        effective_on: '2026-10-07',
        protein_g: 145,
        carbs_g: 300,
        fat_g: 60,
        notes: null,
      }),
    )
  })

  it('treats a target set today as still being set up: correcting it asks for no exception', async () => {
    const today: MacroTarget = { ...TARGET, id: 't-today', effective_on: '2026-10-07' }
    fakeApi({
      'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: today, target_history: [today] } }),
      'GET /api/nutrition/review': () => ({ body: EARLY }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Edit targets' }))
    const form = screen.getByRole('form', { name: 'Macro targets' })
    expect(within(form).queryByRole('combobox', { name: 'Target reason' })).not.toBeInTheDocument()
  })

  it('still asks for an exception to change an established target in weeks 1–2', async () => {
    fakeApi({
      'GET /api/nutrition': () => ({ body: { ...NUTRITION, target: TARGET, target_history: [TARGET] } }),
      'GET /api/nutrition/review': () => ({ body: EARLY }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Edit targets' }))
    const form = screen.getByRole('form', { name: 'Macro targets' })
    expect(within(form).getByRole('combobox', { name: 'Target reason' })).toBeInTheDocument()
    expect(form).toHaveTextContent('Change an established target only for one of the source’s exceptions.')
  })

  it('shows a past day against the target it had, not today’s', async () => {
    const newer: MacroTarget = { ...TARGET, id: 't2', effective_on: '2026-10-05', carbs_g: 340, calories_kcal: 2590 }
    fakeApi({
      'GET /api/nutrition': (call) =>
        call.url.includes('date=2026-10-02')
          ? { body: { ...NUTRITION, date: '2026-10-02', day: null, target: TARGET, target_history: [newer, TARGET] } }
          : { body: { ...NUTRITION, target: newer, target_history: [newer, TARGET] } },
      'GET /api/nutrition/review': () => ({ body: REVIEW }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    expect(await screen.findByTestId('nut-target-line')).toHaveTextContent('150P · 340C · 70F / 2590 kcal')
    for (let step = 0; step < 5; step += 1) await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(screen.getByText(/Friday 2 October/)).toBeInTheDocument())
    expect(await screen.findByTestId('nut-day-target')).toHaveTextContent('150P · 300C · 70F / 2430 kcal')
    expect(screen.getByTestId('nut-target-carbs')).toHaveTextContent('300 g')
    // The setting still shows today's target.
    expect(screen.getByTestId('nut-target-line')).toHaveTextContent('150P · 340C · 70F / 2590 kcal')
  })
})
