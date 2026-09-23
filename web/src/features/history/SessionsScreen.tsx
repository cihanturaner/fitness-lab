import { useEffect, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { ActiveProgram, WorkoutSummary } from '@/api/types'
import { formatShortDate } from '@/lib/format'
import { workoutHref } from '@/lib/route'
import { HistoryTabs } from './HistoryScreen'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

/** Every recorded session, newest first: where drafts are resumed and records corrected. */
export function SessionsScreen() {
  const [recent, setRecent] = useState<WorkoutSummary[] | null>(null)
  const [program, setProgram] = useState<ActiveProgram | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.recentWorkouts(), api.activeProgram()]).then(
      ([workouts, active]) => {
        if (!live) return
        setRecent(workouts)
        setProgram(active)
      },
      (failure: unknown) => live && setError(message(failure)),
    )
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <HistoryTabs current="sessions" />
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          Could not load sessions: {error}
        </p>
      )}
      {recent && recent.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing recorded yet.</p>}
      {recent && recent.length > 0 && (
        <table className="num w-full rounded-lg bg-card text-[13px]">
          <thead className="text-left text-[11px] tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Session</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 text-right font-medium">Sets</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.map((workout) => (
              <tr key={workout.id} data-testid="recent-workout" className="border-t border-border/70">
                <td className="px-3 py-1.5">
                  {formatShortDate(workout.performed_on)}
                  {workout.performed_time_local && (
                    <span className="text-muted-foreground"> {workout.performed_time_local}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">{workout.origin_name ?? 'Unplanned'}</td>
                <td className="py-1.5 pr-3">
                  {workout.status === 'complete' ? 'Complete' : <span className="text-warn">Draft</span>}
                </td>
                <td className="py-1.5 pr-3 text-right">{workout.set_count}</td>
                <td className="py-1.5 pr-3 text-right">
                  <a className="text-plan hover:underline" href={workoutHref(workout.id)}>
                    {workout.status === 'complete' ? 'View' : 'Continue'}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {program?.notes_text && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-plan">Program guidance</summary>
          <pre className="mt-2 max-h-[28rem] overflow-auto rounded-md border border-dashed border-plan-rule bg-plan-surface p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {program.notes_text}
          </pre>
        </details>
      )}
    </div>
  )
}
