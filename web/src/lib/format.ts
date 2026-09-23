import type { Exercise, PerformedSet, PlannedSet } from '@/api/types'

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
  const date = civil(isoDate)
  if (!date) return isoDate
  return `${WEEKDAYS[date.getDay()]?.slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()]?.slice(0, 3)} ${date.getFullYear()}`
}

/** "80×7@2" — the notebook shorthand. Unrecorded load is "–", unrecorded RIR is left off. */
export function compactSet(performed: Pick<PerformedSet, 'load_kg' | 'reps' | 'rir'>): string {
  const load = performed.load_kg ?? '–'
  const reps = performed.reps === null ? '?' : String(performed.reps)
  return performed.rir === null ? `${load}×${reps}` : `${load}×${reps}@${performed.rir}`
}

/** "3 × 5–8 · RIR 2 / 2 / 1" — the whole prescription of one exercise on one line. */
export function targetSummary(sets: PlannedSet[]): string {
  if (sets.length === 0) return ''
  const same = (values: string[]) => values.every((value) => value === values[0])
  const reps = sets.map((planned) => formatReps(planned.reps_min, planned.reps_max))
  const parts = [same(reps) ? `${sets.length} × ${reps[0]}` : `${sets.length} × ${reps.join(' / ')}`]
  const rirs = sets.map((planned) => formatRir(planned.target_rir_min, planned.target_rir_max))
  if (rirs.some((rir) => rir !== null)) {
    const shown = rirs.map((rir) => rir ?? '–')
    parts.push(`RIR ${same(shown) ? shown[0] : shown.join(' / ')}`)
  }
  const loads = sets.map((planned) => planned.target_load_kg ?? '–')
  if (sets.some((planned) => planned.target_load_kg !== null)) {
    parts.push(`${same(loads) ? loads[0] : loads.join(' / ')} kg`)
  }
  const types = sets.map((planned) => planned.set_type)
  if (types.some((type) => type !== 'working')) {
    parts.push(types.map((type) => setTypeLabel(type).toLowerCase()).join(' / '))
  }
  return parts.join(' · ')
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function civil(isoDate: string): Date | null {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

/**
 * "Mon 28 Sep" — dates inside the current year read without the year. Built by hand, not by
 * the locale, so every browser writes the same three-letter month ("Sep", never "Sept").
 */
export function formatShortDate(isoDate: string): string {
  const date = civil(isoDate)
  if (!date) return isoDate
  const text = `${WEEKDAYS[date.getDay()]?.slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()]?.slice(0, 3)}`
  return date.getFullYear() === new Date().getFullYear() ? text : `${text} ${date.getFullYear()}`
}

/** "Wednesday 23 September" — the page-title form. */
export function formatLongDate(isoDate: string): string {
  const date = civil(isoDate)
  if (!date) return isoDate
  const text = `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === new Date().getFullYear() ? text : `${text} ${date.getFullYear()}`
}

/** "21–27 Sep" or "28 Sep – 4 Oct": a Monday–Sunday span without weekdays. */
export function formatRange(startIso: string, endIso: string): string {
  const start = civil(startIso)
  const end = civil(endIso)
  if (!start || !end) return `${startIso} – ${endIso}`
  const month = (date: Date) => MONTHS[date.getMonth()]?.slice(0, 3)
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${month(end)}`
    : `${start.getDate()} ${month(start)} – ${end.getDate()} ${month(end)}`
}

/** Whole days from one civil date to another (positive when `to` is later). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = civil(fromIso)
  const to = civil(toIso)
  if (!from || !to) return 0
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** "+0.70" / "-0.25" / "0.00": a change always says which way it went. */
export function signed(value: string): string {
  return value.startsWith('-') || /^0(\.0+)?$/.test(value) ? value : `+${value}`
}

/** YYYY-MM-DD shifted by whole days, in local civil time. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return localDate(new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
}
