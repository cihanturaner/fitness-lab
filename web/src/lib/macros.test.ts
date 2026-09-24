import { describe, expect, it } from 'vitest'
import { macroCalories } from './macros'

describe('macroCalories', () => {
  it.each([
    [{ protein: null, carbs: null, fat: 10 }, 90],
    [{ protein: 10, carbs: null, fat: null }, 40],
    [{ protein: null, carbs: 10, fat: null }, 40],
    [{ protein: 76, carbs: 210, fat: 70 }, 1774],
    [{ protein: 0, carbs: 0, fat: 0 }, 0],
  ])('%o is %i kcal', (macros, kcal) => {
    expect(macroCalories(macros).total).toBe(kcal)
  })

  it('splits the total by macro', () => {
    expect(macroCalories({ protein: 76, carbs: 210, fat: 70 }).parts).toEqual({ protein: 304, carbs: 840, fat: 630 })
  })

  it('is complete only when every macro is recorded, zero included', () => {
    expect(macroCalories({ protein: 0, carbs: 0, fat: 0 }).complete).toBe(true)
    expect(macroCalories({ protein: 150, carbs: null, fat: 60 }).complete).toBe(false)
    expect(macroCalories({ protein: null, carbs: null, fat: null }).any).toBe(false)
  })
})
