import { describe, expect, it } from 'vitest'
import type { PlannedSet } from '@/api/types'
import { addDays, compactSet, signed, targetSummary } from './format'
import { parseBodyweight, parseWhole } from './numbers'

function planned(reps_min: number, reps_max: number | null, rir: [number, number] | null, load: string | null = null): PlannedSet {
  return {
    id: 'p',
    position: 1,
    set_type: 'working',
    reps_min,
    reps_max,
    target_rir_min: rir?.[0] ?? null,
    target_rir_max: rir?.[1] ?? null,
    target_load_kg: load,
    notes: null,
  }
}

describe('notebook formatting', () => {
  it('writes a set as kg×reps@RIR', () => {
    expect(compactSet({ load_kg: '82.5', reps: 6, rir: 2 })).toBe('82.5×6@2')
    expect(compactSet({ load_kg: null, reps: 10, rir: null })).toBe('–×10')
  })

  it('summarises a prescription on one line', () => {
    expect(targetSummary([planned(5, 8, [2, 2]), planned(5, 8, [2, 2]), planned(5, 8, [1, 1])])).toBe(
      '3 × 5–8 · RIR 2 / 2 / 1',
    )
    expect(targetSummary([planned(8, 12, [0, 1]), planned(8, 12, [0, 1])])).toBe('2 × 8–12 · RIR 0–1')
    expect(targetSummary([planned(10, null, null, '60'), planned(10, null, null, '60')])).toBe('2 × 10+ · 60 kg')
  })

  it('always signs a change', () => {
    expect(signed('0.70')).toBe('+0.70')
    expect(signed('-0.25')).toBe('-0.25')
    expect(signed('0.00')).toBe('0.00')
  })

  it('moves dates by civil days', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('number entry', () => {
  it('accepts plausible bodyweight with at most two decimals', () => {
    expect(parseBodyweight('72,4')).toBe('72.4')
    expect(parseBodyweight('72.45')).toBe('72.45')
    expect(parseBodyweight('72.456')).toBeNull()
    expect(parseBodyweight('724')).toBeNull()
    expect(parseBodyweight('19.9')).toBeNull()
  })

  it('accepts whole numbers only, empty meaning not logged', () => {
    expect(parseWhole('', 1500)).toEqual({ ok: true, value: null })
    expect(parseWhole('145', 1500)).toEqual({ ok: true, value: 145 })
    expect(parseWhole('145.5', 1500)).toEqual({ ok: false })
    expect(parseWhole('1501', 1500)).toEqual({ ok: false })
    expect(parseWhole('-1', 1500)).toEqual({ ok: false })
  })
})
