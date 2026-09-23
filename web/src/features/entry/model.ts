import type { Entry, EntrySlot, PerformedSet } from '@/api/types'

/**
 * Presentation only. Actual sets carry no link to a planned slot (spec §6.7), so they are
 * grouped by exercise: each group appears under the first slot whose effective exercise
 * matches; later slots with the same exercise point to it; anything else is extra work.
 */
export interface SlotView {
  slot: EntrySlot
  sets: PerformedSet[]
  sharedWith: number | null
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
  const byExercise = new Map<string, PerformedSet[]>()
  for (const performed of [...entry.sets].sort((a, b) => a.set_order - b.set_order)) {
    const list = byExercise.get(performed.exercise_id) ?? []
    list.push(performed)
    byExercise.set(performed.exercise_id, list)
  }

  const claimedBy = new Map<string, number>()
  const slots = [...entry.slots]
    .sort((a, b) => a.position - b.position)
    .map((slot) => {
      const owner = claimedBy.get(slot.effective_exercise_id)
      if (owner !== undefined) return { slot, sets: [], sharedWith: owner }
      claimedBy.set(slot.effective_exercise_id, slot.position)
      return { slot, sets: byExercise.get(slot.effective_exercise_id) ?? [], sharedWith: null }
    })

  const extras: ExerciseGroup[] = []
  for (const [exerciseId, sets] of byExercise) {
    if (!claimedBy.has(exerciseId)) extras.push({ exerciseId, sets })
  }
  for (const exerciseId of pendingExtras) {
    if (!claimedBy.has(exerciseId) && !byExercise.has(exerciseId)) {
      extras.push({ exerciseId, sets: [] })
    }
  }
  return { slots, extras }
}

/** New global order after swapping a set with its neighbour of the same exercise. */
export function moveWithinExercise(
  sets: PerformedSet[],
  setId: string,
  direction: -1 | 1,
): string[] | null {
  const ordered = [...sets].sort((a, b) => a.set_order - b.set_order)
  const index = ordered.findIndex((performed) => performed.id === setId)
  const current = ordered[index]
  if (!current) return null
  let neighbour = index + direction
  while (ordered[neighbour] && ordered[neighbour]?.exercise_id !== current.exercise_id) {
    neighbour += direction
  }
  const other = ordered[neighbour]
  if (!other) return null
  const ids = ordered.map((performed) => performed.id)
  ids[index] = other.id
  ids[neighbour] = current.id
  return ids
}
