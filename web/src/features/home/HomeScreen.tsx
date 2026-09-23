import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { ActiveProgram, PlannedWorkoutSummary, WorkoutSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { formatDate, localDate } from '@/lib/format'
import { navigate, workoutHref } from '@/lib/route'

type Loaded = { program: ActiveProgram; recent: WorkoutSummary[] }

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

function PlannedSession({
  planned,
  busy,
  onOpen,
}: {
  planned: PlannedWorkoutSummary
  busy: boolean
  onOpen: (planned: PlannedWorkoutSummary) => void
}) {
  const hasDraft = planned.open_draft_id !== null
  return (
    <li
      data-testid={`planned-${planned.workout_key}`}
      className="flex flex-col gap-4 rounded-md border border-dashed border-plan-rule bg-plan-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">{planned.name}</h3>
        {planned.day_label && <span className="text-sm text-plan">{planned.day_label}</span>}
      </div>
      <p className="num text-sm text-muted-foreground">
        {planned.slot_count} exercises, {planned.set_count} planned sets
      </p>
      <p className="num text-sm text-muted-foreground">
        {planned.completed_count === 0
          ? 'Not performed yet'
          : `Performed ${planned.completed_count}×, last on ${formatDate(planned.last_completed_on ?? '')}`}
      </p>
      {planned.open_draft_performed_on && (
        <p className="num text-sm text-warn">
          Open draft dated {formatDate(planned.open_draft_performed_on)}
          {planned.open_draft_performed_on === localDate() ? ' (today)' : ''}. Resuming continues
          that record.
        </p>
      )}
      <div className="mt-auto">
        <Button
          variant={hasDraft ? 'default' : 'outline'}
          isDisabled={busy}
          onPress={() => onOpen(planned)}
          aria-label={`${hasDraft ? 'Resume draft of' : 'Start'} ${planned.name}`}
        >
          {hasDraft ? 'Resume draft' : 'Start session'}
        </Button>
      </div>
    </li>
  )
}

function RecentWorkouts({ recent }: { recent: WorkoutSummary[] }) {
  if (recent.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing recorded yet. Start a planned session above, or an unplanned one.
      </p>
    )
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr className="border-b border-border">
          <th className="py-2 pr-4 font-medium">Date</th>
          <th className="py-2 pr-4 font-medium">Session</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 text-right font-medium">Sets</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {recent.map((workout) => (
          <tr key={workout.id} data-testid="recent-workout" className="border-b border-border/70">
            <td className="num py-2 pr-4">
              {formatDate(workout.performed_on)}
              {workout.performed_time_local && (
                <span className="text-muted-foreground"> {workout.performed_time_local}</span>
              )}
            </td>
            <td className="py-2 pr-4">{workout.origin_name ?? 'Unplanned'}</td>
            <td className="py-2 pr-4">
              {workout.status === 'complete' ? 'Complete' : <span className="text-warn">Draft</span>}
            </td>
            <td className="num py-2 pr-4 text-right">{workout.set_count}</td>
            <td className="py-2 text-right">
              <a className="text-plan underline-offset-4 hover:underline" href={workoutHref(workout.id)}>
                {workout.status === 'complete' ? 'View' : 'Continue'}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function HomeScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    Promise.all([api.activeProgram(), api.recentWorkouts()]).then(
      ([program, recent]) => setLoaded({ program, recent }),
      (failure: unknown) => setError(message(failure)),
    )
  }, [])

  useEffect(load, [load])

  const open = async (planned: PlannedWorkoutSummary) => {
    setBusy(true)
    try {
      const result = await api.openPlanned(planned.id, localDate())
      navigate(workoutHref(result.workout_id))
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }

  const startUnplanned = async () => {
    setBusy(true)
    try {
      const workout = await api.createWorkout(localDate())
      navigate(workoutHref(workout.id))
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }

  if (!loaded) {
    return error ? (
      <p role="alert" className="text-destructive">
        Could not load the program: {error}
      </p>
    ) : (
      <p className="text-muted-foreground">Loading the program…</p>
    )
  }

  const { program, recent } = loaded
  const version = program.version

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex max-w-3xl flex-col gap-1">
            {version ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">{version.name}</h1>
                <p className="num text-sm text-muted-foreground">
                  Version {version.version_label ?? 'unlabelled'}
                  {version.duration_weeks ? `, a ${version.duration_weeks}-week block` : ''}. The
                  sessions below repeat each week; opening one starts an empty record.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">No active program</h1>
                <p className="text-sm text-muted-foreground">
                  Import and activate a program with the fitness-lab command-line tool. Unplanned
                  sessions can still be recorded.
                </p>
              </>
            )}
          </div>
          <Button variant="outline" isDisabled={busy} onPress={() => void startUnplanned()}>
            Start unplanned session
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {program.planned_workouts.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Planned sessions">
            {program.planned_workouts.map((planned) => (
              <PlannedSession
                key={planned.id}
                planned={planned}
                busy={busy}
                onOpen={(item) => void open(item)}
              />
            ))}
          </ul>
        )}
        {program.notes_text && (
          <details className="max-w-4xl text-sm">
            <summary className="cursor-pointer text-plan">Program guidance</summary>
            <pre className="mt-3 max-h-[28rem] overflow-auto rounded-md border border-dashed border-plan-rule bg-plan-surface p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {program.notes_text}
            </pre>
          </details>
        )}
      </section>

      <section className="flex max-w-4xl flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent sessions</h2>
        <RecentWorkouts recent={recent} />
      </section>
    </div>
  )
}
