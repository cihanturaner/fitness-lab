import { useEffect, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { ActiveProgram, WorkoutSummary } from '@/api/types'
import { ChevronRight, ListChecks } from 'lucide-react'
import { EmptyState, LoadError, PageHeader, Skeleton, StatusDot } from '@/components/app/primitives'
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
    <div className="flex flex-col gap-8">
      <PageHeader title="History">
        <HistoryTabs current="sessions" />
      </PageHeader>
      {error && <LoadError what="sessions" detail={error} />}
      {!recent && !error && <Skeleton label="Loading sessions…" blocks={['h-72']} />}
      {recent && recent.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-border-strong bg-card/50 py-8">
          <EmptyState
            icon={ListChecks}
            title="Nothing recorded yet."
            action={
              <a href="#/" className="text-[13px] font-medium underline-offset-4 hover:underline">
                Go to this week
              </a>
            }
          >
            Every session you open — draft or complete — is listed here, newest first.
          </EmptyState>
        </div>
      )}
      {recent && recent.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          <table className="num w-full text-[14px]">
            <thead className="text-left text-[12px] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2.5 pl-5 font-medium">Date</th>
                <th className="py-2.5 pr-4 font-medium">Session</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 pr-4 text-right font-medium">Sets</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {recent.map((workout) => (
                <tr key={workout.id} data-testid="recent-workout" className="border-b border-border last:border-b-0 hover:bg-sunken/40">
                  <td className="py-2.5 pl-5 whitespace-nowrap">
                    {formatShortDate(workout.performed_on)}
                    {workout.performed_time_local && (
                      <span className="text-muted-foreground"> {workout.performed_time_local}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{workout.origin_name ?? 'Unplanned'}</td>
                  <td className="py-2.5 pr-4">
                    {workout.status === 'complete' ? <StatusDot tone="ok">Complete</StatusDot> : <StatusDot tone="warn">Draft</StatusDot>}
                  </td>
                  <td className="py-2.5 pr-4 text-right">{workout.set_count}</td>
                  <td className="py-2.5 pr-5 text-right">
                    <a
                      className="inline-flex items-center gap-0.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                      href={workoutHref(workout.id)}
                    >
                      {workout.status === 'complete' ? 'View' : 'Continue'}
                      <ChevronRight className="size-3.5" aria-hidden />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {program?.notes_text && (
        <details className="group text-[13px]">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Program guidance
          </summary>
          <pre className="mt-3 max-h-[28rem] overflow-auto rounded-[10px] border border-border bg-card p-5 font-sans text-[13px] leading-relaxed whitespace-pre-wrap">
            {program.notes_text}
          </pre>
        </details>
      )}
    </div>
  )
}
