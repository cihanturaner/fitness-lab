import { useState } from 'react'
import { ArrowLeftRight, Info } from 'lucide-react'
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
      <span className="text-muted-foreground">Last </span>
      {performance.sets.map((performed, index) => (
        <span key={performed.id} className={performed.set_type === 'warmup' ? 'text-muted-foreground' : 'font-medium'}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          {compactSet(performed)}
          {performed.set_type === 'warmup' && <sup className="ml-px text-[10px]">w</sup>}
          {performed.set_type === 'backoff' && <sup className="ml-px text-[10px]">b</sup>}
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
    'inline-flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-sunken ' +
    'hover:text-foreground aria-expanded:bg-sunken aria-expanded:text-foreground'

  return (
    <article
      data-testid={slot ? `slot-${slot.key}` : `extra-${exerciseId}`}
      aria-label={name}
      className="flex break-inside-avoid flex-col gap-1.5 border-b border-border pt-4 pb-3.5"
    >
      <header className="flex items-start gap-2">
        <span className="num w-6 shrink-0 pt-px text-[13px] font-medium text-faint">{slot ? slot.position : '+'}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-5 font-semibold tracking-[-0.01em]">{name}</h3>
          {slot?.substituted && <p className="text-[12px] text-plan">replaces {exerciseLabel(plannedExercise)}</p>}
          {!slot && <p className="text-[12px] text-muted-foreground">Extra exercise</p>}
        </div>
        {planned > 0 && sharedWith === null && (
          <span
            className={`num shrink-0 pt-0.5 text-[12px] font-medium ${worked >= planned ? 'text-ok' : 'text-muted-foreground'}`}
            title="Working sets saved of planned"
          >
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

      <div className="flex flex-col gap-0.5 pl-8">
        {plannedSets.length > 0 && (
          <p className="num text-[13px] leading-[18px] text-plan" data-testid="target">
            <span className="text-muted-foreground">Target </span>
            {targetSummary(plannedSets)}
          </p>
        )}
        <LastLine performance={performance} />
      </div>

      {panel === 'notes' && slot?.notes && (
        <p className="ml-8 animate-in rounded-md bg-plan-surface px-3 py-2 text-[13px] leading-relaxed whitespace-pre-line text-plan fade-in duration-150">
          {slot.notes}
        </p>
      )}
      {panel === 'swap' && slot && substitutes && onSubstitute && (
        <label className="ml-8 flex animate-in items-center gap-2 text-[13px] text-muted-foreground fade-in duration-150">
          Performed as
          <select
            aria-label={`Exercise performed for slot ${slot.position}`}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
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

      <div className="pl-1">
        {sharedWith !== null ? (
          <p className="pl-7 text-[13px] text-muted-foreground">Sets are recorded under exercise {sharedWith} above.</p>
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
