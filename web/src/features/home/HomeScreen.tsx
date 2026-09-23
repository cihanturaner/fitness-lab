import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ApiError, api } from '@/api/client'
import type { Bodyweight, Nutrition, RecentSession, Week, WeekDay, WeekSession } from '@/api/types'
import { Button } from '@/components/ui/button'
import { compactSet, exerciseLabel, formatShortDate, localDate, signed } from '@/lib/format'
import { historyHref, navigate, workoutHref } from '@/lib/route'

type Loaded = { week: Week; bodyweight: Bodyweight; nutrition: Nutrition; recent: RecentSession[] }

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

export function Panel({
  title,
  href,
  linkLabel,
  children,
  testId,
}: {
  title: string
  href?: string
  linkLabel?: string
  children: ReactNode
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
        {href && (
          <a href={href} className="text-[12px] text-plan hover:underline">
            {linkLabel ?? 'Open'} →
          </a>
        )}
      </header>
      {children}
    </section>
  )
}

const STATUS_LABEL: Record<WeekSession['status'], string> = {
  complete: 'Done',
  draft: 'Draft',
  not_started: 'Not started',
}

function SessionCell({
  session,
  busy,
  onOpen,
}: {
  session: WeekSession
  busy: boolean
  onOpen: (session: WeekSession) => void
}) {
  const tone =
    session.status === 'complete' ? 'text-ok' : session.status === 'draft' ? 'text-warn' : 'text-muted-foreground'
  return (
    <div data-testid={`planned-${session.workout_key}`} data-status={session.status} className="flex flex-col gap-1">
      <p className="text-[14px] leading-tight font-semibold">{session.name}</p>
      <p className="num text-[11px] text-muted-foreground">
        {session.slot_count} exercises · {session.set_count} sets
      </p>
      <p className={`text-[12px] font-medium ${tone}`} data-testid="session-status">
        {STATUS_LABEL[session.status]}
        {session.workout_on && session.status !== 'not_started' && (
          <span className="font-normal text-muted-foreground"> · {formatShortDate(session.workout_on)}</span>
        )}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {session.status === 'complete' && session.workout_id ? (
          <>
            <a
              href={workoutHref(session.workout_id)}
              aria-label={`View ${session.name}`}
              className="rounded-md border border-border px-2 py-0.5 text-[12px] font-medium hover:bg-muted"
            >
              View
            </a>
            <button
              type="button"
              disabled={busy}
              aria-label={`Start ${session.name} again`}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => onOpen(session)}
            >
              Log again
            </button>
          </>
        ) : (
          <Button
            size="xs"
            variant={session.status === 'draft' ? 'default' : 'outline'}
            isDisabled={busy}
            aria-label={`${session.status === 'draft' ? 'Resume draft of' : 'Start'} ${session.name}`}
            onPress={() => onOpen(session)}
          >
            {session.status === 'draft' ? 'Resume' : 'Open'}
          </Button>
        )}
      </div>
    </div>
  )
}

function DayColumn({
  day,
  today,
  busy,
  onOpen,
}: {
  day: WeekDay
  today: string
  busy: boolean
  onOpen: (session: WeekSession) => void
}) {
  const isToday = day.date === today
  const dayOfMonth = Number(day.date.split('-')[2])
  return (
    <li
      data-testid={`day-${day.weekday.toLowerCase()}`}
      aria-current={isToday ? 'date' : undefined}
      className={`flex min-h-32 flex-col gap-2 rounded-lg border p-2.5 ${
        isToday ? 'border-plan bg-card shadow-[inset_0_2px_0_var(--plan)]' : 'border-border bg-card/60'
      }`}
    >
      <p className="flex items-baseline justify-between text-[11px] tracking-wider text-muted-foreground uppercase">
        <span className={isToday ? 'font-semibold text-plan' : ''}>
          {day.weekday.slice(0, 3)}
          {isToday && <span className="ml-1 normal-case tracking-normal">· today</span>}
        </span>
        <span className="num">{dayOfMonth}</span>
      </p>
      {day.sessions.length === 0 && day.unplanned.length === 0 && (
        <p className="text-[12px] text-muted-foreground/70">Rest</p>
      )}
      {day.sessions.map((session) => (
        <SessionCell key={session.planned_workout_id} session={session} busy={busy} onOpen={onOpen} />
      ))}
      {day.unplanned.map((item) => (
        <a
          key={item.workout_id}
          href={workoutHref(item.workout_id)}
          className="text-[12px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Unplanned · {item.status === 'complete' ? 'done' : 'draft'}
        </a>
      ))}
    </li>
  )
}

function BlockLabel({ week }: { week: Week }) {
  const { block, program } = week
  if (!program) return <>No active program</>
  if (!block) return <>This week</>
  const weeks = block.weeks ?? program.duration_weeks
  if (block.week < 1) return <>Block starts {formatShortDate(block.start_on)}</>
  if (weeks !== null && block.week > weeks) return <>Block finished</>
  return (
    <span data-testid="block-week">
      Week <span className="num">{block.week}</span>
      {weeks !== null && <span className="num font-normal text-muted-foreground"> of {weeks}</span>}
    </span>
  )
}

function BodyweightSummary({ data }: { data: Bodyweight }) {
  const { summary } = data
  if (!summary.latest) {
    return <p className="text-[13px] text-muted-foreground">No weigh-ins yet.</p>
  }
  return (
    <dl className="num grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-[13px]">
      <dt className="text-muted-foreground">Latest</dt>
      <dd data-testid="home-bw-latest">
        <span className="text-[18px] font-semibold">{summary.latest.bodyweight_kg}</span> kg
        <span className="text-muted-foreground"> · {formatShortDate(summary.latest.measured_on)}</span>
      </dd>
      <dt className="text-muted-foreground">7-day avg</dt>
      <dd data-testid="home-bw-avg">
        {summary.current_avg_kg ?? '—'} kg
        <span className="text-muted-foreground"> ({summary.current_count}/7 days)</span>
      </dd>
      <dt className="text-muted-foreground">vs prior 7</dt>
      <dd data-testid="home-bw-change">
        {summary.change_kg === null ? (
          <span className="text-muted-foreground">no prior week yet</span>
        ) : (
          <>
            {signed(summary.change_kg)} kg
            <span className="text-muted-foreground"> · {signed(summary.change_pct ?? '0')}%</span>
          </>
        )}
      </dd>
    </dl>
  )
}

function Macro({
  label,
  value,
  target,
  unit,
  testId,
}: {
  label: string
  value: number | null
  target: number | null
  unit: string
  testId: string
}) {
  return (
    <div data-testid={testId} className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="num text-[15px] font-semibold">
        {value ?? '—'}
        <span className="text-[11px] font-normal text-muted-foreground">
          {' '}
          / {target ?? '?'} {unit}
        </span>
      </span>
    </div>
  )
}

function NutritionSummary({ data }: { data: Nutrition }) {
  const { day, targets } = data
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-2">
        <Macro label="Calories" value={day?.calories_kcal ?? null} target={targets.calories_kcal} unit="kcal" testId="home-nut-kcal" />
        <Macro label="Protein" value={day?.protein_g ?? null} target={targets.protein_g} unit="g" testId="home-nut-protein" />
        <Macro label="Carbs" value={day?.carbs_g ?? null} target={targets.carbs_g} unit="g" testId="home-nut-carbs" />
        <Macro label="Fat" value={day?.fat_g ?? null} target={targets.fat_g} unit="g" testId="home-nut-fat" />
      </div>
      {targets.calories_kcal === null && (
        <p className="text-[12px] text-muted-foreground">Calorie target not calibrated yet.</p>
      )}
      {!day && <p className="text-[12px] text-muted-foreground">Nothing logged today.</p>}
    </div>
  )
}

function RecentTraining({ sessions }: { sessions: RecentSession[] }) {
  if (sessions.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No completed sessions yet.</p>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {sessions.map((session) => (
        <div key={session.workout_id} data-testid="recent-session" className="flex flex-col gap-0.5">
          <a href={workoutHref(session.workout_id)} className="text-[12px] font-medium hover:underline">
            {formatShortDate(session.performed_on)} · {session.planned_workout_name ?? 'Unplanned'}
          </a>
          <ul className="num flex flex-col text-[12px]">
            {session.exercises.slice(0, 4).map((group) => (
              <li key={group.exercise.id} className="flex gap-2">
                <a
                  href={historyHref(group.exercise.id)}
                  className="w-40 shrink-0 truncate text-muted-foreground hover:text-foreground"
                >
                  {exerciseLabel(group.exercise)}
                </a>
                <span className="truncate">
                  {group.sets
                    .filter((performed) => performed.set_type !== 'warmup')
                    .map(compactSet)
                    .join(' · ')}
                </span>
              </li>
            ))}
            {session.exercises.length > 4 && (
              <li className="text-muted-foreground">+{session.exercises.length - 4} more exercises</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function HomeScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = localDate()

  const load = useCallback(() => {
    Promise.all([api.week(today), api.bodyweight(today, 14), api.nutrition(today), api.recentTraining(2)]).then(
      ([week, bodyweight, nutrition, recent]) => setLoaded({ week, bodyweight, nutrition, recent }),
      (failure: unknown) => setError(message(failure)),
    )
  }, [today])

  useEffect(load, [load])

  const open = async (session: WeekSession) => {
    setBusy(true)
    try {
      const result = await api.openPlanned(session.planned_workout_id, today)
      navigate(workoutHref(result.workout_id))
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }

  const startUnplanned = async () => {
    setBusy(true)
    try {
      const workout = await api.createWorkout(today)
      navigate(workoutHref(workout.id))
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }

  if (!loaded) {
    return error ? (
      <p role="alert" className="text-destructive">
        Could not load the week: {error}
      </p>
    ) : (
      <p className="text-muted-foreground">Loading the week…</p>
    )
  }

  const { week, bodyweight, nutrition, recent } = loaded

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          <BlockLabel week={week} />
        </h1>
        <p className="num text-[13px] text-muted-foreground">
          {formatShortDate(week.week_start)} – {formatShortDate(week.week_end)}
          {week.program && (
            <>
              {' · '}
              {week.program.name}
              {week.program.version_label ? ` ${week.program.version_label}` : ''}
            </>
          )}
        </p>
        <Button variant="ghost" size="sm" className="ml-auto" isDisabled={busy} onPress={() => void startUnplanned()}>
          Start unplanned session
        </Button>
      </header>
      {!week.program && (
        <p className="text-[13px] text-muted-foreground">
          Import and activate a program with the fitness-lab command-line tool. Unplanned sessions can
          still be recorded.
        </p>
      )}
      {week.program && !week.block && (
        <p className="text-[12px] text-muted-foreground">
          Block start not set: run <code>uv run fitness-lab set-block-start YYYY-MM-DD</code> to number
          the 12 weeks.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ol aria-label="This week" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {week.days.map((day) => (
          <DayColumn key={day.date} day={day} today={week.date} busy={busy} onOpen={(session) => void open(session)} />
        ))}
      </ol>
      {week.unscheduled.length > 0 && (
        <div className="flex flex-wrap gap-4 rounded-lg border border-dashed border-border p-2.5">
          <p className="text-[11px] tracking-wider text-muted-foreground uppercase">No fixed day</p>
          {week.unscheduled.map((session) => (
            <SessionCell key={session.planned_workout_id} session={session} busy={busy} onOpen={(item) => void open(item)} />
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Bodyweight" href="#/bodyweight" linkLabel="Log" testId="home-bodyweight">
          <BodyweightSummary data={bodyweight} />
        </Panel>
        <Panel title="Nutrition today" href="#/nutrition" linkLabel="Log" testId="home-nutrition">
          <NutritionSummary data={nutrition} />
        </Panel>
        <Panel title="Recent training" href="#/history" linkLabel="History" testId="home-recent">
          <RecentTraining sessions={recent} />
        </Panel>
      </div>
    </div>
  )
}
