import { describe, expect, it } from 'vitest'
import { nameKey, typedExerciseName } from './exerciseNames'

describe('typed exercise names (mirrors domain/exercise_names.py)', () => {
  it.each([
    ['triceps curl', 'Triceps Curl'],
    ['  triceps   curl ', 'Triceps Curl'],
    ['one-arm cable row', 'One-Arm Cable Row'],
    ["farmer's walk", "Farmer's Walk"],
    ['45° leg press', '45° Leg Press'],
    ['EZ-bar curl', 'EZ-bar curl'],
    ['RDL', 'RDL'],
  ])('%s → %s', (text, name) => {
    expect(typedExerciseName(text)).toBe(name)
  })

  it('refuses blank and overlong names', () => {
    expect(typedExerciseName('   ')).toBeNull()
    expect(typedExerciseName('x'.repeat(81))).toBeNull()
  })

  it('compares names without case or spacing', () => {
    expect(nameKey('Triceps  CURL ')).toBe(nameKey('triceps curl'))
  })
})
