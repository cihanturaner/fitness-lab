import type { Entry, EntrySlot, PerformedSet } from '@/api/types'

/**
 * Presentation only. Every set of a workout's entry carries the planned slot it belongs to
 * (`slot_id`, resolved by the server: the slot it was recorded in, or — for sets recorded
 * before V3.3.1 — the first slot performed as its exercise). Each slot shows exactly its own
 * sets, so two slots performed as the same exercise never merge; a set in no slot is extra
 * work, grouped by its exercise.
 */
export interface SlotView {
  slot: EntrySlot
  sets: PerformedSet[]
}

export interface ExerciseGroup {
  exerciseId: string
  sets: PerformedSet[]
}

export interface EntryView {
  slots: SlotView[]
  extras: ExerciseGroup[]
}

export function buildEntryView(entry: Entry, pendingExtras: string[]): EntryView {
  const slotIds = new Set(entry.slots.map((slot) => slot.id))
  const bySlot = new Map<string, PerformedSet[]>()
  const extraSets = new Map<string, PerformedSet[]>()
  for (const performed of [...entry.sets].sort((a, b) => a.set_order - b.set_order)) {
    const slotId = performed.slot_id ?? null
    if (slotId !== null && slotIds.has(slotId)) {
      bySlot.set(slotId, [...(bySlot.get(slotId) ?? []), performed])
    } else {
      extraSets.set(performed.exercise_id, [...(extraSets.get(performed.exercise_id) ?? []), performed])
    }
  }

  const slots = [...entry.slots]
    .sort((a, b) => a.position - b.position)
    .map((slot) => ({ slot, sets: bySlot.get(slot.id) ?? [] }))
  const inSlots = new Set(slots.map((view) => view.slot.effective_exercise_id))

  const extras: ExerciseGroup[] = [...extraSets].map(([exerciseId, sets]) => ({ exerciseId, sets }))
  for (const exerciseId of pendingExtras) {
    if (!inSlots.has(exerciseId) && !extraSets.has(exerciseId)) {
      extras.push({ exerciseId, sets: [] })
    }
  }
  return { slots, extras }
}

/** Two sets are in one block when they share their slot (or both are extra work) and exercise. */
function sameBlock(a: PerformedSet, b: PerformedSet): boolean {
  return a.exercise_id === b.exercise_id && (a.slot_id ?? null) === (b.slot_id ?? null)
}

/** The sets of `performed`'s block, in session order: what "set 2" of a block counts. */
export function blockSets(sets: PerformedSet[], performed: PerformedSet): PerformedSet[] {
  return [...sets].sort((a, b) => a.set_order - b.set_order).filter((other) => sameBlock(other, performed))
}

/** New global order after swapping a set with its neighbour in the same block. */
export function moveWithinBlock(sets: PerformedSet[], setId: string, direction: -1 | 1): string[] | null {
  const ordered = [...sets].sort((a, b) => a.set_order - b.set_order)
  const index = ordered.findIndex((performed) => performed.id === setId)
  const current = ordered[index]
  if (!current) return null
  let neighbour = index + direction
  while (ordered[neighbour] && !sameBlock(ordered[neighbour] as PerformedSet, current)) {
    neighbour += direction
  }
  const other = ordered[neighbour]
  if (!other) return null
  const ids = ordered.map((performed) => performed.id)
  ids[index] = other.id
  ids[neighbour] = current.id
  return ids
}
