import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Dumbbell, Plus, SlidersHorizontal } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { CompletionIssue, Entry, Exercise } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Callout, EmptyState, LoadError, Skeleton } from '@/components/app/primitives'
import { exerciseLabel, formatDate, localDate } from '@/lib/format'
import { navigate } from '@/lib/route'
import { installUnloadGuard, unsavedDescriptions } from '@/lib/unsaved'
import { ExerciseBlock } from './ExerciseBlock'
import { CommitInput } from './fields'
import { buildEntryView } from './model'
import type { SetActions } from './SetGrid'

type Feedback =
  | { kind: 'error'; message: string; blockers: CompletionIssue[] }
  | { kind: 'completed'; advisories: CompletionIssue[] }
  | null

function errorFeedback(error: unknown): Feedback {
  if (error instanceof ApiError) {
    return { kind: 'error', message: error.message, blockers: error.blockers }
  }
  return { kind: 'error', message: error instanceof Error ? error.message : String(error), blockers: [] }
}

function ExerciseSelect({
  label,
  exercises,
  onChange,
}: {
  label: string
  exercises: Exercise[]
  onChange: (exerciseId: string) => void
}) {
  return (
    <select
      aria-label={label}
      className="h-9 min-w-64 rounded-md border border-input bg-card px-2.5 text-[14px] outline-none hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      value=""
      onChange={(event) => event.target.value && onChange(event.target.value)}
    >
      <option value="">Add an exercise…</option>
      {exercises.map((exercise) => (
        <option key={exercise.id} value={exercise.id}>
          {exerciseLabel(exercise)}
        </option>
      ))}
    </select>
  )
}

function NewExerciseForm({
  onCreate,
}: {
  onCreate: (name: string, label: string | null) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [equipment, setEquipment] = useState('')

  if (!open) {
    return (
      <Button variant="ghost" className="h-9 gap-1.5 text-muted-foreground" onPress={() => setOpen(true)}>
        <Plus aria-hidden />
        New exercise…
      </Button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim()) return
        void onCreate(name.trim(), equipment.trim() === '' ? null : equipment.trim()).then((created) => {
          if (!created) return // keep what was typed; the reason is shown above
          setName('')
          setEquipment('')
          setOpen(false)
        })
      }}
    >
      <input
        aria-label="New exercise name"
        placeholder="Exercise name"
        className="h-9 rounded-md border border-input bg-card px-2.5 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label="New exercise equipment"
        placeholder="Machine or equipment (optional)"
        className="h-9 w-64 rounded-md border border-input bg-card px-2.5 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        value={equipment}
        onChange={(event) => setEquipment(event.target.value)}
      />
      <Button type="submit" className="h-9">
        Create exercise
      </Button>
      <Button variant="ghost" className="h-9" onPress={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}

const ISSUE_LABELS: Record<string, string> = {
  C2: 'Missing reps',
  C4: 'Missing set type',
  'A-LOAD': 'No load recorded',
  'A-RIR': 'No RIR recorded',
}

/**
 * Completion rules name sets by their position in the whole session; the screen numbers
 * them per exercise. Translate, e.g. order 3 -> "Smith Flat Bench Press set 2".
 */
function describeIssue(issue: CompletionIssue, entry: Entry): string {
  const label = ISSUE_LABELS[issue.rule]
  if (!label || issue.set_orders.length === 0) return issue.message
  const ordered = [...entry.sets].sort((a, b) => a.set_order - b.set_order)
  const names = issue.set_orders.map((order) => {
    const target = ordered[order - 1]
    if (!target) return `set ${order}`
    const index = ordered.filter(
      (other) => other.exercise_id === target.exercise_id && other.set_order <= target.set_order,
    ).length
    return `${exerciseLabel(entry.exercises[target.exercise_id])} set ${index}`
  })
  return `${label}: ${names.join(', ')}`
}

function CompletionFeedback({ feedback, entry }: { feedback: Feedback; entry: Entry }) {
  if (!feedback) return null
  if (feedback.kind === 'completed') {
    return (
      <Callout tone="ok" role="status" title="Workout completed and saved as evidence.">
        {feedback.advisories.length > 0 && (
          <ul className="list-disc pl-4 text-muted-foreground">
            {feedback.advisories.map((issue) => (
              <li key={issue.rule}>{describeIssue(issue, entry)}</li>
            ))}
          </ul>
        )}
      </Callout>
    )
  }
  return (
    <Callout tone="error" role="alert" title={feedback.message}>
      {feedback.blockers.length > 0 && (
        <ul className="list-disc pl-4">
          {feedback.blockers.map((issue) => (
            <li key={issue.rule}>{describeIssue(issue, entry)}</li>
          ))}
        </ul>
      )}
    </Callout>
  )
}

export function EntryScreen({ workoutId }: { workoutId: string }) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const [pendingExtras, setPendingExtras] = useState<string[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const inFlight = useRef(new Set<Promise<unknown>>())
  const completing = useRef(false)

  const reload = useCallback(async () => {
    try {
      setEntry(await api.entry(workoutId))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [workoutId])

  const reloadExercises = useCallback(async () => {
    setExercises(await api.exercises())
  }, [])

  useEffect(() => {
    let live = true
    api.entry(workoutId).then(
      (loaded) => live && setEntry(loaded),
      (error: unknown) => live && setLoadError(error instanceof Error ? error.message : String(error)),
    )
    api.exercises().then(
      (list) => live && setExercises(list),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [workoutId])

  useEffect(installUnloadGuard, [])

  /**
   * Every change is persisted immediately, then the screen re-reads the server's truth.
   * The whole task (save and re-read) is tracked, so Complete waits for it and for the
   * field that started it to settle.
   */
  const run = useCallback(
    (change: () => Promise<unknown>): Promise<boolean> => {
      const task = (async () => {
        setSaving(true)
        try {
          await change()
          setFeedback((current) => (current?.kind === 'error' ? null : current))
          return true
        } catch (error) {
          setFeedback(errorFeedback(error))
          return false
        } finally {
          await reload()
          setSaving(false)
        }
      })()
      inFlight.current.add(task)
      void task.finally(() => inFlight.current.delete(task))
      return task
    },
    [reload],
  )

  if (!entry) {
    return loadError ? (
      <div className="flex flex-col items-center gap-2">
        <LoadError what="this workout" detail={loadError} />
        <a href="#/" className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Back to the week
        </a>
      </div>
    ) : (
      <Skeleton label="Loading the workout…" blocks={['h-10 w-96', 'h-[32rem]']} />
    )
  }

  const { workout, origin } = entry
  const locked = workout.status === 'complete'
  const today = localDate()
  const view = buildEntryView(entry, pendingExtras)
  const shownExercises = new Set([
    ...view.slots.map((slot) => slot.slot.effective_exercise_id),
    ...view.extras.map((extra) => extra.exerciseId),
  ])
  const addable = exercises.filter((exercise) => exercise.is_active && !shownExercises.has(exercise.id))

  const actions: SetActions = {
    add: (exerciseId, fields) => run(() => api.addSet(workout.id, { ...fields, exercise_id: exerciseId })),
    patch: (setId, fields) => run(() => api.patchSet(setId, fields)),
    remove: (setId) => void run(() => api.deleteSet(setId)),
    reorder: (setIds) => void run(() => api.reorderSets(workout.id, setIds)),
  }

  const complete = async () => {
    if (completing.current) return
    completing.current = true
    setSaving(true)
    // A row or field left just before the click is saved on blur; finish those saves first
    // so the completion judges exactly what the lifter entered.
    await Promise.allSettled([...inFlight.current])
    const unsaved = unsavedDescriptions()
    if (unsaved.length > 0) {
      setFeedback({
        kind: 'error',
        message: `Not completed: there is unsaved input (${unsaved.join('; ')}). Save it, or clear it, first.`,
        blockers: [],
      })
      setSaving(false)
      completing.current = false
      return
    }
    try {
      const result = await api.complete(workout.id)
      setFeedback({ kind: 'completed', advisories: result.advisories })
    } catch (error) {
      setFeedback(errorFeedback(error))
    } finally {
      await reload()
      setSaving(false)
      completing.current = false
    }
  }

  const discard = async () => {
    const question =
      entry.sets.length === 0
        ? 'Discard this empty draft?'
        : `Delete this workout and its ${entry.sets.length} recorded sets? A safety snapshot of the database is kept.`
    if (!window.confirm(question)) return
    setSaving(true)
    try {
      await api.discardWorkout(workout.id)
    } catch (error) {
      setFeedback(errorFeedback(error))
      await reload()
      setSaving(false)
      return
    }
    // Gone: leave without re-reading it (that would only answer 404).
    navigate('#/')
  }

  const setCount = entry.sets.length
  const selectable = (slotExerciseId: string, effectiveId: string) =>
    exercises.filter(
      (exercise) => exercise.is_active || exercise.id === effectiveId || exercise.id === slotExerciseId,
    )

  const plannedTotal = view.slots.reduce((total, { slot, sharedWith }) => total + (sharedWith === null ? slot.sets.length : 0), 0)
  const workedTotal = entry.sets.filter((performed) => performed.set_type !== 'warmup').length

  return (
    <div className="flex flex-col gap-5">
      <header className="sticky top-0 z-10 -mx-10 -mt-8 flex flex-col gap-3 border-b border-border bg-background/90 px-10 pt-5 pb-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href="#/"
            aria-label="Back to the week"
            className="-ml-2 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sunken hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </a>
          <h1 className="t-title">{origin ? origin.planned_workout_name : 'Unplanned session'}</h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
              locked ? 'bg-ok-surface text-ok' : 'bg-warn-surface text-warn'
            }`}
          >
            {locked ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : <span className="size-1.5 rounded-full bg-warn" aria-hidden />}
            <span data-testid="workout-status">{locked ? 'Complete' : 'Draft'}</span>
          </span>
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="sr-only">Date performed</span>
            <CommitInput
              type="date"
              label="Date performed"
              value={workout.performed_on}
              align="left"
              dense
              className="w-[9.5rem]"
              disabled={locked}
              isValid={(text) => /^\d{4}-\d{2}-\d{2}$/.test(text)}
              invalidHint="a date"
              onCommit={(text) => run(() => api.patchWorkout(workout.id, { performed_on: text }))}
            />
          </label>
          <span className="num flex items-center gap-2 text-[13px] text-muted-foreground">
            {plannedTotal > 0 ? (
              <>
                <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${workedTotal >= plannedTotal ? 'bg-ok' : 'bg-plan'}`}
                    style={{ width: `${Math.min(workedTotal / plannedTotal, 1) * 100}%` }}
                  />
                </span>
                <span>
                  <span className="font-medium text-foreground">{workedTotal}</span> of {plannedTotal} working sets
                  {setCount !== workedTotal && ` · ${setCount} total`}
                </span>
              </>
            ) : (
              <>
                {setCount} {setCount === 1 ? 'set' : 'sets'} recorded
              </>
            )}
          </span>
          <span className="w-16 text-[12px] text-muted-foreground" aria-live="polite">
            {saving ? 'Saving…' : ''}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              className="h-9 gap-1.5 text-muted-foreground"
              aria-label="Details"
              aria-expanded={detailsOpen}
              onPress={() => setDetailsOpen((open) => !open)}
            >
              <SlidersHorizontal aria-hidden />
              Details
            </Button>
            {locked ? (
              <Button
                variant="outline"
                className="h-9 border-border-strong bg-card px-4"
                isDisabled={saving}
                onPress={() => void run(() => api.reopen(workout.id)).then(() => setFeedback(null))}
              >
                Reopen to correct
              </Button>
            ) : (
              <Button className="h-9 px-4" onPress={() => void complete()}>
                Complete workout
              </Button>
            )}
          </div>
        </div>
        {detailsOpen && (
          <div className="flex animate-in flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4 text-[12px] text-muted-foreground fade-in slide-in-from-top-1 duration-150">
            {origin && (
              <p className="basis-full text-[13px]">
                {origin.program_name}
                {origin.version_label ? ` ${origin.version_label}` : ''}
                {origin.day_label ? ` · planned for ${origin.day_label}` : ''}
              </p>
            )}
            <label className="flex flex-col gap-1 font-medium">
              Start time
              <CommitInput
                type="time"
                label="Start time"
                value={workout.performed_time_local ?? ''}
                align="left"
                dense
                className="w-28"
                disabled={locked}
                onCommit={(text) =>
                  run(() => api.patchWorkout(workout.id, { performed_time_local: text === '' ? null : text }))
                }
              />
            </label>
            <label className="flex min-w-72 flex-1 flex-col gap-1 font-medium">
              Session notes
              <CommitInput
                label="Session notes"
                value={workout.notes ?? ''}
                align="left"
                dense
                disabled={locked}
                placeholder="Sleep, readiness, pain, gym — anything that explains the numbers"
                onCommit={(text) => run(() => api.patchWorkout(workout.id, { notes: text.trim() === '' ? null : text }))}
              />
            </label>
            {!locked && (
              <Button variant="ghost" className="h-8 text-destructive hover:bg-destructive/10" isDisabled={saving} onPress={() => void discard()}>
                {entry.sets.length === 0 ? 'Discard draft' : 'Delete workout…'}
              </Button>
            )}
          </div>
        )}
        {locked && (
          <p className="t-micro">Complete. Reopen it to correct sets, substitutions or details.</p>
        )}
        {!locked && workout.performed_on !== today && (
          <Callout tone="warn" role="status" testId="draft-date-notice" title={`This draft is dated ${formatDate(workout.performed_on)}, not today (${formatDate(today)}).`}>
            If you are training today, complete or delete this earlier record first, or correct its date.
          </Callout>
        )}
        <CompletionFeedback feedback={feedback} entry={entry} />
      </header>

      {view.slots.length === 0 && view.extras.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-border-strong bg-card/50">
          <EmptyState icon={Dumbbell} title={locked ? 'No exercises were recorded.' : 'No exercises yet.'}>
            {locked
              ? 'This session was completed without sets.'
              : 'Add the first exercise below; its sets are entered here, one row per set.'}
          </EmptyState>
        </div>
      )}
      <section
        hidden={view.slots.length === 0 && view.extras.length === 0}
        aria-label="Exercises"
        className="gap-x-12 rounded-[10px] border border-border bg-card px-7 pb-1 [column-rule:1px_solid_var(--border)] lg:columns-2 [&>article:last-child]:border-b-0"
      >
        {view.slots.map(({ slot, sets, sharedWith }) => (
          <ExerciseBlock
            // A new lock state starts the grid afresh (no pending rows on a complete record).
            key={`${slot.id}:${locked}`}
            exerciseId={slot.effective_exercise_id}
            exercise={entry.exercises[slot.effective_exercise_id]}
            plannedExercise={entry.exercises[slot.exercise_id]}
            slot={{
              id: slot.id,
              key: slot.slot_key,
              position: slot.position,
              plannedExerciseId: slot.exercise_id,
              notes: slot.notes,
              substituted: slot.substitute_exercise_id !== null,
            }}
            plannedSets={slot.sets}
            performance={entry.last_performance[slot.effective_exercise_id]}
            sets={sets}
            allSets={entry.sets}
            sharedWith={sharedWith}
            locked={locked}
            actions={actions}
            substitutes={selectable(slot.exercise_id, slot.effective_exercise_id)}
            onSubstitute={(exerciseId) => void run(() => api.setSlotExercise(workout.id, slot.id, exerciseId))}
          />
        ))}
        {view.extras.map((extra) => (
          <ExerciseBlock
            key={`${extra.exerciseId}:${locked}`}
            exerciseId={extra.exerciseId}
            exercise={entry.exercises[extra.exerciseId] ?? exercises.find((item) => item.id === extra.exerciseId)}
            plannedSets={[]}
            performance={entry.last_performance[extra.exerciseId]}
            sets={extra.sets}
            allSets={entry.sets}
            sharedWith={null}
            locked={locked}
            actions={actions}
          />
        ))}
      </section>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-micro mr-1 font-medium">Extra work</span>
          <ExerciseSelect
            label="Add an exercise"
            exercises={addable}
            onChange={(exerciseId) => setPendingExtras((current) => [...current, exerciseId])}
          />
          <NewExerciseForm
            onCreate={async (name, equipment) => {
              const ok = await run(async () => {
                const created = await api.createExercise(name, equipment)
                setPendingExtras((current) => [...current, created.id])
              })
              if (ok) await reloadExercises()
              return ok
            }}
          />
        </div>
      )}
    </div>
  )
}
