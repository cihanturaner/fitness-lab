import { describe, expect, it } from 'vitest'
import type { Entry, EntrySlot, PerformedSet } from '@/api/types'
import { formatReps, formatRir, localDate } from '@/lib/format'
import { blockSets, buildEntryView, moveWithinBlock } from './model'

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
    approved_substitutes: [],
  }
}

function performed(order: number, exerciseId: string, slotId: string | null = null): PerformedSet {
  return {
    slot_id: slotId,
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
  it('shows each slot exactly its own sets and leaves the rest as extras', () => {
    const view = buildEntryView(
      entry(
        [slot(1, 'bench'), slot(2, 'row', 'cable-row')],
        [
          performed(1, 'bench', 'slot-1'),
          performed(2, 'cable-row', 'slot-2'),
          performed(3, 'curl'),
          performed(4, 'bench', 'slot-1'),
        ],
      ),
      [],
    )
    expect(view.slots.map((s) => s.sets.map((p) => p.id))).toEqual([
      ['set-1', 'set-4'],
      ['set-2'],
    ])
    expect(view.extras).toEqual([{ exerciseId: 'curl', sets: [performed(3, 'curl')] }])
  })

  it('keeps two slots performed as the same exercise apart: never merged, never pointed elsewhere', () => {
    const view = buildEntryView(
      entry(
        [slot(1, 'pressdown', 'triceps-curl'), slot(2, 'row'), slot(3, 'pec-deck', 'triceps-curl')],
        [
          performed(1, 'triceps-curl', 'slot-1'),
          performed(2, 'triceps-curl', 'slot-3'),
          performed(3, 'triceps-curl', 'slot-1'),
        ],
      ),
      [],
    )
    expect(view.slots.map((s) => s.sets.map((p) => p.id))).toEqual([['set-1', 'set-3'], [], ['set-2']])
    expect(view.extras).toEqual([])
  })

  it('keeps an extra exercise the lifter just picked, before any set exists', () => {
    const view = buildEntryView(entry([slot(1, 'bench')], []), ['curl', 'bench'])
    expect(view.extras).toEqual([{ exerciseId: 'curl', sets: [] }])
  })
})

describe('moveWithinBlock', () => {
  const sets = [performed(1, 'bench', 's1'), performed(2, 'row', 's2'), performed(3, 'bench', 's1')]

  it('swaps a set with the previous set of the same block', () => {
    expect(moveWithinBlock(sets, 'set-3', -1)).toEqual(['set-3', 'set-2', 'set-1'])
  })

  it('returns null when there is nothing to swap with', () => {
    expect(moveWithinBlock(sets, 'set-1', -1)).toBeNull()
    expect(moveWithinBlock(sets, 'set-3', 1)).toBeNull()
  })

  it('never swaps across two slots of the same exercise', () => {
    const twin = [performed(1, 'curl', 'a'), performed(2, 'curl', 'b'), performed(3, 'curl', 'a')]
    expect(moveWithinBlock(twin, 'set-3', -1)).toEqual(['set-3', 'set-2', 'set-1'])
    expect(moveWithinBlock(twin, 'set-2', -1)).toBeNull()
    expect(blockSets(twin, twin[1] as PerformedSet).map((p) => p.id)).toEqual(['set-2'])
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
