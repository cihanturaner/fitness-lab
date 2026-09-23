import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BODYWEIGHT, NUTRITION, fakeApi } from '@/test/fakeApi'
import { unsavedDescriptions } from '@/lib/unsaved'
import { NutritionScreen } from '@/features/nutrition/NutritionScreen'
import { BodyweightScreen } from './BodyweightScreen'

describe('typed bodyweight and nutrition input is never dropped silently', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('counts a typed, unsaved weight as unsaved input', async () => {
    fakeApi({ 'GET /api/bodyweight': () => ({ body: BODYWEIGHT }) })
    const user = userEvent.setup()
    const { unmount } = render(<BodyweightScreen />)
    await user.type(await screen.findByRole('textbox', { name: 'Bodyweight in kg' }), '72.4')
    expect(unsavedDescriptions()).toEqual(['Bodyweight (typed, not saved)'])
    unmount()
    expect(unsavedDescriptions()).toEqual([])
  })

  it('asks before a date change would replace a typed nutrition log', async () => {
    const calls = fakeApi({ 'GET /api/nutrition': () => ({ body: NUTRITION }) })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    render(<NutritionScreen />)
    const protein = await screen.findByRole('textbox', { name: 'Protein g' })
    await user.clear(protein)
    await user.type(protein, '155')
    expect(unsavedDescriptions()).toEqual(['Nutrition log (typed, not saved)'])
    const before = calls.length
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(confirm).toHaveBeenCalled()
    expect(calls.length).toBe(before)
    expect(protein).toHaveValue('155')
  })
})
