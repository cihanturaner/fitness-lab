import { describe, expect, it } from 'vitest'
import type { Entry, EntrySlot, PerformedSet } from '@/api/types'
import { formatReps, formatRir, localDate } from '@/lib/format'
import { buildEntryView, moveWithinExercise } from './model'

function slot(position: number, exerciseId: string, substitute: string | null = null): EntrySlot {
  return {
    id: `slot-${position}`,
    slot_key: `s.${position}`,
    position,
    exercise_id: exerciseId,
    notes: null,
    sets: [],
    substitute_exercise_id: substitute,
    effective_exercise_id: substitute ?? exerciseId,
  }
}

function performed(order: number, exerciseId: string): PerformedSet {
  return {
    id: `set-${order}`,
    workout_id: 'w',
    exercise_id: exerciseId,
    set_order: order,
    set_type: 'working',
    load_lb: '80',
    reps: 5,
    rir: 2,
    notes: null,
    entered_at_utc: 'x',
    updated_at_utc: 'x',
  }
}

function entry(slots: EntrySlot[], sets: PerformedSet[]): Entry {
  return {
    workout: {
      id: 'w',
      performed_on: '2026-10-05',
      performed_time_local: null,
      status: 'draft',
      notes: null,
      entered_at_utc: 'x',
      updated_at_utc: 'x',
    },
    origin: null,
    slots,
    sets,
    exercises: {},
    last_performance: {},
    work_sets: null,
  }
}

describe('buildEntryView', () => {
  it('shows each slot its effective exercise and leaves the rest as extras', () => {
    const view = buildEntryView(
      entry(
        [slot(1, 'bench'), slot(2, 'row', 'cable-row')],
        [performed(1, 'bench'), performed(2, 'cable-row'), performed(3, 'curl'), performed(4, 'bench')],
      ),
      [],
    )
    expect(view.slots.map((s) => s.sets.map((p) => p.id))).toEqual([
      ['set-1', 'set-4'],
      ['set-2'],
    ])
    expect(view.extras).toEqual([{ exerciseId: 'curl', sets: [performed(3, 'curl')] }])
  })

  it('gives a repeated exercise to the first slot and points later slots at it', () => {
    const view = buildEntryView(
      entry([slot(1, 'bench'), slot(2, 'row'), slot(3, 'bench')], [performed(1, 'bench')]),
      [],
    )
    expect(view.slots[0]?.sharedWith).toBeNull()
    expect(view.slots[2]?.sharedWith).toBe(1)
    expect(view.slots[2]?.sets).toEqual([])
  })

  it('keeps an extra exercise the lifter just picked, before any set exists', () => {
    const view = buildEntryView(entry([slot(1, 'bench')], []), ['curl', 'bench'])
    expect(view.extras).toEqual([{ exerciseId: 'curl', sets: [] }])
  })
})

describe('moveWithinExercise', () => {
  const sets = [performed(1, 'bench'), performed(2, 'row'), performed(3, 'bench')]

  it('swaps a set with the previous set of the same exercise', () => {
    expect(moveWithinExercise(sets, 'set-3', -1)).toEqual(['set-3', 'set-2', 'set-1'])
  })

  it('returns null when there is nothing to swap with', () => {
    expect(moveWithinExercise(sets, 'set-1', -1)).toBeNull()
    expect(moveWithinExercise(sets, 'set-3', 1)).toBeNull()
  })
})

describe('format', () => {
  it('renders rep targets', () => {
    expect(formatReps(5, 8)).toBe('5–8')
    expect(formatReps(8, 8)).toBe('8')
    expect(formatReps(10, null)).toBe('10+')
  })

  it('renders RIR targets', () => {
    expect(formatRir(2, 2)).toBe('2')
    expect(formatRir(0, 1)).toBe('0–1')
    expect(formatRir(null, null)).toBeNull()
  })

  it('uses the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05')
  })
})
