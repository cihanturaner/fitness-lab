import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Dumbbell, Moon, Plus, Scale } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type {
  Bodyweight,
  Nutrition,
  NutritionReview,
  RecentSession,
  Week,
  WeekDay,
  WeekSession,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import { Sparkline } from '@/components/chart/Sparkline'
import { EmptyState, LoadError, Meter, Skeleton } from '@/components/app/primitives'
import {
  addDays,
  blockEnd,
  compactSet,
  daysBetween,
  exerciseLabel,
  formatLongDate,
  formatRange,
  formatShortDate,
  localDate,
  signed,
} from '@/lib/format'
import { historyHref, navigate, weekHref, workoutHref } from '@/lib/route'

/** The summary cards describe today, so they load only on the current week. */
type Today = { bodyweight: Bodyweight; nutrition: Nutrition; recent: RecentSession[]; review: NutritionReview | null }
type Loaded = { week: Week; today: Today | null }
/** Where a week sits relative to the current one: it decides what a tile may offer. */
type WeekMode = 'current' | 'past' | 'future'
type OpenSession = (session: WeekSession, performedOn?: string) => void

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

/** "2 of 23 working sets": what was recorded against the plan, never the plan alone. */
function setCounts(session: WeekSession): string {
  if (session.status === 'not_started') return `${session.slot_count} exercises · ${session.planned_work_sets} sets`
  return `${session.actual_work_sets ?? 0} of ${session.planned_work_sets} working sets`
}

function isShort(session: WeekSession): boolean {
  return session.status === 'complete' && (session.actual_work_sets ?? 0) < session.planned_work_sets
}

function SessionCell({
  session,
  day,
  mode,
  today,
  busy,
  onOpen,
}: {
  session: WeekSession
  day: WeekDay | null
  mode: WeekMode
  today: string
  busy: boolean
  onOpen: OpenSession
}) {
  const done = session.status === 'complete'
  const draft = session.status === 'draft'
  const short = isShort(session)
  const outside = day?.phase === 'pre_block' || day?.phase === 'post_block'
  const otherDraft = session.status === 'not_started' ? session.open_draft_on : null
  let label: string
  let tone: 'ok' | 'warn' | 'muted'
  if (done) {
    label = short ? 'Shortened' : 'Done'
    tone = short ? 'muted' : 'ok'
  } else if (draft) {
    label = 'Draft'
    tone = 'warn'
  } else if (otherDraft) {
    label = `Draft ${formatShortDate(otherDraft)}`
    tone = 'warn'
  } else if (outside) {
    label = day?.phase === 'pre_block' ? 'Before block' : 'After block'
    tone = 'muted'
  } else {
    label = mode === 'future' ? 'Planned' : mode === 'past' ? 'Not logged' : 'Not started'
    tone = 'muted'
  }
  const quiet =
    'rounded px-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-45'
  let action: ReactNode = null
  if (done && session.workout_id) {
    action = (
      <>
        <a
          href={workoutHref(session.workout_id)}
          aria-label={`View ${session.name}`}
          className="inline-flex h-7 items-center rounded-md border border-border-strong bg-card px-2.5 text-[13px] font-medium hover:bg-sunken"
        >
          View
        </a>
        {mode === 'current' && (
          <button type="button" disabled={busy} aria-label={`Start ${session.name} again`} className={quiet} onClick={() => onOpen(session)}>
            Log again
          </button>
        )}
      </>
    )
  } else if (draft || otherDraft) {
    action = (
      <Button
        size="sm"
        isDisabled={busy}
        aria-label={draft ? `Resume draft of ${session.name}` : `Resume ${session.name} draft from ${formatShortDate(otherDraft ?? '')}`}
        onPress={() => onOpen(session)}
      >
        {draft ? 'Resume' : 'Resume draft'}
      </Button>
    )
  } else if (mode === 'past' && day) {
    action = (
      <button type="button" disabled={busy} aria-label={`Log ${session.name} for ${formatShortDate(day.date)}`} className={quiet} onClick={() => onOpen(session, day.date)}>
        Log for {formatShortDate(day.date)}
      </button>
    )
  } else if (mode === 'current' && outside) {
    if (!day || day.date <= today) {
      action = (
        <button type="button" disabled={busy} aria-label={`Log ${session.name} anyway`} className={quiet} onClick={() => onOpen(session)}>
          Log anyway
        </button>
      )
    }
  } else if (mode === 'current') {
    action = (
      <Button
        size="sm"
        variant="outline"
        className="border-border-strong bg-card hover:bg-sunken"
        isDisabled={busy}
        aria-label={`Start ${session.name}`}
        onPress={() => onOpen(session)}
      >
        Start
      </Button>
    )
  }
  const dot = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-border-strong'
  const text = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-muted-foreground'
  return (
    <div data-testid={`planned-${session.workout_key}`} data-status={session.status} className="flex flex-1 flex-col gap-1">
      <p className="flex items-center gap-1.5 text-[15px] leading-5 font-semibold tracking-[-0.01em]">
        {session.name}
        {done && !short && <CheckCircle2 className="size-4 text-ok" strokeWidth={2.25} aria-hidden />}
      </p>
      <p data-testid="session-sets" className={`num text-[12px] leading-4 ${short ? 'text-foreground' : 'text-muted-foreground'}`}>
        {setCounts(session)}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-4">
        <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
        <span data-testid="session-status" className={`font-medium ${text}`}>
          {label}
        </span>
        {session.workout_on && session.status !== 'not_started' && (
          <span className="num text-muted-foreground">{formatShortDate(session.workout_on)}</span>
        )}
      </p>
      {action && <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3">{action}</div>}
    </div>
  )
}

function hasTraining(day: WeekDay): boolean {
  return day.sessions.length > 0 || day.unplanned.length > 0
}

function DayTile({
  day,
  today,
  mode,
  busy,
  onOpen,
}: {
  day: WeekDay
  today: string
  mode: WeekMode
  busy: boolean
  onOpen: OpenSession
}) {
  const isToday = day.date === today
  const training = hasTraining(day)
  const past = day.date < today
  const dayOfMonth = Number(day.date.split('-')[2])
  const draft = day.sessions.some((session) => session.status === 'draft')
  // Days outside the block recede like rest days unless something was actually recorded.
  const outside =
    (day.phase === 'pre_block' || day.phase === 'post_block') &&
    !day.sessions.some((session) => session.status !== 'not_started') &&
    day.unplanned.length === 0
  const surface = !training || outside
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
        <SessionCell
          key={session.planned_workout_id}
          session={session}
          day={day}
          mode={mode}
          today={today}
          busy={busy}
          onOpen={onOpen}
        />
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
  const weeks = block.weeks ?? program.duration_weeks
  if (block.phase === 'pre_block') {
    const days = daysBetween(week.today, block.start_on)
    return (
      <div className="flex flex-col items-end gap-1.5">
        {weeks !== null && <BlockRail week={0} weeks={weeks} />}
        <p data-testid="block-phase" className="num text-[13px] text-muted-foreground">
          Before the block · starts <span className="font-medium text-foreground">{formatShortDate(block.start_on)}</span>
          {days > 0 && ` · in ${days} ${days === 1 ? 'day' : 'days'}`}
        </p>
      </div>
    )
  }
  if (block.phase === 'post_block' && weeks !== null) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <BlockRail week={weeks + 1} weeks={weeks} />
        <p data-testid="block-phase" className="num text-[13px] text-muted-foreground">
          After the block · finished <span className="font-medium text-foreground">{formatShortDate(blockEnd(block.start_on, weeks))}</span>
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      {weeks !== null && <BlockRail week={block.week} weeks={weeks} />}
      <p data-testid="block-week" className="num text-[13px] font-medium">
        Week {block.week}
        {weeks !== null && <span className="font-normal text-muted-foreground"> of {weeks}</span>}
      </p>
    </div>
  )
}

/** ‹ previous week · This week · next week › — every week of the block is one click away. */
function WeekNav({ week }: { week: Week }) {
  const link =
    'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sunken hover:text-foreground'
  return (
    <nav aria-label="Weeks" className="flex items-center gap-1">
      <a href={weekHref(addDays(week.week_start, -7))} aria-label="Previous week" className={link}>
        <ChevronLeft className="size-4" aria-hidden />
      </a>
      <a
        href="#/"
        aria-current={week.is_current_week ? 'page' : undefined}
        className={`inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] font-medium ${
          week.is_current_week
            ? 'pointer-events-none border-transparent text-muted-foreground'
            : 'border-border-strong bg-card hover:bg-sunken'
        }`}
      >
        This week
      </a>
      <a href={weekHref(addDays(week.week_start, 7))} aria-label="Next week" className={link}>
        <ChevronRight className="size-4" aria-hidden />
      </a>
    </nav>
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
  onOpen: OpenSession
  onUnplanned: () => void
}) {
  const today = week.today
  const inBlock = (date: string | null) => {
    const phase = week.days.find((day) => day.date === date)?.phase ?? null
    return phase === null || phase === 'block'
  }
  const all = [
    ...week.days.flatMap((day) => day.sessions.map((session) => ({ session, date: day.date as string | null }))),
    ...week.unscheduled.map((session) => ({ session, date: null as string | null })),
  ]
  const todayDay = week.days.find((day) => day.date === today)
  const draft = all.find(({ session }) => session.status === 'draft')
  const stale = week.open_drafts[0]
  const todays = todayDay?.sessions.find((session) => session.status !== 'complete') ?? todayDay?.sessions[0]
  const next = all.find(
    ({ session, date }) => session.status === 'not_started' && date !== null && date > today && inBlock(date),
  )
  const block = week.block
  const weeks = block?.weeks ?? week.program?.duration_weeks ?? null

  let kicker: ReactNode
  let title: ReactNode
  let meta: ReactNode = null
  let action: ReactNode = null

  const plan = (session: WeekSession) => <span className="num">{setCounts(session)}</span>
  const nextLine = next ? (
    <>
      Next: <span className="font-medium text-foreground">{next.session.name}</span>, {formatShortDate(next.date ?? '')} ·{' '}
      {plan(next.session)}
    </>
  ) : (
    'Nothing else planned this week.'
  )

  if (!week.program) {
    kicker = <span className="text-muted-foreground">Program</span>
    title = <h2>No active program</h2>
    meta = 'Programs are imported and activated from the command line. Unplanned sessions can still be logged.'
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
  } else if (stale) {
    kicker = <span className="text-warn">Unfinished draft</span>
    title = stale.name
    meta = (
      <>
        Dated {formatShortDate(stale.performed_on)}
        {stale.block_week !== null && stale.block_week >= 1 ? ` (week ${stale.block_week})` : ''}. Complete or delete it
        before logging {stale.name} again.
      </>
    )
    action = (
      <a
        href={workoutHref(stale.workout_id)}
        aria-label={`Open the ${stale.name} draft from ${formatShortDate(stale.performed_on)}`}
        className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/85"
      >
        Open draft
      </a>
    )
  } else if (block && todayDay?.phase === 'pre_block') {
    const days = daysBetween(today, block.start_on)
    kicker = <span className="text-muted-foreground">Before the block</span>
    title = `Block starts ${formatShortDate(block.start_on)}`
    meta = `${days === 1 ? 'Tomorrow' : `In ${days} days`}. Anything logged before then is kept as pre-block training.`
  } else if (block && todayDay?.phase === 'post_block') {
    kicker = <span className="text-muted-foreground">Block complete</span>
    title = weeks !== null ? `${weeks} weeks finished ${formatShortDate(blockEnd(block.start_on, weeks))}` : 'Block finished'
    meta = (
      <>
        Set the next block start in <a href="#/settings" className="underline">Settings</a>; programs are imported from the command
        line.
      </>
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
    meta = isShort(todays) ? (
      <>
        Shortened: {plan(todays)} · {nextLine}
      </>
    ) : (
      nextLine
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
    meta = nextLine
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
  const { summary, series, trend } = data
  if (!summary.latest) {
    return (
      <EmptyState icon={Scale} title="No weigh-ins yet." className="flex-1 py-4">
        Weigh in tomorrow morning. The 7-day average starts with the first entry.
      </EmptyState>
    )
  }
  const first = series[0]?.date
  const span = first ? daysBetween(first, summary.reference_on) + 1 : 0
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        {/* The source's display metric is the 7-day average, not a single weigh-in. */}
        <p data-testid="home-bw-avg" className="flex shrink-0 flex-col">
          <span className="t-metric">
            {summary.current_avg_kg ?? '—'}
            <span className="t-unit"> kg</span>
          </span>
          <span className="t-micro">7-day average · {summary.current_count}/7 days</span>
        </p>
        <div className="flex flex-col items-end gap-2 pt-1 text-right">
          <Figure label="Latest" testId="home-bw-latest">
            {summary.latest.bodyweight_kg} kg{' '}
            <span className="font-normal text-muted-foreground">{formatShortDate(summary.latest.measured_on)}</span>
          </Figure>
          <Figure label="14-day trend" testId="home-bw-trend">
            {trend.qualified && trend.pct_bw_per_week !== null ? (
              <>
                {signed(trend.pct_bw_per_week)}
                <span className="font-normal text-muted-foreground"> % BW/week</span>
              </>
            ) : (
              <span className="font-normal text-muted-foreground">not enough weigh-ins ({trend.weigh_ins}/14)</span>
            )}
          </Figure>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
        <Sparkline
          label="Bodyweight, recent weeks"
          height={56}
          points={series.map((point) => (point.bodyweight_kg === null ? null : Number(point.bodyweight_kg)))}
          line={series.map((point) => (point.avg7_kg === null ? null : Number(point.avg7_kg)))}
        />
        <p className="t-micro">
          {span >= 28 ? 'Last 4 weeks' : first ? `Since ${formatShortDate(first)}` : ''} · daily weigh-ins and the 7-day
          average
        </p>
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

function NutritionSummary({ data, review }: { data: Nutrition; review: NutritionReview | null }) {
  const { day, targets } = data
  const due = review?.review?.decision_due ? review.review : null
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
        {due && (
          <a data-testid="home-review-due" href="#/nutrition" className="font-medium text-plan hover:underline">
            Weekly review due · week {due.block_week}
          </a>
        )}
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
        {latest.planned_work_sets !== null && latest.actual_work_sets < latest.planned_work_sets && (
          <p data-testid="recent-shortfall" className="num t-micro">
            Shortened: {latest.actual_work_sets} of {latest.planned_work_sets} planned working sets
          </p>
        )}
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
        <p className="t-micro">Working sets · kg × reps @ RIR</p>
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

export function HomeScreen({ week: requested = null }: { week?: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = localDate()
  const shown = requested ?? today

  // App keys this screen by week, so a new week always starts from a fresh, empty state.
  const load = useCallback(() => {
    api.week(shown, today).then(
      async (week) => {
        if (!week.is_current_week) {
          setLoaded({ week, today: null })
          return
        }
        const [bodyweight, nutrition, recent, review] = await Promise.all([
          api.bodyweight(today, 28),
          api.nutrition(today),
          api.recentTraining(2),
          api.nutritionReview(today).catch(() => null),
        ])
        setLoaded({ week, today: { bodyweight, nutrition, recent, review } })
      },
      (failure: unknown) => setError(message(failure)),
    ).catch((failure: unknown) => setError(message(failure)))
  }, [shown, today])

  useEffect(load, [load])

  const open = async (session: WeekSession, performedOn: string = today) => {
    setBusy(true)
    try {
      const result = await api.openPlanned(session.planned_workout_id, performedOn)
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

  const { week } = loaded
  // Judged against the day the week was loaded for, so past/future never disagree with it.
  const mode: WeekMode = week.is_current_week ? 'current' : week.week_start < week.today ? 'past' : 'future'
  const onOpen: OpenSession = (session, performedOn) => void open(session, performedOn)
  const columns = {
    '--week-cols': week.days.map((day) => (hasTraining(day) ? 'minmax(0,1.35fr)' : 'minmax(0,0.8fr)')).join(' '),
  } as CSSProperties
  const weeks = week.block?.weeks ?? week.program?.duration_weeks ?? null
  const title = week.is_current_week
    ? formatLongDate(week.today)
    : week.block && week.block.phase === 'block'
      ? `Week ${week.block.week}${weeks !== null ? ` of ${weeks}` : ''}`
      : formatRange(week.week_start, week.week_end)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="t-title">{title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="t-meta">
              {week.program ? week.program.name : 'No program'}
              <span className="num"> · {formatRange(week.week_start, week.week_end)}</span>
            </p>
            <WeekNav week={week} />
          </div>
        </div>
        <BlockStatus week={week} />
      </header>
      {week.program && !week.block && (
        <p className="t-micro">
          The block start date is not set yet, so weeks are not numbered.{' '}
          <a href="#/settings" className="font-medium text-foreground underline">
            Set it in Settings
          </a>
          .
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}

      {week.is_current_week ? (
        <TodayBand week={week} busy={busy} onOpen={onOpen} onUnplanned={() => void startUnplanned()} />
      ) : (
        <p data-testid="week-mode" className="t-meta">
          {mode === 'past'
            ? 'A past week: what was recorded, and what was not. Sessions are dated the day they were logged.'
            : 'A week still to come: the plan only. Sessions start from the current week.'}
        </p>
      )}

      <section aria-labelledby="week-title" className="flex flex-col gap-3">
        <h2 id="week-title" className="sr-only">
          {week.is_current_week ? 'This week' : 'Week'}
        </h2>
        <ol aria-label="This week" style={columns} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:[grid-template-columns:var(--week-cols)]">
          {week.days.map((day) => (
            <DayTile key={day.date} day={day} today={week.today} mode={mode} busy={busy} onOpen={onOpen} />
          ))}
        </ol>
        {week.unscheduled.length > 0 && (
          <div className="flex flex-wrap items-start gap-6 rounded-[10px] border border-dashed border-border-strong p-3.5">
            <p className="t-micro pt-0.5">No fixed day</p>
            {week.unscheduled.map((session) => (
              <SessionCell
                key={session.planned_workout_id}
                session={session}
                day={null}
                mode={mode}
                today={week.today}
                busy={busy}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </section>

      {loaded.today && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Bodyweight" href="#/bodyweight" linkLabel="Log weight" testId="home-bodyweight">
            <BodyweightSummary data={loaded.today.bodyweight} />
          </Card>
          <Card title="Nutrition today" href="#/nutrition" linkLabel="Log food" testId="home-nutrition">
            <NutritionSummary data={loaded.today.nutrition} review={loaded.today.review} />
          </Card>
          <Card title="Recent training" href="#/history" linkLabel="History" testId="home-recent">
            <RecentTraining sessions={loaded.today.recent} />
          </Card>
        </div>
      )}
    </div>
  )
}
