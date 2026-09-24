import { useCallback, useEffect, useRef, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { DayWorkout, HistoryDay, HistoryKind, PerformedSet } from '@/api/types'
import { EmptyState, LoadError, PageHeader, Skeleton } from '@/components/app/primitives'
import { Button } from '@/components/ui/button'
import { exerciseLabel } from '@/lib/format'
import { EXERCISES_HREF, historyHref, workoutHref } from '@/lib/route'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

const KINDS: { kind: HistoryKind; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'training', label: 'Training' },
  { kind: 'bodyweight', label: 'Bodyweight' },
  { kind: 'nutrition', label: 'Nutrition' },
]

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** "THU 24 SEP": one date is one history unit. */
function dayLabel(isoDate: string): { weekday: string; date: string } {
  const [year, month, day] = isoDate.split('-').map(Number)
  const value = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
  return {
    weekday: WEEKDAYS[value.getDay()] ?? '',
    date: `${value.getDate()} ${MONTHS[value.getMonth()] ?? ''}`,
  }
}

/** "44 lb × 3 @ RIR 2" — every unit spelled out; an unrecorded RIR reads "—". */
function setText(performed: PerformedSet): string {
  const load = performed.load_lb === null ? '–' : `${performed.load_lb} lb`
  return `${load} × ${performed.reps ?? '?'} @ RIR ${performed.rir ?? '—'}`
}

function WorkoutBlock({ workout }: { workout: DayWorkout }) {
  const planned = workout.planned_work_sets
  return (
    <div data-testid="day-workout" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <a href={workoutHref(workout.workout_id)} className="text-[16px] font-semibold tracking-[-0.015em] hover:text-emerald-700 hover:underline">
          {workout.planned_workout_name ?? 'Unplanned session'}
        </a>
        {workout.shortened && (
          <span data-testid="day-shortened" className="rounded-full bg-warn-surface px-2 py-0.5 text-[12px] font-semibold text-warn">
            Shortened
          </span>
        )}
        <span className="num text-[13px] text-muted-foreground">
          {planned === null
            ? `${workout.actual_work_sets} working ${workout.actual_work_sets === 1 ? 'set' : 'sets'}`
            : `${workout.actual_work_sets} of ${planned} working sets`}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {/* One line per planned slot (or extra exercise): two slots performed as the same
            exercise stay two lines, each with its own planned exercise and sets. */}
        {workout.exercises.map((item, index) => (
          <li
            key={`${item.slot_id ?? `extra-${index}`}:${item.exercise.id}`}
            data-testid="day-exercise"
            className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-baseline gap-1.5">
                {item.planned_exercise && <span className="shrink-0 text-[12px] text-muted-foreground">Performed:{' '}</span>}
                <a
                  href={historyHref(item.exercise.id)}
                  className="truncate text-[14px] font-medium hover:text-emerald-700 hover:underline"
                  title="Exercise history"
                >
                  {exerciseLabel(item.exercise)}
                </a>
              </span>
              {item.planned_exercise && (
                <span data-testid="day-planned" className="text-[12px] text-plan">
                  Planned: {exerciseLabel(item.planned_exercise)}
                </span>
              )}
            </span>
            <span className="num text-[14px] text-foreground/85">
              {item.sets.map((performed, index) => (
                <span key={performed.id} className={performed.set_type === 'warmup' ? 'text-muted-foreground' : ''}>
                  {index > 0 && <span className="text-faint"> · </span>}
                  <span className="whitespace-nowrap">{setText(performed)}</span>
                  {performed.set_type === 'warmup' && <span className="text-[11px]"> warm-up</span>}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DayCard({ day }: { day: HistoryDay }) {
  const label = dayLabel(day.date)
  const nutrition = day.nutrition
  return (
    <article
      data-testid="history-day"
      aria-label={`${label.weekday} ${label.date}`}
      className="surface grid gap-x-8 gap-y-3 p-6 md:grid-cols-[6.5rem_minmax(0,1fr)]"
    >
      <h2 className="num flex flex-row items-baseline gap-2 md:flex-col md:gap-0.5">
        <span className="text-[12px] font-semibold tracking-[0.06em] text-emerald-700">{label.weekday}</span>
        <span className="text-[18px] leading-6 font-semibold tracking-[-0.02em]">{label.date}</span>
      </h2>
      <div className="flex min-w-0 flex-col gap-5">
        {day.workouts.map((workout) => (
          <WorkoutBlock key={workout.workout_id} workout={workout} />
        ))}
        {(day.bodyweight_kg !== null || nutrition !== null) && (
          <dl className={`num flex flex-wrap gap-x-10 gap-y-2 text-[14px] ${day.workouts.length > 0 ? 'border-t border-border pt-4' : ''}`}>
            {day.bodyweight_kg !== null && (
              <div data-testid="day-bodyweight" className="flex items-baseline gap-2">
                <dt className="text-[13px] text-muted-foreground">Bodyweight</dt>
                <dd className="font-semibold">{day.bodyweight_kg} kg</dd>
              </div>
            )}
            {nutrition !== null && (
              <div data-testid="day-nutrition" className="flex items-baseline gap-2">
                <dt className="text-[13px] text-muted-foreground">Nutrition</dt>
                <dd>
                  <span className="font-semibold">{nutrition.calories_kcal} kcal</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {nutrition.protein_g ?? '—'}P · {nutrition.carbs_g ?? '—'}C · {nutrition.fat_g ?? '—'}F
                  </span>
                  {!nutrition.calories_complete && <span className="ml-1 text-[12px] text-faint">partial</span>}
                  {nutrition.target && (
                    <span className="ml-2 text-[12px] text-muted-foreground">target {nutrition.target.calories_kcal}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  )
}

/** The default History: one card per date, newest first, holding only what was recorded. */
export function DayHistory() {
  const [kind, setKind] = useState<HistoryKind>('all')
  const [days, setDays] = useState<HistoryDay[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Only the latest request may write: a slow answer for an earlier filter is dropped.
  const latest = useRef(0)

  const load = useCallback((which: HistoryKind) => {
    const mine = ++latest.current
    api.historyDays(which).then(
      (page) => {
        if (mine !== latest.current) return
        setDays(page.days)
        setNext(page.next_before)
        setError(null)
      },
      (failure: unknown) => mine === latest.current && setError(message(failure)),
    )
  }, [])

  useEffect(() => {
    load(kind)
  }, [kind, load])

  const more = () => {
    if (!next) return
    setLoadingMore(true)
    const mine = ++latest.current
    api.historyDays(kind, next).then(
      (page) => {
        if (mine !== latest.current) return
        setDays((current) => [...(current ?? []), ...page.days])
        setNext(page.next_before)
        setLoadingMore(false)
      },
      (failure: unknown) => {
        setError(message(failure))
        setLoadingMore(false)
      },
    )
  }

  const empty =
    kind === 'all'
      ? 'Nothing recorded yet.'
      : `No ${kind === 'training' ? 'completed training' : kind} recorded yet.`

  return (
    <div className="enter flex flex-col gap-6">
      <PageHeader
        title="History"
        aside={
          <div role="group" aria-label="Show" className="flex gap-1 rounded-[12px] bg-card p-1 shadow-[var(--shadow-card)]">
            {KINDS.map((option) => (
              <button
                key={option.kind}
                type="button"
                aria-pressed={kind === option.kind}
                className={`press rounded-[9px] px-3.5 py-1 text-[13px] font-semibold ${
                  kind === option.kind ? 'bg-emerald-700 text-white' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => {
                  if (option.kind === kind) return
                  setDays(null)
                  setLoadingMore(false)
                  setKind(option.kind)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
        meta={
          <a
            href={EXERCISES_HREF}
            data-testid="exercise-history-link"
            className="font-medium text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline"
          >
            Exercise history →
          </a>
        }
      />
      {days === null ? (
        error ? (
          <LoadError what="history" detail={error} onRetry={() => load(kind)} />
        ) : (
          <Skeleton label="Loading history…" blocks={['h-40', 'h-28', 'h-28']} />
        )
      ) : days.length === 0 ? (
        <div className="surface py-8">
          <EmptyState icon={HistoryIcon} title={empty}>
            Each day with a completed workout, a weigh-in or a nutrition log appears here, newest first.
          </EmptyState>
        </div>
      ) : (
        <div className="flex w-full max-w-[1040px] flex-col gap-4">
          {days.map((day) => (
            <DayCard key={day.date} day={day} />
          ))}
          {next && (
            <Button variant="outline" className="h-10 self-center px-5" isDisabled={loadingMore} onPress={more}>
              Earlier days
            </Button>
          )}
          {error && <p role="alert" className="text-center text-[13px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
