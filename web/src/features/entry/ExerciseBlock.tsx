import { useState } from 'react'
import { ArrowLeftRight, Check, Info } from 'lucide-react'
import type { Exercise, LastPerformance, PerformedSet, PlannedSet } from '@/api/types'
import { compactSet, exerciseLabel, formatShortDate, targetSummary } from '@/lib/format'
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
  sharedWith,
  locked,
  actions,
  substitutes,
  onSubstitute,
}: {
  exerciseId: string
  exercise: Exercise | undefined
  plannedExercise?: Exercise | undefined
  slot?: SlotInfo
  plannedSets: PlannedSet[]
  performance: LastPerformance | null | undefined
  sets: PerformedSet[]
  allSets: PerformedSet[]
  sharedWith: number | null
  locked: boolean
  actions: SetActions
  substitutes?: Exercise[]
  onSubstitute?: (exerciseId: string) => void
}) {
  const [panel, setPanel] = useState<'notes' | 'swap' | null>(null)
  const name = exerciseLabel(exercise)
  const toggle = (next: 'notes' | 'swap') => setPanel((current) => (current === next ? null : next))

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
          {slot?.substituted && <p className="text-[12px] font-medium text-plan">replaces {exerciseLabel(plannedExercise)}</p>}
          {!slot && <p className="text-[12px] text-muted-foreground">Extra exercise</p>}
        </div>
        {planned > 0 && sharedWith === null && (
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
            {!locked && (
              <button
                type="button"
                className={iconButton}
                aria-label={`Substitute, slot ${slot.position}`}
                aria-expanded={panel === 'swap'}
                onClick={() => toggle('swap')}
              >
                <ArrowLeftRight className="size-4" aria-hidden />
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
      {panel === 'swap' && slot && substitutes && onSubstitute && (
        <label className="ml-10 flex animate-in items-center gap-2 text-[13px] text-muted-foreground fade-in slide-in-from-top-1 duration-200">
          Performed as
          <select
            aria-label={`Exercise performed for slot ${slot.position}`}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15"
            value={exerciseId}
            onChange={(event) => event.target.value && onSubstitute(event.target.value)}
          >
            <option value={slot.plannedExerciseId}>{exerciseLabel(plannedExercise)} (as planned)</option>
            {substitutes
              .filter((item) => item.id !== slot.plannedExerciseId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {exerciseLabel(item)}
                </option>
              ))}
          </select>
        </label>
      )}

      <div className="pt-1">
        {sharedWith !== null ? (
          <p className="pl-10 text-[13px] text-muted-foreground">Sets are recorded under exercise {sharedWith} above.</p>
        ) : (
          <SetGrid
            exerciseId={exerciseId}
            exerciseName={name}
            sets={sets}
            allSets={allSets}
            planned={plannedSets}
            locked={locked}
            actions={actions}
          />
        )}
      </div>
    </article>
  )
}
