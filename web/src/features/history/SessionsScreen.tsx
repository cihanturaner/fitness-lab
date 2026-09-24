import { useEffect, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { Week, WorkoutSummary } from '@/api/types'
import { ChevronRight, ListChecks } from 'lucide-react'
import { EmptyState, LoadError, PageHeader, Skeleton, StatusDot } from '@/components/app/primitives'
import { daysBetween, formatShortDate, localDate, mondayOf } from '@/lib/format'
import { workoutHref } from '@/lib/route'
import { HistoryTabs } from './HistoryScreen'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

/** Every recorded session, newest first: where drafts are resumed and records corrected. */
export function SessionsScreen() {
  const [recent, setRecent] = useState<WorkoutSummary[] | null>(null)
  const [week, setWeek] = useState<Week | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const today = localDate()
    Promise.all([api.recentWorkouts(), api.week(today, today)]).then(
      ([workouts, current]) => {
        if (!live) return
        setRecent(workouts)
        setWeek(current)
      },
      (failure: unknown) => live && setError(message(failure)),
    )
    return () => {
      live = false
    }
  }, [])

  const start = week?.block?.start_on ?? null
  /** Block week of a date (the active block): "Pre" before the start, "Post" after the last week. */
  const weekLabel = (performedOn: string): string => {
    if (!start) return ''
    if (performedOn < start) return 'Pre'
    const number = Math.floor(daysBetween(mondayOf(start), performedOn) / 7) + 1
    const weeks = week?.block?.weeks ?? null
    return weeks !== null && number > weeks ? 'Post' : String(number)
  }

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
                {start && <th className="w-14 py-2.5 pl-5 font-medium">Wk</th>}
                <th className={`py-2.5 font-medium ${start ? '' : 'pl-5'}`}>Date</th>
                <th className="py-2.5 pr-4 font-medium">Session</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 pr-4 text-right font-medium">Working sets · recorded / planned</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {recent.map((workout) => (
                <tr key={workout.id} data-testid="recent-workout" className="border-b border-border last:border-b-0 hover:bg-sunken/40">
                  {start && <td className="py-2.5 pl-5 text-muted-foreground">{weekLabel(workout.performed_on)}</td>}
                  <td className={`py-2.5 whitespace-nowrap ${start ? '' : 'pl-5'}`}>
                    {formatShortDate(workout.performed_on)}
                    {workout.performed_time_local && (
                      <span className="text-muted-foreground"> {workout.performed_time_local}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{workout.origin_name ?? 'Unplanned'}</td>
                  <td className="py-2.5 pr-4">
                    {workout.status === 'complete' ? <StatusDot tone="ok">Complete</StatusDot> : <StatusDot tone="warn">Draft</StatusDot>}
                  </td>
                  <td data-testid="session-work-sets" className="py-2.5 pr-4 text-right">
                    {workout.work_set_count}
                    {workout.planned_work_sets !== null && (
                      <span className={workout.work_set_count < workout.planned_work_sets ? 'text-foreground' : 'text-muted-foreground'}>
                        {' '}
                        / {workout.planned_work_sets}
                        {workout.status === 'complete' && workout.work_set_count < workout.planned_work_sets && (
                          <span className="ml-1.5 text-[12px] text-muted-foreground">shortened</span>
                        )}
                      </span>
                    )}
                  </td>
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
      <p className="t-micro">
        Program rules (progression, deload, week-12 benchmark) are in{' '}
        <a href="#/settings" className="font-medium text-foreground underline">
          Settings
        </a>
        .
      </p>
    </div>
  )
}
