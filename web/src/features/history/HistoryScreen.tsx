import { useEffect, useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { ExerciseHistory, HistoryExercise } from '@/api/types'
import { TrendChart } from '@/components/chart/TrendChart'
import { compactSet, exerciseLabel, formatShortDate } from '@/lib/format'
import { historyHref, workoutHref } from '@/lib/route'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

export function HistoryTabs({ current }: { current: 'exercises' | 'sessions' }) {
  const tab = (name: 'exercises' | 'sessions', href: string, label: string) => (
    <a
      href={href}
      aria-current={current === name ? 'page' : undefined}
      className={`rounded-md px-2 py-1 text-[13px] ${
        current === name ? 'bg-card font-medium shadow-[0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </a>
  )
  return (
    <nav aria-label="History views" className="flex gap-1">
      {tab('exercises', '#/history', 'By exercise')}
      {tab('sessions', '#/sessions', 'Sessions')}
    </nav>
  )
}

/** The heaviest recorded load among the exposure's non-warm-up sets, for the trend line. */
function topLoad(sets: ExerciseHistory['exposures'][number]['sets']): number | null {
  const loads = sets
    .filter((performed) => performed.set_type !== 'warmup' && performed.load_kg !== null)
    .map((performed) => Number(performed.load_kg))
  return loads.length === 0 ? null : Math.max(...loads)
}

function ExerciseDetail({ exerciseId }: { exerciseId: string }) {
  const [history, setHistory] = useState<ExerciseHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.exerciseHistory(exerciseId).then(
      (loaded) => live && setHistory(loaded),
      (failure: unknown) => live && setError(message(failure)),
    )
    return () => {
      live = false
    }
  }, [exerciseId])

  if (!history) {
    return error ? (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    ) : (
      <p className="text-muted-foreground">Loading…</p>
    )
  }
  const { exposures } = history
  const widest = Math.max(0, ...exposures.map((exposure) => exposure.sets.length))

  return (
    <section aria-label={`History, ${exerciseLabel(history.exercise)}`} className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{exerciseLabel(history.exercise)}</h2>
      {exposures.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No completed sessions with this exercise.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
            <table className="num text-[13px]" aria-label="Exposures">
              <thead className="text-left text-[11px] tracking-wider text-muted-foreground uppercase">
                <tr>
                  <th className="pb-1 pr-6 font-medium">Date</th>
                  {history.block_start_on && <th className="pb-1 pr-6 font-medium">Wk</th>}
                  <th className="pb-1 pr-6 font-medium">Session</th>
                  {Array.from({ length: widest }, (_, index) => (
                    <th key={index} className="pb-1 pr-3 font-medium">
                      Set {index + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exposures.map((exposure) => (
                  <tr key={exposure.workout_id} data-testid="history-exposure" className="border-t border-border/70">
                    <td className="py-1.5 pr-6 whitespace-nowrap">
                      <a href={workoutHref(exposure.workout_id)} className="hover:underline">
                        {formatShortDate(exposure.performed_on)}
                      </a>
                    </td>
                    {history.block_start_on && (
                      <td className="py-1.5 pr-6 text-muted-foreground">
                        {exposure.block_week !== null && exposure.block_week >= 1 ? exposure.block_week : '–'}
                      </td>
                    )}
                    <td className="py-1.5 pr-6 whitespace-nowrap text-muted-foreground">
                      {exposure.planned_workout_name ?? 'Unplanned'}
                    </td>
                    {exposure.sets.map((performed) => (
                      <td
                        key={performed.id}
                        data-testid="history-set"
                        className={`py-1.5 pr-6 whitespace-nowrap ${performed.set_type === 'warmup' ? 'text-muted-foreground' : 'font-medium'}`}
                      >
                        {compactSet(performed)}
                        {performed.set_type === 'warmup' && <sup className="ml-px text-[9px]">w</sup>}
                        {performed.set_type === 'backoff' && <sup className="ml-px text-[9px]">b</sup>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">kg × reps @ RIR · w warm-up · b back-off</p>
          </div>
          {exposures.length >= 2 && (
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="mb-1 text-[11px] tracking-wider text-muted-foreground uppercase">Top load per session</p>
              <TrendChart
                label="Top recorded load per session"
                unit="kg"
                dates={exposures.map((exposure) => exposure.performed_on)}
                series={[
                  {
                    label: 'Top load',
                    color: 'var(--series-trend)',
                    kind: 'line',
                    markers: true,
                    values: exposures.map((exposure) => topLoad(exposure.sets)),
                  },
                ]}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function HistoryScreen({ exerciseId }: { exerciseId: string | null }) {
  const [list, setList] = useState<HistoryExercise[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let live = true
    api.historyExercises().then(
      (loaded) => live && setList(loaded),
      (failure: unknown) => live && setError(message(failure)),
    )
    return () => {
      live = false
    }
  }, [])

  if (!list) {
    return error ? (
      <p role="alert" className="text-destructive">
        Could not load history: {error}
      </p>
    ) : (
      <p className="text-muted-foreground">Loading history…</p>
    )
  }

  const selected = exerciseId ?? list[0]?.exercise.id ?? null
  const shown = list.filter((item) => exerciseLabel(item.exercise).toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <HistoryTabs current="exercises" />
      </header>
      {list.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Completed sessions appear here, exercise by exercise, week by week.
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label="Exercises" className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2">
            <input
              aria-label="Filter exercises"
              placeholder="Filter…"
              className="mb-1 h-7 rounded-md border border-input bg-card px-2 text-[13px] outline-none focus-visible:border-ring"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <ul className="flex max-h-[70vh] flex-col overflow-y-auto">
              {shown.map((item) => (
                <li key={item.exercise.id}>
                  <a
                    href={historyHref(item.exercise.id)}
                    aria-current={item.exercise.id === selected ? 'page' : undefined}
                    className={`flex items-baseline justify-between gap-2 rounded px-2 py-1 text-[13px] ${
                      item.exercise.id === selected ? 'bg-muted font-medium' : 'hover:bg-muted/60'
                    }`}
                  >
                    <span className="truncate">{exerciseLabel(item.exercise)}</span>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">
                      {item.exposures}× · {formatShortDate(item.last_performed_on)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {selected && <ExerciseDetail key={selected} exerciseId={selected} />}
        </div>
      )}
    </div>
  )
}
