import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type {
  CompletionIssue,
  Entry,
  Exercise,
  LastPerformance,
  PerformedSet,
  PlannedSet,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  describeSet,
  exerciseLabel,
  formatDate,
  formatReps,
  formatRir,
  setTypeLabel,
} from '@/lib/format'
import { navigate } from '@/lib/route'
import { ActualSets, type SetActions } from './ActualSets'
import { CommitInput } from './fields'
import { buildEntryView, type SlotView } from './model'

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

function PlannedSets({ sets }: { sets: PlannedSet[] }) {
  const hasLoad = sets.some((planned) => planned.target_load_kg !== null)
  return (
    <table className="w-full text-sm" aria-label="Planned sets">
      <thead className="text-left text-xs text-plan/80">
        <tr>
          <th className="pb-1 font-medium">Set</th>
          <th className="pb-1 font-medium">Type</th>
          <th className="pb-1 text-right font-medium">Reps</th>
          <th className="pb-1 text-right font-medium">RIR</th>
          {hasLoad && <th className="pb-1 text-right font-medium">Load kg</th>}
        </tr>
      </thead>
      <tbody className="num">
        {sets.map((planned) => (
          <tr key={planned.id} className="border-t border-dashed border-plan-rule/70">
            <td className="py-1 text-plan">{planned.position}</td>
            <td className="py-1">{setTypeLabel(planned.set_type)}</td>
            <td className="py-1 text-right">{formatReps(planned.reps_min, planned.reps_max)}</td>
            <td className="py-1 text-right">
              {formatRir(planned.target_rir_min, planned.target_rir_max) ?? 'none set'}
            </td>
            {hasLoad && <td className="py-1 text-right">{planned.target_load_kg ?? ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LastTime({ performance }: { performance: LastPerformance | null | undefined }) {
  if (performance === undefined) return null
  if (performance === null) {
    return <p className="text-sm text-muted-foreground">No completed session with this exercise yet.</p>
  }
  return (
    <div className="text-sm" data-testid="last-performance">
      <p className="text-muted-foreground">
        Last time, {formatDate(performance.performed_on)}
        {performance.performed_time_local ? ` ${performance.performed_time_local}` : ''}:
      </p>
      <ol className="num mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {performance.sets.map((performed) => (
          <li key={performed.id} className={performed.set_type === 'warmup' ? 'text-muted-foreground' : ''}>
            {describeSet(performed)}
            {performed.set_type !== 'working' && (
              <span className="text-muted-foreground"> ({setTypeLabel(performed.set_type).toLowerCase()})</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function ExerciseSelect({
  label,
  exercises,
  value,
  onChange,
  disabled,
  placeholder,
  plannedId,
}: {
  label: string
  exercises: Exercise[]
  value: string
  onChange: (exerciseId: string) => void
  disabled?: boolean
  placeholder?: string
  plannedId?: string
}) {
  const planned = plannedId ? exercises.find((exercise) => exercise.id === plannedId) : undefined
  return (
    <select
      aria-label={label}
      className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
      value={value}
      disabled={disabled}
      onChange={(event) => event.target.value && onChange(event.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {planned && <option value={planned.id}>{exerciseLabel(planned)} (as planned)</option>}
      {exercises
        .filter((exercise) => exercise.id !== plannedId)
        .map((exercise) => (
          <option key={exercise.id} value={exercise.id}>
            {exerciseLabel(exercise)}
          </option>
        ))}
    </select>
  )
}

function NewExerciseForm({ onCreate }: { onCreate: (name: string, label: string | null) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [equipment, setEquipment] = useState('')

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onPress={() => setOpen(true)}>
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
        void onCreate(name.trim(), equipment.trim() === '' ? null : equipment.trim()).then(() => {
          setName('')
          setEquipment('')
          setOpen(false)
        })
      }}
    >
      <input
        aria-label="New exercise name"
        placeholder="Exercise name"
        className="h-8 rounded-md border border-input bg-card px-2 text-sm"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label="New exercise equipment"
        placeholder="Machine or equipment (optional)"
        className="h-8 w-64 rounded-md border border-input bg-card px-2 text-sm"
        value={equipment}
        onChange={(event) => setEquipment(event.target.value)}
      />
      <Button size="sm" type="submit">
        Create exercise
      </Button>
      <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}

function SlotCard({
  view,
  entry,
  exercises,
  locked,
  actions,
  onSubstitute,
}: {
  view: SlotView
  entry: Entry
  exercises: Exercise[]
  locked: boolean
  actions: SetActions
  onSubstitute: (slotId: string, exerciseId: string) => void
}) {
  const { slot } = view
  const planned = entry.exercises[slot.exercise_id]
  const effective = entry.exercises[slot.effective_exercise_id]
  const substituted = slot.substitute_exercise_id !== null
  // Retired exercises are never offered, but the slot's own planned and current exercise
  // always are, so a retired one can still be displayed truthfully and cleared.
  const selectable = exercises.filter(
    (exercise) =>
      exercise.is_active ||
      exercise.id === slot.effective_exercise_id ||
      exercise.id === slot.exercise_id,
  )

  return (
    <article
      data-testid={`slot-${slot.slot_key}`}
      className="grid gap-0 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <section
        aria-label={`Planned, ${exerciseLabel(planned)}`}
        className="flex flex-col gap-3 border-b border-dashed border-plan-rule bg-plan-surface p-4 lg:border-r lg:border-b-0"
      >
        <header className="flex items-baseline gap-3">
          <span className="num text-sm text-plan">{slot.position}</span>
          <div className="flex flex-col">
            <span className="text-xs text-plan">Planned</span>
            <h3 className="font-semibold tracking-tight">{exerciseLabel(planned)}</h3>
          </div>
        </header>
        <PlannedSets sets={slot.sets} />
        {slot.notes && <p className="text-xs leading-relaxed whitespace-pre-line text-plan/90">{slot.notes}</p>}
      </section>

      <section aria-label={`Actual, ${exerciseLabel(effective)}`} className="flex flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {substituted ? 'Actual, substituted for the whole slot' : 'Actual'}
            </span>
            <h3 className="font-semibold tracking-tight">{exerciseLabel(effective)}</h3>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Performed as
            <ExerciseSelect
              label={`Exercise performed for slot ${slot.position}`}
              exercises={selectable}
              value={slot.effective_exercise_id}
              plannedId={slot.exercise_id}
              disabled={locked}
              onChange={(exerciseId) => onSubstitute(slot.id, exerciseId)}
            />
          </label>
        </header>
        <LastTime performance={entry.last_performance[slot.effective_exercise_id]} />
        {view.sharedWith !== null ? (
          <p className="text-sm text-muted-foreground">
            Sets of this exercise are recorded under exercise {view.sharedWith} above.
          </p>
        ) : (
          <ActualSets
            exerciseId={slot.effective_exercise_id}
            exerciseName={exerciseLabel(effective)}
            sets={view.sets}
            allSets={entry.sets}
            planned={slot.sets}
            locked={locked}
            actions={actions}
          />
        )}
      </section>
    </article>
  )
}

function ExtraCard({
  exerciseId,
  sets,
  entry,
  exercises,
  locked,
  actions,
}: {
  exerciseId: string
  sets: PerformedSet[]
  entry: Entry
  exercises: Exercise[]
  locked: boolean
  actions: SetActions
}) {
  const exercise = entry.exercises[exerciseId] ?? exercises.find((item) => item.id === exerciseId)
  return (
    <article
      data-testid={`extra-${exerciseId}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <header className="flex flex-col">
        <span className="text-xs text-muted-foreground">Actual, not in the plan</span>
        <h3 className="font-semibold tracking-tight">{exerciseLabel(exercise)}</h3>
      </header>
      <LastTime performance={entry.last_performance[exerciseId]} />
      <ActualSets
        exerciseId={exerciseId}
        exerciseName={exerciseLabel(exercise)}
        sets={sets}
        allSets={entry.sets}
        planned={[]}
        locked={locked}
        actions={actions}
        startOpen={sets.length === 0}
      />
    </article>
  )
}

function CompletionFeedback({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  if (feedback.kind === 'completed') {
    return (
      <div role="status" className="rounded-md border border-ok/40 bg-card p-3 text-sm">
        <p className="font-medium text-ok">Workout completed and saved as evidence.</p>
        {feedback.advisories.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {feedback.advisories.map((issue) => (
              <li key={issue.rule}>{issue.message}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-card p-3 text-sm">
      <p className="font-medium text-destructive">{feedback.message}</p>
      {feedback.blockers.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {feedback.blockers.map((issue) => (
            <li key={issue.rule}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function EntryScreen({ workoutId }: { workoutId: string }) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const [pendingExtras, setPendingExtras] = useState<string[]>([])
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

  /** Every change is persisted immediately, then the screen re-reads the server's truth. */
  const run = useCallback(
    async (change: () => Promise<unknown>): Promise<boolean> => {
      setSaving(true)
      const pending = change()
      inFlight.current.add(pending)
      try {
        await pending
        setFeedback((current) => (current?.kind === 'error' ? null : current))
        return true
      } catch (error) {
        setFeedback(errorFeedback(error))
        return false
      } finally {
        inFlight.current.delete(pending)
        await reload()
        setSaving(false)
      }
    },
    [reload],
  )

  if (!entry) {
    return loadError ? (
      <div role="alert" className="flex flex-col gap-3">
        <p className="text-destructive">This workout could not be loaded: {loadError}</p>
        <a href="#/" className="text-plan underline-offset-4 hover:underline">
          Back to the program
        </a>
      </div>
    ) : (
      <p className="text-muted-foreground">Loading the workout…</p>
    )
  }

  const { workout, origin } = entry
  const locked = workout.status === 'complete'
  const view = buildEntryView(entry, pendingExtras)
  const shownExercises = new Set([
    ...view.slots.map((slot) => slot.slot.effective_exercise_id),
    ...view.extras.map((extra) => extra.exerciseId),
  ])
  const addable = exercises.filter((exercise) => exercise.is_active && !shownExercises.has(exercise.id))

  const actions: SetActions = {
    add: (exerciseId, fields) => run(() => api.addSet(workout.id, { ...fields, exercise_id: exerciseId })),
    patch: (setId, fields) => void run(() => api.patchSet(setId, fields)),
    remove: (setId) => void run(() => api.deleteSet(setId)),
    reorder: (setIds) => void run(() => api.reorderSets(workout.id, setIds)),
  }

  const complete = async () => {
    if (completing.current) return
    completing.current = true
    setSaving(true)
    // A field edited just before the click is saved on blur; finish those saves first so
    // the completion judges exactly what the lifter entered.
    await Promise.allSettled([...inFlight.current])
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
    const ok = await run(() => api.discardWorkout(workout.id))
    if (ok) navigate('#/')
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5">
        <a href="#/" className="text-sm text-muted-foreground hover:text-foreground">
          Program
        </a>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {origin ? origin.planned_workout_name : 'Unplanned session'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {origin
                ? `${origin.program_name}${origin.version_label ? `, version ${origin.version_label}` : ''}${origin.day_label ? `. Planned for ${origin.day_label}.` : '.'}`
                : 'Not part of a program. Every exercise below is actual work.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              data-testid="workout-status"
              className={`rounded-md border px-2 py-1 text-sm ${locked ? 'border-ok/40 text-ok' : 'border-warn/40 text-warn'}`}
            >
              {locked ? 'Complete' : 'Draft'}
            </span>
            {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
            {locked ? (
              <Button variant="outline" isDisabled={saving} onPress={() => void run(() => api.reopen(workout.id)).then(() => setFeedback(null))}>
                Reopen to correct
              </Button>
            ) : (
              <>
                <Button variant="ghost" className="text-destructive" isDisabled={saving} onPress={() => void discard()}>
                  {entry.sets.length === 0 ? 'Discard draft' : 'Delete workout…'}
                </Button>
                <Button onPress={() => void complete()}>
                  Complete workout
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Date performed
            <CommitInput
              type="date"
              label="Date performed"
              value={workout.performed_on}
              align="left"
              className="w-40"
              disabled={locked}
              isValid={(text) => /^\d{4}-\d{2}-\d{2}$/.test(text)}
              onCommit={(text) => void run(() => api.patchWorkout(workout.id, { performed_on: text }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Start time
            <CommitInput
              type="time"
              label="Start time"
              value={workout.performed_time_local ?? ''}
              align="left"
              className="w-32"
              disabled={locked}
              onCommit={(text) =>
                void run(() => api.patchWorkout(workout.id, { performed_time_local: text === '' ? null : text }))
              }
            />
          </label>
          <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Session notes
            <CommitInput
              label="Session notes"
              value={workout.notes ?? ''}
              align="left"
              disabled={locked}
              placeholder="Sleep, readiness, pain, gym — anything that explains the numbers"
              onCommit={(text) => void run(() => api.patchWorkout(workout.id, { notes: text.trim() === '' ? null : text }))}
            />
          </label>
        </div>
        {locked && (
          <p className="text-sm text-muted-foreground">
            This record is complete. Reopen it to correct sets, substitutions or details.
          </p>
        )}
        <CompletionFeedback feedback={feedback} />
      </header>

      {view.slots.length > 0 && (
        <section aria-label="Planned exercises" className="flex flex-col gap-4">
          {view.slots.map((slotView) => (
            <SlotCard
              key={slotView.slot.id}
              view={slotView}
              entry={entry}
              exercises={exercises}
              locked={locked}
              actions={actions}
              onSubstitute={(slotId, exerciseId) =>
                void run(() => api.setSlotExercise(workout.id, slotId, exerciseId))
              }
            />
          ))}
        </section>
      )}

      <section aria-label="Extra exercises" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {origin ? 'Extra exercises' : 'Exercises'}
        </h2>
        {view.extras.map((extra) => (
          <ExtraCard
            key={extra.exerciseId}
            exerciseId={extra.exerciseId}
            sets={extra.sets}
            entry={entry}
            exercises={exercises}
            locked={locked}
            actions={actions}
          />
        ))}
        {!locked && (
          <div className="flex flex-wrap items-center gap-3">
            <ExerciseSelect
              label="Add an exercise"
              exercises={addable}
              value=""
              placeholder="Add an exercise…"
              onChange={(exerciseId) => setPendingExtras((current) => [...current, exerciseId])}
            />
            <NewExerciseForm
              onCreate={async (name, equipment) => {
                const ok = await run(async () => {
                  const created = await api.createExercise(name, equipment)
                  setPendingExtras((current) => [...current, created.id])
                })
                if (ok) await reloadExercises()
              }}
            />
          </div>
        )}
        {locked && view.extras.length === 0 && (
          <p className="text-sm text-muted-foreground">No extra exercises were recorded.</p>
        )}
      </section>
    </div>
  )
}
