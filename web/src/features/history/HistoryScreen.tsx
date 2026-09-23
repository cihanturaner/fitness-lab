import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, History as HistoryIcon, Search } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { Exercise, ExerciseHistory, HistoryExercise, PerformedSet } from '@/api/types'
import { TrendChart } from '@/components/chart/TrendChart'
import { EmptyState, LoadError, PageHeader, Skeleton } from '@/components/app/primitives'
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
      className={`rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${
        current === name ? 'bg-card text-foreground shadow-[0_0_0_1px_var(--border-strong)]' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </a>
  )
  return (
    <nav aria-label="History views" className="flex gap-1 rounded-lg bg-sunken p-1">
      {tab('exercises', '#/history', 'By exercise')}
      {tab('sessions', '#/sessions', 'Sessions')}
    </nav>
  )
}

/** The heaviest non-warm-up set with a recorded load (ties: most reps), for trend and Δ. */
function topSet(sets: PerformedSet[]): PerformedSet | null {
  let best: PerformedSet | null = null
  for (const performed of sets) {
    if (performed.set_type === 'warmup' || performed.load_kg === null) continue
    if (
      !best ||
      Number(performed.load_kg) > Number(best.load_kg) ||
      (Number(performed.load_kg) === Number(best.load_kg) && (performed.reps ?? 0) > (best.reps ?? 0))
    ) {
      best = performed
    }
  }
  return best
}

/** "+5 kg", "+1 rep", "=" — the top set against the previous exposure's top set. */
function delta(current: PerformedSet | null, previous: PerformedSet | null): { text: string; dir: -1 | 0 | 1 } | null {
  if (!current || !previous) return null
  const load = Number(current.load_kg) - Number(previous.load_kg)
  if (Math.abs(load) > 1e-9) {
    const text = `${load > 0 ? '+' : '−'}${Number(Math.abs(load).toFixed(3))} kg`
    return { text, dir: load > 0 ? 1 : -1 }
  }
  const reps = (current.reps ?? 0) - (previous.reps ?? 0)
  if (reps !== 0) return { text: `${reps > 0 ? '+' : '−'}${Math.abs(reps)} rep${Math.abs(reps) === 1 ? '' : 's'}`, dir: reps > 0 ? 1 : -1 }
  return { text: 'same', dir: 0 }
}

function Delta({ value }: { value: ReturnType<typeof delta> }) {
  if (!value) return <span className="text-faint">—</span>
  const Icon = value.dir > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 ${value.dir > 0 ? 'text-ok' : value.dir < 0 ? 'text-muted-foreground' : 'text-faint'}`}>
      {value.dir !== 0 && <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />}
      {value.text}
    </span>
  )
}

function SetChip({ performed }: { performed: PerformedSet }) {
  const warm = performed.set_type === 'warmup'
  return (
    <span
      data-testid="history-set"
      className={`rounded px-1.5 py-0.5 whitespace-nowrap ${warm ? 'text-muted-foreground' : 'bg-sunken font-medium'}`}
    >
      {compactSet(performed)}
      {warm && <sup className="ml-px text-[10px]">w</sup>}
      {performed.set_type === 'backoff' && <sup className="ml-px text-[10px]">b</sup>}
    </span>
  )
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
    return error ? <LoadError what="this exercise" detail={error} /> : <Skeleton label="Loading…" blocks={['h-8 w-64', 'h-20', 'h-48']} />
  }
  const { exposures } = history
  const tops = exposures.map((exposure) => topSet(exposure.sets))
  const latestTop = tops.at(-1) ?? null
  const firstTop = tops.find((top) => top !== null) ?? null
  const overall = tops.length > 1 ? delta(latestTop, firstTop) : null
  const last = exposures.at(-1)

  return (
    <section aria-label={`History, ${exerciseLabel(history.exercise)}`} className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-4">
        <h2 className="text-[22px] leading-7 font-semibold tracking-[-0.02em]">{exerciseLabel(history.exercise)}</h2>
        {exposures.length > 0 && (
          <dl className="num flex flex-wrap gap-x-10 gap-y-3">
            <div className="flex flex-col gap-1">
              <dt className="t-micro font-medium">Latest top set</dt>
              <dd className="t-stat">{latestTop ? compactSet(latestTop) : '—'}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="t-micro font-medium">Since first session</dt>
              <dd className="t-stat">
                <Delta value={overall} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="t-micro font-medium">Sessions</dt>
              <dd className="t-stat">{exposures.length}</dd>
            </div>
            {last && (
              <div className="flex flex-col gap-1">
                <dt className="t-micro font-medium">Last</dt>
                <dd className="t-stat">{formatShortDate(last.performed_on)}</dd>
              </div>
            )}
          </dl>
        )}
      </header>
      {exposures.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No completed sessions with this exercise.">
          Complete a workout that includes it and every set appears here.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[10px] border border-border bg-card">
            <table className="num w-full text-[14px]" aria-label="Exposures">
              <thead className="text-left text-[12px] text-muted-foreground">
                <tr className="border-b border-border">
                  {history.block_start_on && <th className="w-14 py-2.5 pl-5 font-medium">Wk</th>}
                  <th className={`py-2.5 pr-6 font-medium ${history.block_start_on ? '' : 'pl-5'}`}>Date</th>
                  <th className="py-2.5 pr-6 font-medium">Session</th>
                  <th className="py-2.5 pr-6 font-medium">Sets · kg × reps @ RIR</th>
                  <th className="py-2.5 pr-6 text-right font-medium">Top set</th>
                  <th className="py-2.5 pr-5 text-right font-medium">vs previous</th>
                </tr>
              </thead>
              <tbody>
                {exposures.map((exposure, index) => (
                  <tr key={exposure.workout_id} data-testid="history-exposure" className="border-b border-border last:border-b-0 hover:bg-sunken/40">
                    {history.block_start_on && (
                      <td className="py-2.5 pl-5 text-muted-foreground">
                        {exposure.block_week !== null && exposure.block_week >= 1 ? exposure.block_week : '–'}
                      </td>
                    )}
                    <td className={`py-2.5 pr-6 whitespace-nowrap ${history.block_start_on ? '' : 'pl-5'}`}>
                      <a href={workoutHref(exposure.workout_id)} className="hover:underline">
                        {formatShortDate(exposure.performed_on)}
                      </a>
                    </td>
                    <td className="py-2.5 pr-6 whitespace-nowrap text-muted-foreground">
                      {exposure.planned_workout_name ?? 'Unplanned'}
                    </td>
                    <td className="py-2 pr-6">
                      <span className="flex flex-wrap gap-1">
                        {exposure.sets.map((performed) => (
                          <SetChip key={performed.id} performed={performed} />
                        ))}
                      </span>
                    </td>
                    <td className="py-2.5 pr-6 text-right font-semibold whitespace-nowrap">
                      {tops[index] ? compactSet(tops[index]) : '—'}
                    </td>
                    <td className="py-2.5 pr-5 text-right whitespace-nowrap">
                      <Delta value={index === 0 ? null : delta(tops[index] ?? null, tops[index - 1] ?? null)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="-mt-3 t-micro">
            Oldest first. Warm-ups are marked <sup>w</sup>, back-off sets <sup>b</sup>. Top set is the heaviest working set.
          </p>
          {exposures.length >= 2 && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-card p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="t-section">Top load per session</h3>
                <span className="t-micro">Reps above each point</span>
              </div>
              <TrendChart
                label="Top recorded load per session"
                unit="kg"
                height={200}
                minSpan={10}
                dates={exposures.map((exposure) => exposure.performed_on)}
                series={[
                  {
                    label: 'Top load',
                    color: 'var(--series-trend)',
                    kind: 'line',
                    markers: true,
                    values: tops.map((top) => (top ? Number(top.load_kg) : null)),
                    pointLabels: tops.map((top) => (top?.reps === null || top?.reps === undefined ? null : `×${top.reps}`)),
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

/** Before any completed workout: the exercise library is shown, waiting, beside the promise. */
function EmptyHistory() {
  const [library, setLibrary] = useState<Exercise[]>([])
  useEffect(() => {
    let live = true
    api.exercises().then(
      (list) => live && setLibrary(list.filter((exercise) => exercise.is_active)),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <nav aria-label="Exercises" className="flex flex-col gap-2">
        <p className="t-micro font-medium">
          Exercises <span className="font-normal">· no sessions yet</span>
        </p>
        {library.length === 0 ? (
          <div className="flex flex-col gap-2" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="h-9 rounded-md bg-sunken/80" />
            ))}
          </div>
        ) : (
          <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
            {library.map((exercise) => (
              <li key={exercise.id} className="truncate border-b border-border/70 px-1 py-2 text-[14px] text-muted-foreground">
                {exerciseLabel(exercise)}
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="rounded-[10px] border border-dashed border-border-strong bg-card/50 py-10">
        <EmptyState
          icon={HistoryIcon}
          title="History begins with your first completed workout."
          action={
            <a
              href="#/"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:bg-primary/85"
            >
              Go to this week
            </a>
          }
        >
          Completed sessions appear here, exercise by exercise, week by week: the date, every set, and its kg, reps
          and RIR, with the change from one week to the next.
        </EmptyState>
      </div>
    </div>
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

  const header = (
    <PageHeader title="History">
      <HistoryTabs current="exercises" />
    </PageHeader>
  )

  if (!list) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        {error ? <LoadError what="history" detail={error} /> : <Skeleton label="Loading history…" blocks={['h-72']} />}
      </div>
    )
  }

  const selected = exerciseId ?? list[0]?.exercise.id ?? null
  const shown = list.filter((item) => exerciseLabel(item.exercise).toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="flex flex-col gap-8">
      {header}
      {list.length === 0 ? (
        <EmptyHistory />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label="Exercises" className="flex flex-col gap-2 lg:sticky lg:top-6">
            <label className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <input
                aria-label="Filter exercises"
                placeholder="Filter exercises"
                className="h-9 w-full rounded-md border border-input bg-card pr-2 pl-8 text-[14px] outline-none placeholder:text-faint hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <ul className="flex max-h-[70vh] flex-col gap-px overflow-y-auto">
              {shown.map((item) => {
                const active = item.exercise.id === selected
                return (
                  <li key={item.exercise.id}>
                    <a
                      href={historyHref(item.exercise.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex flex-col rounded-md px-3 py-1.5 transition-colors ${
                        active ? 'bg-card shadow-[0_0_0_1px_var(--border-strong)]' : 'hover:bg-sunken'
                      }`}
                    >
                      <span className={`text-[14px] leading-5 ${active ? 'font-semibold' : ''}`}>{exerciseLabel(item.exercise)}</span>
                      <span className="num text-[12px] leading-4 text-muted-foreground">
                        {item.exposures} {item.exposures === 1 ? 'session' : 'sessions'} · {formatShortDate(item.last_performed_on)}
                      </span>
                    </a>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="px-3 py-2 t-micro">No exercise matches “{filter}”.</li>}
            </ul>
          </nav>
          {selected && <ExerciseDetail key={selected} exerciseId={selected} />}
        </div>
      )}
    </div>
  )
}
