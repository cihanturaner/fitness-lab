import { useState } from 'react'
import type { Exercise, LastPerformance, PerformedSet, PlannedSet } from '@/api/types'
import { compactSet, exerciseLabel, formatShortDate, targetSummary } from '@/lib/format'
import { SetGrid, type SetActions } from './SetGrid'

function LastLine({ performance }: { performance: LastPerformance | null | undefined }) {
  if (performance === undefined) return null
  if (performance === null) {
    return <p className="text-[12px] text-muted-foreground">Last: none yet</p>
  }
  return (
    <p className="num text-[12px] leading-snug" data-testid="last-performance">
      <span className="text-muted-foreground">Last </span>
      {performance.sets.map((performed, index) => (
        <span key={performed.id} className={performed.set_type === 'warmup' ? 'text-muted-foreground' : ''}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          {compactSet(performed)}
          {performed.set_type === 'warmup' && <sup className="ml-px text-[9px]">w</sup>}
          {performed.set_type === 'backoff' && <sup className="ml-px text-[9px]">b</sup>}
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

  return (
    <article
      data-testid={slot ? `slot-${slot.key}` : `extra-${exerciseId}`}
      aria-label={name}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 pt-2.5 pb-2"
    >
      <header className="flex items-start gap-2">
        <span className="num w-4 shrink-0 pt-px text-[12px] text-muted-foreground">
          {slot ? slot.position : '+'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-tight font-semibold tracking-tight">{name}</h3>
          {slot?.substituted && (
            <p className="text-[11px] text-plan">replaces {exerciseLabel(plannedExercise)}</p>
          )}
          {!slot && <p className="text-[11px] text-muted-foreground">Extra exercise</p>}
        </div>
        {slot && (
          <div className="flex shrink-0 gap-0.5">
            {slot.notes && (
              <button
                type="button"
                className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted"
                aria-label={`Notes, ${name}`}
                aria-expanded={panel === 'notes'}
                onClick={() => toggle('notes')}
              >
                ⓘ
              </button>
            )}
            {!locked && (
              <button
                type="button"
                className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted"
                aria-label={`Substitute, slot ${slot.position}`}
                aria-expanded={panel === 'swap'}
                onClick={() => toggle('swap')}
              >
                ⇄
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-0.5 pl-6">
        {plannedSets.length > 0 && (
          <p className="num text-[12px] text-plan" data-testid="target">
            <span className="text-muted-foreground">Target </span>
            {targetSummary(plannedSets)}
          </p>
        )}
        <LastLine performance={performance} />
      </div>

      {panel === 'notes' && slot?.notes && (
        <p className="ml-6 rounded-md bg-plan-surface px-2 py-1.5 text-[12px] leading-relaxed whitespace-pre-line text-plan">
          {slot.notes}
        </p>
      )}
      {panel === 'swap' && slot && substitutes && onSubstitute && (
        <label className="ml-6 flex items-center gap-2 text-[12px] text-muted-foreground">
          Performed as
          <select
            aria-label={`Exercise performed for slot ${slot.position}`}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-1.5 text-[13px] text-foreground"
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

      <div className="pl-6">
        {sharedWith !== null ? (
          <p className="text-[12px] text-muted-foreground">Sets are recorded under exercise {sharedWith} above.</p>
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
