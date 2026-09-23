import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { CheckCircle2, ChevronRight, Dumbbell, Moon, Plus, Scale } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { Bodyweight, Nutrition, RecentSession, Week, WeekDay, WeekSession } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Sparkline } from '@/components/chart/Sparkline'
import { EmptyState, LoadError, Meter, Skeleton } from '@/components/app/primitives'
import {
  compactSet,
  daysBetween,
  exerciseLabel,
  formatLongDate,
  formatRange,
  formatShortDate,
  localDate,
  signed,
} from '@/lib/format'
import { historyHref, navigate, workoutHref } from '@/lib/route'

type Loaded = { week: Week; bodyweight: Bodyweight; nutrition: Nutrition; recent: RecentSession[] }

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

/** A summary card: a unit with its own way in, so it earns a surface. */
function Card({
  title,
  href,
  linkLabel,
  children,
  testId,
}: {
  title: string
  href: string
  linkLabel: string
  children: ReactNode
  testId: string
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="flex min-h-60 flex-col gap-4 rounded-[10px] border border-border bg-card p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="t-section">{title}</h2>
        <a
          href={href}
          className="group/link -mr-1 inline-flex items-center gap-0.5 rounded px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          {linkLabel}
          <ChevronRight className="size-3.5 transition-transform group-hover/link:translate-x-0.5" aria-hidden />
        </a>
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
  const done = session.status === 'complete'
  const draft = session.status === 'draft'
  return (
    <div data-testid={`planned-${session.workout_key}`} data-status={session.status} className="flex flex-1 flex-col gap-1">
      <p className="flex items-center gap-1.5 text-[15px] leading-5 font-semibold tracking-[-0.01em]">
        {session.name}
        {done && <CheckCircle2 className="size-4 text-ok" strokeWidth={2.25} aria-hidden />}
      </p>
      <p className="num text-[12px] leading-4 text-muted-foreground">
        {session.slot_count} exercises · {session.set_count} sets
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-4">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${done ? 'bg-ok' : draft ? 'bg-warn' : 'bg-border-strong'}`}
        />
        <span
          data-testid="session-status"
          className={`font-medium ${done ? 'text-ok' : draft ? 'text-warn' : 'text-muted-foreground'}`}
        >
          {STATUS_LABEL[session.status]}
        </span>
        {session.workout_on && session.status !== 'not_started' && (
          <span className="num text-muted-foreground">{formatShortDate(session.workout_on)}</span>
        )}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3">
        {done && session.workout_id ? (
          <>
            <a
              href={workoutHref(session.workout_id)}
              aria-label={`View ${session.name}`}
              className="inline-flex h-7 items-center rounded-md border border-border-strong bg-card px-2.5 text-[13px] font-medium hover:bg-sunken"
            >
              View
            </a>
            <button
              type="button"
              disabled={busy}
              aria-label={`Start ${session.name} again`}
              className="rounded px-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-45"
              onClick={() => onOpen(session)}
            >
              Log again
            </button>
          </>
        ) : (
          <Button
            size="sm"
            variant={draft ? 'default' : 'outline'}
            className={draft ? '' : 'border-border-strong bg-card hover:bg-sunken'}
            isDisabled={busy}
            aria-label={`${draft ? 'Resume draft of' : 'Start'} ${session.name}`}
            onPress={() => onOpen(session)}
          >
            {draft ? 'Resume' : 'Start'}
          </Button>
        )}
      </div>
    </div>
  )
}

function hasTraining(day: WeekDay): boolean {
  return day.sessions.length > 0 || day.unplanned.length > 0
}

function DayTile({
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
  const training = hasTraining(day)
  const past = day.date < today
  const dayOfMonth = Number(day.date.split('-')[2])
  const draft = day.sessions.some((session) => session.status === 'draft')
  const surface = !training
    ? 'border-transparent bg-sunken/70'
    : draft
      ? 'border-warn/45 bg-card'
      : 'border-border bg-card'
  return (
    <li
      data-testid={`day-${day.weekday.toLowerCase()}`}
      aria-current={isToday ? 'date' : undefined}
      className={`relative flex min-h-40 flex-col gap-3 rounded-[10px] border p-3.5 ${surface} ${
        isToday ? 'outline-2 outline-offset-[-1px] outline-foreground' : ''
      }`}
    >
      <p className="flex items-center justify-between text-[12px] leading-4">
        <span className={`font-medium ${isToday ? 'text-foreground' : past ? 'text-faint' : 'text-muted-foreground'}`}>
          {day.weekday.slice(0, 3)}
          {isToday && <span className="ml-1.5 font-semibold">Today</span>}
        </span>
        <span
          className={`num flex size-6 items-center justify-center rounded-full text-[12px] font-semibold ${
            isToday ? 'bg-foreground text-background' : past ? 'text-faint' : 'text-muted-foreground'
          }`}
        >
          {dayOfMonth}
        </span>
      </p>
      {!training && (
        <p className="flex items-center gap-1.5 text-[13px] text-faint">
          <Moon className="size-3.5" aria-hidden />
          Rest
        </p>
      )}
      {day.sessions.map((session) => (
        <SessionCell key={session.planned_workout_id} session={session} busy={busy} onOpen={onOpen} />
      ))}
      {day.unplanned.map((item) => (
        <a
          key={item.workout_id}
          href={workoutHref(item.workout_id)}
          className="flex items-center gap-1.5 text-[13px] font-medium hover:underline"
        >
          <span aria-hidden className={`size-1.5 rounded-full ${item.status === 'complete' ? 'bg-ok' : 'bg-warn'}`} />
          Unplanned · {item.status === 'complete' ? 'done' : 'draft'}
        </a>
      ))}
    </li>
  )
}

/** Twelve segments: finished weeks ink, this week plan-blue, the rest still to come. */
function BlockRail({ week, weeks }: { week: number; weeks: number }) {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: weeks }, (_, index) => (
        <span
          key={index}
          className={`h-1.5 w-4 rounded-full ${
            index + 1 < week ? 'bg-foreground/80' : index + 1 === week ? 'bg-plan' : 'bg-border-strong/70'
          }`}
        />
      ))}
    </span>
  )
}

function BlockStatus({ week }: { week: Week }) {
  const { block, program } = week
  if (!program || !block) return null
  const weeks = block.weeks ?? program.duration_weeks ?? 12
  if (block.week < 1) {
    const days = daysBetween(week.date, block.start_on)
    return (
      <div className="flex flex-col items-end gap-1.5">
        <BlockRail week={0} weeks={weeks} />
        <p className="num text-[13px] text-muted-foreground">
          Block starts <span className="font-medium text-foreground">{formatShortDate(block.start_on)}</span>
          {days > 0 && ` · in ${days} ${days === 1 ? 'day' : 'days'}`}
        </p>
      </div>
    )
  }
  if (block.week > weeks) {
    return <p className="text-[13px] text-muted-foreground">Block finished</p>
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <BlockRail week={block.week} weeks={weeks} />
      <p data-testid="block-week" className="num text-[13px] font-medium">
        Week {block.week}
        <span className="font-normal text-muted-foreground"> of {weeks}</span>
      </p>
    </div>
  )
}

/** The one thing to do now, chosen from the week: resume, start, or rest. */
function TodayBand({
  week,
  busy,
  onOpen,
  onUnplanned,
}: {
  week: Week
  busy: boolean
  onOpen: (session: WeekSession) => void
  onUnplanned: () => void
}) {
  const all = [...week.days.flatMap((day) => day.sessions.map((session) => ({ session, date: day.date }))), ...week.unscheduled.map((session) => ({ session, date: null }))]
  const todayDay = week.days.find((day) => day.date === week.date)
  const draft = all.find(({ session }) => session.status === 'draft')
  const todays = todayDay?.sessions.find((session) => session.status !== 'complete') ?? todayDay?.sessions[0]
  const next = all.find(({ session, date }) => session.status === 'not_started' && date !== null && date > week.date)

  let kicker: ReactNode
  let title: ReactNode
  let meta: ReactNode = null
  let action: ReactNode = null

  const plan = (session: WeekSession) => (
    <span className="num">
      {session.slot_count} exercises · {session.set_count} sets
    </span>
  )

  if (!week.program) {
    kicker = <span className="text-muted-foreground">Program</span>
    title = <h2>No active program</h2>
    meta = 'Import and activate one from the command line to plan your weeks. Unplanned sessions can still be logged.'
  } else if (draft) {
    const { session } = draft
    kicker = <span className="text-warn">In progress</span>
    title = session.name
    meta = (
      <>
        Draft from {session.workout_on ? formatShortDate(session.workout_on) : 'earlier'} · {plan(session)}
      </>
    )
    action = (
      <Button size="lg" className="h-10 px-5 text-[14px]" isDisabled={busy} aria-label={`Continue ${session.name}`} onPress={() => onOpen(session)}>
        Continue workout
      </Button>
    )
  } else if (todays && todays.status === 'not_started') {
    kicker = <span className="text-plan">Today</span>
    title = todays.name
    meta = plan(todays)
    action = (
      <Button size="lg" className="h-10 px-5 text-[14px]" isDisabled={busy} aria-label={`Start today: ${todays.name}`} onPress={() => onOpen(todays)}>
        Start workout
      </Button>
    )
  } else if (todays && todays.status === 'complete') {
    kicker = <span className="text-ok">Done today</span>
    title = todays.name
    meta = next ? (
      <>
        Next: {next.session.name}, {formatShortDate(next.date ?? '')}
      </>
    ) : (
      'Nothing else planned this week.'
    )
    action = todays.workout_id ? (
      <a
        href={workoutHref(todays.workout_id)}
        aria-label={`Open ${todays.name}`}
        className="inline-flex h-10 items-center rounded-lg border border-border-strong bg-card px-4 text-[14px] font-medium hover:bg-sunken"
      >
        Review session
      </a>
    ) : null
  } else {
    kicker = <span className="text-muted-foreground">Today</span>
    title = 'Rest day'
    meta = next ? (
      <>
        Next: <span className="font-medium text-foreground">{next.session.name}</span>, {formatShortDate(next.date ?? '')} ·{' '}
        {plan(next.session)}
      </>
    ) : (
      'Nothing else planned this week.'
    )
  }

  return (
    <section
      aria-label="Today"
      className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-[10px] border border-border bg-card px-6 py-5"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[12px] leading-4 font-semibold">{kicker}</p>
        <div className="text-[24px] leading-8 font-semibold tracking-[-0.02em]">{title}</div>
        {meta && <p className="t-meta">{meta}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-3 text-[13px] text-muted-foreground" isDisabled={busy} onPress={onUnplanned}>
          <Plus aria-hidden />
          Start unplanned session
        </Button>
        {action}
      </div>
    </section>
  )
}

function Figure({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="t-micro">{label}</span>
      <span data-testid={testId} className="num text-[14px] leading-5 font-medium whitespace-nowrap">
        {children}
      </span>
    </div>
  )
}

function BodyweightSummary({ data }: { data: Bodyweight }) {
  const { summary, series } = data
  if (!summary.latest) {
    return (
      <EmptyState icon={Scale} title="No weigh-ins yet." className="flex-1 py-4">
        Weigh in tomorrow morning. The 7-day trend starts with the first entry.
      </EmptyState>
    )
  }
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p data-testid="home-bw-latest" className="flex shrink-0 flex-col">
          <span className="t-metric">
            {summary.latest.bodyweight_kg}
            <span className="t-unit"> kg</span>
          </span>
          <span className="t-micro"> {formatShortDate(summary.latest.measured_on)}</span>
        </p>
        <div className="flex flex-col items-end gap-2 pt-1 text-right">
          <Figure label="7-day average" testId="home-bw-avg">
            {summary.current_avg_kg ?? '—'} kg <span className="font-normal text-muted-foreground">({summary.current_count}/7 days)</span>
          </Figure>
          <Figure label="vs previous 7 days" testId="home-bw-change">
            {summary.change_kg === null ? (
              <span className="font-normal text-muted-foreground">after a second week</span>
            ) : (
              <>
                {signed(summary.change_kg)} kg
                <span className="font-normal text-muted-foreground"> · {signed(summary.change_pct ?? '0')}%</span>
              </>
            )}
          </Figure>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
        <Sparkline
          label="Bodyweight, last four weeks"
          height={56}
          points={series.map((point) => (point.bodyweight_kg === null ? null : Number(point.bodyweight_kg)))}
          line={series.map((point) => (point.avg7_kg === null ? null : Number(point.avg7_kg)))}
        />
        <p className="t-micro">Last 4 weeks · daily weigh-ins and the 7-day average</p>
      </div>
    </div>
  )
}

function MacroRow({
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
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div data-testid={testId} className="num flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="text-[15px] leading-5 font-semibold">
          {value ?? '—'}
          <span className="text-[12px] font-normal text-muted-foreground"> {unit}</span>
        </span>
        <span className="text-[12px] text-muted-foreground">{target === null ? 'target not set' : `target ${target} ${unit}`}</span>
      </div>
      <span />
      {target === null ? <span className="h-1.5" /> : <Meter value={value} target={target} height={4} />}
    </div>
  )
}

function NutritionSummary({ data }: { data: Nutrition }) {
  const { day, targets } = data
  return (
    <div className="flex flex-1 flex-col gap-3">
      <MacroRow label="Calories" value={day?.calories_kcal ?? null} target={targets.calories_kcal} unit="kcal" testId="home-nut-kcal" />
      <MacroRow label="Protein" value={day?.protein_g ?? null} target={targets.protein_g} unit="g" testId="home-nut-protein" />
      <MacroRow label="Carbs" value={day?.carbs_g ?? null} target={targets.carbs_g} unit="g" testId="home-nut-carbs" />
      <MacroRow label="Fat" value={day?.fat_g ?? null} target={targets.fat_g} unit="g" testId="home-nut-fat" />
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3 text-[12px] leading-4 text-muted-foreground">
        {!day && <p>Nothing logged today.</p>}
        {targets.calories_kcal === null && <p>Calorie target not calibrated yet.</p>}
        {day && targets.calories_kcal !== null && <p>Logged {formatShortDate(day.logged_on)}.</p>}
      </div>
    </div>
  )
}

function RecentTraining({ sessions }: { sessions: RecentSession[] }) {
  const [latest, ...earlier] = sessions
  if (!latest) {
    return (
      <EmptyState icon={Dumbbell} title="No completed sessions yet." className="flex-1 py-4">
        Complete a workout and its working sets appear here.
      </EmptyState>
    )
  }
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div data-testid="recent-session" className="flex flex-col gap-2">
        <a href={workoutHref(latest.workout_id)} className="flex items-baseline justify-between gap-2 hover:underline">
          <span className="text-[14px] font-semibold">{latest.planned_workout_name ?? 'Unplanned session'}</span>
          <span className="num text-[12px] text-muted-foreground">{formatShortDate(latest.performed_on)}</span>
        </a>
        <ul className="num flex flex-col gap-1 text-[13px] leading-[18px]">
          {latest.exercises.slice(0, 5).map((group) => (
            <li key={group.exercise.id} className="flex items-baseline justify-between gap-3">
              <a href={historyHref(group.exercise.id)} className="min-w-0 truncate text-muted-foreground hover:text-foreground">
                {exerciseLabel(group.exercise)}
              </a>
              <span className="shrink-0 text-[12px] font-medium">
                {group.sets
                  .filter((performed) => performed.set_type !== 'warmup')
                  .map(compactSet)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {latest.exercises.length > 5 && (
          <a href={workoutHref(latest.workout_id)} className="text-[12px] text-muted-foreground hover:text-foreground">
            +{latest.exercises.length - 5} more exercises
          </a>
        )}
      </div>
      {earlier.map((session) => (
        <a
          key={session.workout_id}
          data-testid="recent-session"
          href={workoutHref(session.workout_id)}
          className="mt-auto flex items-baseline justify-between gap-2 border-t border-border pt-3 text-[13px] hover:underline"
        >
          <span>
            <span className="text-muted-foreground">Before that · </span>
            {session.planned_workout_name ?? 'Unplanned session'}
          </span>
          <span className="num text-[12px] text-muted-foreground">{formatShortDate(session.performed_on)}</span>
        </a>
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
    Promise.all([api.week(today), api.bodyweight(today, 28), api.nutrition(today), api.recentTraining(2)]).then(
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
      <LoadError what="the week" detail={error} />
    ) : (
      <Skeleton label="Loading the week…" blocks={['h-8 w-80', 'h-24', 'h-40', 'h-60']} />
    )
  }

  const { week, bodyweight, nutrition, recent } = loaded
  const columns = {
    '--week-cols': week.days.map((day) => (hasTraining(day) ? 'minmax(0,1.35fr)' : 'minmax(0,0.8fr)')).join(' '),
  } as CSSProperties

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="t-title">{formatLongDate(week.date)}</h1>
          <p className="t-meta">
            {week.program ? week.program.name : 'No program'}
            <span className="num"> · {formatRange(week.week_start, week.week_end)}</span>
          </p>
        </div>
        <BlockStatus week={week} />
      </header>
      {week.program && !week.block && (
        <p className="t-micro">The block start date is not set yet, so weeks are not numbered.</p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}

      <TodayBand week={week} busy={busy} onOpen={(session) => void open(session)} onUnplanned={() => void startUnplanned()} />

      <section aria-labelledby="week-title" className="flex flex-col gap-3">
        <h2 id="week-title" className="sr-only">
          This week
        </h2>
        <ol aria-label="This week" style={columns} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:[grid-template-columns:var(--week-cols)]">
          {week.days.map((day) => (
            <DayTile key={day.date} day={day} today={week.date} busy={busy} onOpen={(session) => void open(session)} />
          ))}
        </ol>
        {week.unscheduled.length > 0 && (
          <div className="flex flex-wrap items-start gap-6 rounded-[10px] border border-dashed border-border-strong p-3.5">
            <p className="t-micro pt-0.5">No fixed day</p>
            {week.unscheduled.map((session) => (
              <SessionCell key={session.planned_workout_id} session={session} busy={busy} onOpen={(item) => void open(item)} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Bodyweight" href="#/bodyweight" linkLabel="Log weight" testId="home-bodyweight">
          <BodyweightSummary data={bodyweight} />
        </Card>
        <Card title="Nutrition today" href="#/nutrition" linkLabel="Log food" testId="home-nutrition">
          <NutritionSummary data={nutrition} />
        </Card>
        <Card title="Recent training" href="#/history" linkLabel="History" testId="home-recent">
          <RecentTraining sessions={recent} />
        </Card>
      </div>
    </div>
  )
}
