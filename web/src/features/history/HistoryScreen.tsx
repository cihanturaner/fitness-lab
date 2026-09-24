import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, History as HistoryIcon, Search } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { Exercise, ExerciseHistory, Exposure, HistoryExercise, PerformedSet } from '@/api/types'
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
      className={`press rounded-[9px] px-3.5 py-1 text-[13px] font-semibold ${
        current === name ? 'bg-card text-emerald-800 shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </a>
  )
  return (
    <nav aria-label="History views" className="flex gap-1 rounded-[12px] bg-emerald-900/5 p-1">
      {tab('exercises', '#/history', 'By exercise')}
      {tab('sessions', '#/sessions', 'Sessions')}
    </nav>
  )
}

/** The heaviest non-warm-up set with a recorded load (ties: most reps), for trend and Δ. */
function topSet(sets: PerformedSet[]): PerformedSet | null {
  let best: PerformedSet | null = null
  for (const performed of sets) {
    if (performed.set_type === 'warmup' || performed.load_lb === null) continue
    if (
      !best ||
      Number(performed.load_lb) > Number(best.load_lb) ||
      (Number(performed.load_lb) === Number(best.load_lb) && (performed.reps ?? 0) > (best.reps ?? 0))
    ) {
      best = performed
    }
  }
  return best
}

/** "+5 lb", "+1 rep", "=" — the top set against the previous exposure's top set. */
function delta(current: PerformedSet | null, previous: PerformedSet | null): { text: string; dir: -1 | 0 | 1 } | null {
  if (!current || !previous) return null
  const load = Number(current.load_lb) - Number(previous.load_lb)
  if (Math.abs(load) > 1e-9) {
    const text = `${load > 0 ? '+' : '−'}${Number(Math.abs(load).toFixed(2))} lb`
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
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold ${
        value.dir > 0 ? 'bg-emerald-100 text-emerald-800' : value.dir < 0 ? 'bg-sunken text-muted-foreground' : 'text-faint'
      }`}
    >
      {value.dir !== 0 && <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />}
      {value.text}
    </span>
  )
}

/** "185 lb × 6 @ RIR 2": one working set with every unit spelled out; the top set stands out. */
function SetCell({ performed, top }: { performed: PerformedSet | undefined; top: boolean }) {
  if (!performed) return <span className="text-faint">·</span>
  return (
    <span
      data-testid="history-set"
      className={`inline-block whitespace-nowrap rounded-lg px-2 py-0.5 ${top ? 'bg-emerald-50 shadow-[inset_0_0_0_1px_rgb(47_154_114/0.35)]' : ''}`}
    >
      <span className={`text-[15px] font-semibold tracking-[-0.01em] ${top ? 'text-emerald-800' : ''}`}>
        {performed.load_lb === null ? '–' : `${performed.load_lb} lb`}
      </span>
      <span className="text-muted-foreground"> × </span>
      {performed.reps ?? '?'}
      {performed.rir !== null && <span className="text-muted-foreground"> @ RIR {performed.rir}</span>}
    </span>
  )
}

/** "Pre" before the block, "Post" after it, the block week inside it. */
function weekLabel(exposure: Exposure): string {
  if (exposure.phase === 'pre_block') return 'Pre'
  if (exposure.phase === 'post_block') return 'Post'
  return exposure.block_week === null ? '–' : String(exposure.block_week)
}

/** A top set with its unit: "185 lb × 6 @ 2". */
function topLabel(top: PerformedSet | null): string {
  return top ? `${compactSet(top).replace('×', ' lb × ').replace('@', ' @ ')}` : '—'
}

function ExerciseDetail({ exerciseId }: { exerciseId: string }) {
  const [history, setHistory] = useState<ExerciseHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)

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
  const name = (exposure: Exposure) => exposure.planned_workout_name ?? 'Unplanned'
  const sessions = [...new Set(history.exposures.map(name))]
  const exposures = history.exposures.filter((exposure) => session === null || name(exposure) === session)
  const tops = exposures.map((exposure) => topSet(exposure.sets))
  const working = exposures.map((exposure) => exposure.sets.filter((performed) => performed.set_type !== 'warmup'))
  const columns = Math.max(1, ...working.map((sets) => sets.length))
  const hasWeeks = exposures.some((exposure) => exposure.phase !== null)
  /** The same session's previous exposure: week-to-week, never Upper B against Upper A. */
  const previousIndex = (index: number) => {
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      if (name(exposures[earlier] as Exposure) === name(exposures[index] as Exposure)) return earlier
    }
    return -1
  }
  const lastIndex = exposures.length - 1
  const last = exposures[lastIndex]
  const latestTop = tops[lastIndex] ?? null
  // "Since week 1": from the first in-block exposure of the latest one's session.
  const baselineIndex = last
    ? exposures.findIndex(
        (exposure, index) => name(exposure) === name(last) && tops[index] !== null && (!hasWeeks || exposure.phase === 'block'),
      )
    : -1
  const baseline = baselineIndex >= 0 ? exposures[baselineIndex] : undefined
  const overall = baselineIndex >= 0 && baselineIndex < lastIndex ? delta(latestTop, tops[baselineIndex] ?? null) : null
  const sinceLabel =
    baseline && hasWeeks && baseline.phase === 'block' && baseline.block_week !== null
      ? `Since week ${baseline.block_week}`
      : 'Since first session'

  return (
    <section aria-label={`History, ${exerciseLabel(history.exercise)}`} className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[26px] leading-8 font-semibold tracking-[-0.03em]">{exerciseLabel(history.exercise)}</h2>
          {sessions.length > 1 && (
            <div role="group" aria-label="Session" className="flex gap-1 rounded-[12px] bg-card p-1 shadow-[var(--shadow-card)]">
              {[null, ...sessions].map((option) => (
                <button
                  key={option ?? 'all'}
                  type="button"
                  aria-pressed={session === option}
                  className={`press rounded-[9px] px-3.5 py-1 text-[13px] font-semibold ${
                    session === option ? 'bg-emerald-700 text-white shadow-[0_4px_10px_-4px_rgb(27_104_79/0.6)]' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSession(option)}
                >
                  {option ?? 'All sessions'}
                </button>
              ))}
            </div>
          )}
        </div>
        {exposures.length > 0 && (
          <dl className="num grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-1.5 rounded-[12px] bg-gradient-to-br from-emerald-700 to-emerald-600 p-4 text-white shadow-[0_14px_30px_-16px_rgb(15_63_48/0.7)]">
              <dt className="text-[12px] leading-4 font-medium text-white/75">Latest top set · lb × reps @ RIR</dt>
              <dd className="t-stat">{topLabel(latestTop)}</dd>
            </div>
            <div className="surface flex flex-col gap-1.5 p-4">
              <dt className="t-micro font-medium">
                {sinceLabel}
                {last && sessions.length > 1 ? ` · ${name(last)}` : ''}
              </dt>
              <dd data-testid="history-since" className="t-stat">
                <Delta value={overall} />
              </dd>
            </div>
            <div className="surface flex flex-col gap-1.5 p-4">
              <dt className="t-micro font-medium">Sessions</dt>
              <dd className="t-stat">{exposures.length}</dd>
            </div>
            {last && (
              <div className="surface flex flex-col gap-1.5 p-4">
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
          <div className="surface overflow-x-auto">
            <table className="num w-full text-[14px]" aria-label="Exposures">
              <thead className="text-left text-[12px] text-muted-foreground">
                <tr className="border-b border-border">
                  {hasWeeks && <th className="w-16 py-3 pl-5 font-medium">Week</th>}
                  <th className={`py-2.5 pr-5 font-medium ${hasWeeks ? '' : 'pl-5'}`}>Date</th>
                  <th className="py-2.5 pr-5 font-medium">Session</th>
                  {Array.from({ length: columns }, (_, index) => (
                    <th key={index} className="py-2.5 pr-5 font-medium">
                      Set {index + 1}
                    </th>
                  ))}
                  <th className="py-2.5 pr-5 text-right font-medium">vs previous {sessions.length > 1 ? 'same session' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {exposures.map((exposure, index) => {
                  const warmups = exposure.sets.length - (working[index]?.length ?? 0)
                  const before = previousIndex(index)
                  return (
                    <tr
                      key={exposure.workout_id}
                      data-testid="history-exposure"
                      className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-emerald-50/50"
                    >
                      {hasWeeks && (
                        <td className="py-2.5 pl-5">
                          <span
                            data-testid="history-week"
                            className={`num inline-flex h-6 min-w-8 items-center justify-center rounded-full px-2 text-[12px] font-semibold ${
                              exposure.phase === 'block' ? 'bg-emerald-100 text-emerald-800' : 'bg-sunken text-muted-foreground'
                            }`}
                          >
                            {weekLabel(exposure)}
                          </span>
                        </td>
                      )}
                      <td className={`py-2.5 pr-5 whitespace-nowrap ${hasWeeks ? '' : 'pl-5'}`}>
                        <a href={workoutHref(exposure.workout_id)} className="hover:underline">
                          {formatShortDate(exposure.performed_on)}
                        </a>
                      </td>
                      <td className="py-2.5 pr-5 whitespace-nowrap text-muted-foreground">
                        {name(exposure)}
                        {warmups > 0 && <span className="block text-[12px] text-faint">+{warmups} warm-up</span>}
                      </td>
                      {Array.from({ length: columns }, (_, column) => {
                        const performed = working[index]?.[column]
                        return (
                          <td key={column} className="py-2 pr-3">
                            <SetCell performed={performed} top={performed !== undefined && performed.id === tops[index]?.id} />
                          </td>
                        )
                      })}
                      <td className="py-2.5 pr-5 text-right whitespace-nowrap">
                        <Delta value={before < 0 ? null : delta(tops[index] ?? null, tops[before] ?? null)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="-mt-3 t-micro">
            Oldest first. Each working set is lb × reps @ RIR; the outlined set is the session’s top set; warm-ups are
            counted, not listed. “vs previous” compares the heaviest working set with the previous session of the same name; it
            does not consider RIR, so it is not a progression verdict.
            {hasWeeks && ' Pre / Post: before the block start / after its last week.'}
          </p>
          {exposures.length >= 2 && (sessions.length === 1 || session !== null) && (
            <div className="surface flex flex-col gap-2 p-6">
              <div className="flex items-baseline justify-between">
                <h3 className="t-section">Top load per session · lb</h3>
                <span className="t-micro">Reps above each point</span>
              </div>
              <TrendChart
                label="Top recorded load per session"
                unit="lb"
                height={200}
                minSpan={10}
                dates={exposures.map((exposure) => exposure.performed_on)}
                series={[
                  {
                    label: 'Top load',
                    color: 'var(--series-trend)',
                    kind: 'line',
                    markers: true,
                    values: tops.map((top) => (top ? Number(top.load_lb) : null)),
                    pointLabels: tops.map((top) => (top?.reps === null || top?.reps === undefined ? null : `×${top.reps}`)),
                  },
                ]}
              />
            </div>
          )}
          {exposures.length >= 2 && sessions.length > 1 && session === null && (
            <p className="t-micro">Pick one session above to chart its top load; different sessions prescribe different reps.</p>
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
              <div key={row} className="h-9 rounded-[12px] bg-white/50" />
            ))}
          </div>
        ) : (
          <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
            {library.map((exercise) => (
              <li key={exercise.id} className="truncate rounded-[12px] px-3 py-2 text-[14px] text-muted-foreground">
                {exerciseLabel(exercise)}
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="surface py-10">
        <EmptyState
          icon={HistoryIcon}
          title="History begins with your first completed workout."
          action={
            <a
              href="#/"
              className="press inline-flex h-10 items-center rounded-[12px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground hover:bg-emerald-800"
            >
              Go to this week
            </a>
          }
        >
          Completed sessions appear here, exercise by exercise, week by week: the date, every set, and its load in lb,
          reps and RIR, with the change from one week to the next.
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
    <div className="enter flex flex-col gap-8">
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
                className="h-10 w-full rounded-[12px] border border-transparent bg-card pr-2 pl-8 text-[14px] shadow-[var(--shadow-card)] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <ul className="-mx-1 flex max-h-[70vh] flex-col gap-1 overflow-y-auto px-1 py-1">
              {shown.map((item) => {
                const active = item.exercise.id === selected
                return (
                  <li key={item.exercise.id}>
                    <a
                      href={historyHref(item.exercise.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`press relative flex flex-col rounded-[10px] py-2 pr-3 pl-4 ${
                        active ? 'bg-card shadow-[var(--shadow-card)]' : 'hover:bg-white/60'
                      }`}
                    >
                      {/* The selected exercise carries an emerald bar, like a tab pulled forward. */}
                      <span
                        aria-hidden
                        className={`absolute top-2.5 bottom-2.5 left-1.5 w-[3px] rounded-full bg-emerald-600 transition-opacity duration-200 ${active ? 'opacity-100' : 'opacity-0'}`}
                      />
                      <span className={`text-[14px] leading-5 ${active ? 'font-semibold text-emerald-900' : 'font-medium'}`}>
                        {exerciseLabel(item.exercise)}
                      </span>
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
