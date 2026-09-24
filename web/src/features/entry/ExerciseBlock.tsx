import { useState } from 'react'
import { Check, Info } from 'lucide-react'
import type { ApprovedSubstitute, Exercise, LastPerformance, PerformedSet, PlannedSet } from '@/api/types'
import { compactSet, exerciseLabel, formatShortDate, targetSummary } from '@/lib/format'
import { nameKey, typedExerciseName } from '@/lib/exerciseNames'
import { SetGrid, type SetActions } from './SetGrid'

function LastLine({ performance }: { performance: LastPerformance | null | undefined }) {
  if (performance === undefined) return null
  if (performance === null) {
    return <p className="text-[13px] text-muted-foreground">Last: none yet</p>
  }
  return (
    <p className="num text-[13px] leading-[18px]" data-testid="last-performance">
      <span className="text-muted-foreground">Last (lb) </span>
      {performance.sets.map((performed, index) => (
        <span key={performed.id} className={performed.set_type === 'warmup' ? 'text-muted-foreground' : 'font-medium'}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          {compactSet(performed)}
          {performed.set_type === 'warmup' && <sup className="ml-px text-[10px]">w</sup>}
        </span>
      ))}
      <span className="text-muted-foreground">
        {' '}
        — {formatShortDate(performance.performed_on)}
        {performance.planned_workout_name ? `, ${performance.planned_workout_name}` : ', unplanned'}
      </span>
    </p>
  )
}

export interface SlotInfo {
  id: string
  key: string
  position: number
  plannedExerciseId: string
  notes: string | null
  substituted: boolean
  approved: ApprovedSubstitute[]
}

export interface ChangeActions {
  /** Any existing exercise (the planned one clears the change). */
  toExercise: (exerciseId: string) => Promise<boolean>
  /** One of the slot's approved substitutes, by its source name. */
  toApproved: (name: string) => Promise<boolean>
  /** A typed name: the existing exercise of that name, or a new one (the server decides). */
  toTyped: (name: string) => Promise<boolean>
}

const MAX_MATCHES = 8

/**
 * Change the exercise of one slot for this workout only: an approved substitute, any existing
 * exercise, or a new one typed by name. The plan, next week and every later occurrence keep
 * the planned exercise; History shows both.
 */
function ChangePanel({
  slot,
  current,
  planned,
  exercises,
  savedHere,
  change,
  onDone,
}: {
  slot: SlotInfo
  current: Exercise | undefined
  planned: Exercise | undefined
  exercises: Exercise[]
  savedHere: number
  change: ChangeActions
  onDone: () => void
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const approvedIds = new Set(slot.approved.map((item) => item.exercise_id).filter(Boolean))
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches =
    words.length === 0
      ? []
      : exercises
          .filter((item) => item.is_active && item.id !== current?.id && item.id !== slot.plannedExerciseId && !approvedIds.has(item.id))
          .filter((item) => words.every((word) => exerciseLabel(item).toLowerCase().includes(word)))
          .slice(0, MAX_MATCHES)
  // A typed name that is no exercise yet can be used as a new one. The same name in any case
  // or spacing is the existing exercise (listed above, or already this slot's), never a copy.
  const typed = typedExerciseName(query)
  const key = typed === null ? null : nameKey(typed)
  const sameName = key === null ? undefined : exercises.find((item) => item.equipment_label === null && nameKey(item.name) === key)
  const approvedName = key !== null && slot.approved.some((item) => nameKey(item.name) === key)
  const offerNew = typed !== null && sameName === undefined && !approvedName
  const retired = sameName !== undefined && !sameName.is_active
  const pick = (task: () => Promise<boolean>) => {
    setBusy(true)
    void task().then((ok) => {
      setBusy(false)
      if (ok) onDone()
    })
  }
  const option =
    'press rounded-lg bg-card px-3 py-1.5 text-left text-[13px] font-medium shadow-[0_0_0_1px_var(--border-strong)] hover:bg-emerald-50 hover:shadow-[0_0_0_1px_rgb(47_154_114/0.45)] disabled:opacity-50'
  return (
    <section
      aria-label={`Change exercise, slot ${slot.position}`}
      className="ml-10 flex animate-in flex-col gap-3 rounded-[12px] bg-sunken/70 p-3.5 text-[13px] fade-in slide-in-from-top-1 duration-200"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-semibold">Change exercise</h4>
        <span className="t-micro">This workout only · the plan stays {exerciseLabel(planned)}</span>
      </div>
      {savedHere > 0 && (
        <p className="text-warn">
          {savedHere} saved {savedHere === 1 ? 'set stays' : 'sets stay'} recorded as {exerciseLabel(current)}, as extra work.
        </p>
      )}
      {slot.approved.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="t-micro font-semibold">Approved substitutes</span>
          <div className="flex flex-wrap gap-1.5">
            {slot.approved.map((item) => {
              const active = item.exercise_id !== null && item.exercise_id === current?.id
              return (
                <button
                  key={item.name}
                  type="button"
                  disabled={busy || active}
                  aria-pressed={active}
                  className={`${option} ${active ? 'bg-emerald-50 text-emerald-800' : ''}`}
                  onClick={() => pick(() => change.toApproved(item.name))}
                >
                  {item.name}
                  {item.condition && <span className="ml-1 font-normal text-muted-foreground">({item.condition})</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="t-micro font-semibold" htmlFor={`change-search-${slot.id}`}>
          Other exercise
        </label>
        <input
          id={`change-search-${slot.id}`}
          aria-label={`Search or type an exercise, slot ${slot.position}`}
          placeholder="Search, or type a new exercise"
          autoComplete="off"
          className="h-9 rounded-[10px] border border-border-strong bg-card px-2.5 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || busy) return
            event.preventDefault()
            const only = matches.length === 1 ? matches[0] : undefined
            if (offerNew && typed !== null) pick(() => change.toTyped(typed))
            else if (only) pick(() => change.toExercise(only.id))
          }}
        />
        {matches.length > 0 && (
          <ul aria-label="Matching exercises" className="flex flex-wrap gap-1.5">
            {matches.map((item) => (
              <li key={item.id}>
                <button type="button" disabled={busy} className={option} onClick={() => pick(() => change.toExercise(item.id))}>
                  {exerciseLabel(item)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {words.length > 0 && matches.length === 0 && !offerNew && !retired && (
          <p className="text-muted-foreground">No other exercise matches “{query.trim()}”.</p>
        )}
        {retired && sameName && (
          <p className="text-muted-foreground">“{sameName.name}” is retired; it is not used again. Type another name.</p>
        )}
        {offerNew && typed !== null && (
          <button
            type="button"
            disabled={busy}
            data-testid="use-typed-exercise"
            className="press self-start rounded-lg bg-gradient-to-b from-emerald-600 to-emerald-700 px-3 py-1.5 text-left text-[13px] font-semibold text-white shadow-[0_4px_10px_-4px_rgb(27_104_79/0.6)] hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50"
            onClick={() => pick(() => change.toTyped(typed))}
          >
            Use “{typed}” for this workout
          </button>
        )}
        {offerNew && <p className="t-micro">A new exercise, saved once; this workout only — the plan keeps {exerciseLabel(planned)}.</p>}
      </div>
      <div className="flex items-center gap-3">
        {slot.substituted && (
          <button
            type="button"
            disabled={busy}
            className="press text-[13px] font-semibold text-emerald-700 hover:underline disabled:opacity-50"
            onClick={() => pick(() => change.toExercise(slot.plannedExerciseId))}
          >
            Back to {exerciseLabel(planned)}
          </button>
        )}
        <button type="button" className="press ml-auto text-[13px] text-muted-foreground hover:text-foreground" onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  )
}

/**
 * One exercise, one compact block: what was done is primary (the set grid), the
 * prescription and last performance are one line each, and everything else — slot notes,
 * substitution — waits behind a small control.
 */
export function ExerciseBlock({
  exerciseId,
  exercise,
  plannedExercise,
  slot,
  plannedSets,
  performance,
  sets,
  allSets,
  locked,
  actions,
  exercises,
  change,
}: {
  exerciseId: string
  exercise: Exercise | undefined
  plannedExercise?: Exercise | undefined
  slot?: SlotInfo
  plannedSets: PlannedSet[]
  performance: LastPerformance | null | undefined
  sets: PerformedSet[]
  allSets: PerformedSet[]
  locked: boolean
  actions: SetActions
  exercises?: Exercise[]
  change?: ChangeActions
}) {
  const [panel, setPanel] = useState<'notes' | 'change' | null>(null)
  const name = exerciseLabel(exercise)
  const toggle = (next: 'notes' | 'change') => setPanel((current) => (current === next ? null : next))

  const worked = sets.filter((performed) => performed.set_type !== 'warmup').length
  const planned = plannedSets.length
  const iconButton =
    'press inline-flex size-7 items-center justify-center rounded-lg text-faint hover:bg-sunken ' +
    'hover:text-foreground aria-expanded:bg-emerald-50 aria-expanded:text-emerald-700'
  const met = planned > 0 && worked >= planned

  return (
    <article
      data-testid={slot ? `slot-${slot.key}` : `extra-${exerciseId}`}
      aria-label={name}
      // The exercise holding the cursor is the one being trained: it rises and glows.
      className="surface mb-4 flex break-inside-avoid flex-col gap-2 p-5 transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] focus-within:shadow-[var(--shadow-glow)]"
    >
      <header className="flex items-start gap-3">
        <span
          className={`num flex size-7 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-semibold ${
            met ? 'bg-gradient-to-b from-emerald-600 to-emerald-700 text-white' : 'bg-sunken text-muted-foreground'
          }`}
        >
          {slot ? slot.position : '+'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-6 font-semibold tracking-[-0.02em]">{name}</h3>
          {slot?.substituted && (
            <p data-testid="planned-exercise" className="text-[12px] font-medium text-plan">
              Planned: {exerciseLabel(plannedExercise)} · changed for this workout
            </p>
          )}
          {!slot && <p className="text-[12px] text-muted-foreground">Extra exercise</p>}
        </div>
        {planned > 0 && (
          <span
            className={`num mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold transition-colors duration-300 ${
              met ? 'bg-emerald-100 text-emerald-800' : 'bg-sunken text-muted-foreground'
            }`}
            title="Working sets saved of planned"
          >
            {met && <Check className="pop-in size-3" strokeWidth={3} aria-hidden />}
            {worked}/{planned}
          </span>
        )}
        {slot && (
          <div className="-mt-1 flex shrink-0 gap-0.5">
            {slot.notes && (
              <button
                type="button"
                className={iconButton}
                aria-label={`Notes, ${name}`}
                aria-expanded={panel === 'notes'}
                onClick={() => toggle('notes')}
              >
                <Info className="size-4" aria-hidden />
              </button>
            )}
            {!locked && change && (
              <button
                type="button"
                className="press h-7 rounded-lg px-2 text-[13px] font-medium text-muted-foreground hover:bg-sunken hover:text-foreground aria-expanded:bg-emerald-50 aria-expanded:text-emerald-800"
                aria-label={`Change exercise, slot ${slot.position}`}
                aria-expanded={panel === 'change'}
                onClick={() => toggle('change')}
              >
                Change
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-0.5 pl-10">
        {plannedSets.length > 0 && (
          <p className="num text-[13px] leading-[18px] text-plan" data-testid="target">
            <span className="text-muted-foreground">Target </span>
            {targetSummary(plannedSets)}
          </p>
        )}
        <LastLine performance={performance} />
      </div>

      {panel === 'notes' && slot?.notes && (
        <p className="ml-10 animate-in rounded-[12px] bg-plan-surface px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-plan fade-in slide-in-from-top-1 duration-200">
          {slot.notes}
        </p>
      )}
      {panel === 'change' && slot && change && (
        <ChangePanel
          slot={slot}
          current={exercise}
          planned={plannedExercise}
          exercises={exercises ?? []}
          savedHere={sets.length}
          change={change}
          onDone={() => setPanel(null)}
        />
      )}

      <div className="pt-1">
        <SetGrid
          exerciseId={exerciseId}
          exerciseName={name}
          sets={sets}
          allSets={allSets}
          planned={plannedSets}
          locked={locked}
          actions={actions}
        />
      </div>
    </article>
  )
}
