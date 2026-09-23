import type { Exercise, PerformedSet } from '@/api/types'

export function formatReps(min: number, max: number | null): string {
  if (max === null) return `${min}+`
  return min === max ? `${min}` : `${min}–${max}`
}

export function formatRir(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null
  return min === max ? `${min}` : `${min}–${max}`
}

/** The lifter's civil calendar date on this machine, YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function exerciseLabel(exercise: Exercise | undefined): string {
  if (!exercise) return 'Unknown exercise'
  return exercise.equipment_label ? `${exercise.name} (${exercise.equipment_label})` : exercise.name
}

const SET_TYPE_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  working: 'Working',
  backoff: 'Back-off',
}

export function setTypeLabel(code: string | null): string {
  return code === null ? 'Unclassified' : (SET_TYPE_LABELS[code] ?? code)
}

/** "80 kg × 5 @ 2" with explicit gaps where nothing was recorded. */
export function describeSet(performed: PerformedSet): string {
  const load = performed.load_kg === null ? 'no load' : `${performed.load_kg} kg`
  const reps = performed.reps === null ? '? reps' : `${performed.reps}`
  const rir = performed.rir === null ? '' : ` @ RIR ${performed.rir}`
  return `${load} × ${reps}${rir}`
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
