import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Nutrition } from '@/api/types'
import { NUTRITION, fakeApi } from '@/test/fakeApi'
import { NutritionScreen } from './NutritionScreen'

const EMPTY: Nutrition = { ...NUTRITION, day: null, recent: [] }

describe('NutritionScreen', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('shows the locked targets and an uncalibrated calorie target truthfully', async () => {
    fakeApi({ 'GET /api/nutrition': () => ({ body: NUTRITION }) })
    render(<NutritionScreen />)
    expect(await screen.findByTestId('nut-target-protein')).toHaveTextContent('145 g')
    expect(screen.getByTestId('nut-target-fat')).toHaveTextContent('60 g')
    expect(screen.getByTestId('nut-target-calories')).toHaveTextContent('Calorie target not calibrated yet.')
    expect(screen.getByTestId('nut-target-carbs')).toHaveTextContent('Follows the calorie target.')
    expect(screen.getByRole('textbox', { name: 'Protein g' })).toHaveValue('150')
  })

  it('saves the day with exactly what was typed; an empty field is unknown, not zero', async () => {
    const calls = fakeApi({
      'GET /api/nutrition': () => ({ body: EMPTY }),
      'PUT /api/nutrition/2026-09-01': () => ({ body: NUTRITION.day }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const date = await screen.findByLabelText('Nutrition date')
    await user.clear(date)
    await user.type(date, '2026-09-01')
    await user.type(screen.getByRole('textbox', { name: 'Calories kcal' }), '2410')
    await user.type(screen.getByRole('textbox', { name: 'Protein g' }), '150')
    await user.type(screen.getByRole('textbox', { name: 'Fat g' }), '62')
    await user.click(screen.getByRole('button', { name: 'Save day' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        calories_kcal: 2410,
        protein_g: 150,
        carbs_g: null,
        fat_g: 62,
        notes: null,
      }),
    )
  })

  it('refuses decimals and empty days', async () => {
    const calls = fakeApi({ 'GET /api/nutrition': () => ({ body: EMPTY }) })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Save day' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one/i)
    await user.type(screen.getByRole('textbox', { name: 'Protein g' }), '145.5')
    await user.click(screen.getByRole('button', { name: 'Save day' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i)
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('records a calorie target only when the lifter sets one, showing the derived carbohydrate', async () => {
    const calls = fakeApi({
      'GET /api/nutrition': () => ({ body: NUTRITION }),
      'POST /api/nutrition/calorie-targets': () => ({
        status: 201,
        body: { id: 't', effective_on: '2026-10-07', calories_kcal: 2650, notes: null, set_at_utc: 'x' },
      }),
    })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Set calorie target…' }))
    await user.type(screen.getByRole('textbox', { name: 'Calorie target in kcal' }), '2650')
    expect(screen.getByText(/\(2650 − 1120\) \/ 4 =/)).toHaveTextContent('383 g')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Record target' }))
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ calories_kcal: 2650 }),
    )
  })

  it('refuses a calorie target below protein and fat alone', async () => {
    const calls = fakeApi({ 'GET /api/nutrition': () => ({ body: NUTRITION }) })
    const user = userEvent.setup()
    render(<NutritionScreen />)
    await user.click(await screen.findByRole('button', { name: 'Set calorie target…' }))
    await user.type(screen.getByRole('textbox', { name: 'Calorie target in kcal' }), '1000')
    await user.click(screen.getByRole('button', { name: 'Record target' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 1120/)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
})
