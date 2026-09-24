import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Dumbbell, Moon, Plus, Scale } from 'lucide-react'
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
import { EmptyState, LoadError, Meter, ProgressRing, Skeleton } from '@/components/app/primitives'
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
import { macroCalories } from '@/lib/macros'
import { AnimatedNumber } from '@/components/app/AnimatedNumber'
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
    <section data-testid={testId} aria-label={title} className="surface lift flex min-h-64 flex-col gap-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <h2 className="t-section">{title}</h2>
        <a
          href={href}
          className="group/link press -mr-1 inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100"
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
    'press rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-sunken hover:text-foreground disabled:opacity-45'
  let action: ReactNode = null
  if (done && session.workout_id) {
    action = (
      <>
        <a
          href={workoutHref(session.workout_id)}
          aria-label={`View ${session.name}`}
          className="press inline-flex h-7 items-center rounded-full bg-card px-3 text-[12px] font-semibold shadow-[0_0_0_1px_var(--border-strong)] hover:bg-sunken"
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
        className="h-7 rounded-full px-3 text-[12px]"
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
        variant={day?.date === today ? 'default' : 'outline'}
        className="h-7 rounded-full px-3 text-[12px]"
        isDisabled={busy}
        aria-label={`Start ${session.name}`}
        onPress={() => onOpen(session)}
      >
        Start
      </Button>
    )
  }
  // A restrained but unmistakable status: a filled pill for done, amber for shortened, a
  // dashed emerald outline for a draft, plain words for everything not yet recorded.
  const pill =
    tone === 'ok'
      ? 'bg-emerald-100 text-emerald-800'
      : short
        ? 'bg-warn-surface text-warn'
        : tone === 'warn'
          ? 'border border-dashed border-emerald-600/60 bg-emerald-50 text-emerald-800'
          : 'text-muted-foreground'
  const recorded = session.status !== 'not_started' && session.planned_work_sets > 0
  const share = recorded ? Math.min((session.actual_work_sets ?? 0) / session.planned_work_sets, 1) : 0
  return (
    <div data-testid={`planned-${session.workout_key}`} data-status={session.status} className="flex flex-1 flex-col gap-1.5">
      <p className="text-[15px] leading-5 font-semibold tracking-[-0.015em]">{session.name}</p>
      <p data-testid="session-sets" className={`num text-[12px] leading-4 ${short ? 'font-medium text-warn' : 'text-muted-foreground'}`}>
        {setCounts(session)}
      </p>
      {recorded && (
        <span className="relative h-1 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span
            className={`fill-in absolute inset-y-0 left-0 rounded-full ${short ? 'bg-warn' : draft ? 'bg-emerald-500' : 'bg-emerald-600'}`}
            style={{ width: `${share * 100}%` }}
          />
        </span>
      )}
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] leading-4">
        <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${tone === 'muted' && !short ? '' : 'px-2 py-0.5'} ${pill}`}>
          {done && !short && <Check className="pop-in size-3" strokeWidth={3} aria-hidden />}
          {short && <ShortMark />}
          {tone === 'muted' && !short && <span aria-hidden className="size-1.5 rounded-full border border-faint" />}
          <span data-testid="session-status">{label}</span>
        </span>
        {session.workout_on && session.status !== 'not_started' && (
          <span className="num text-muted-foreground">{formatShortDate(session.workout_on)}</span>
        )}
      </p>
      {action && <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">{action}</div>}
    </div>
  )
}

/** A half-filled circle: completed, but with fewer working sets than planned. */
function ShortMark() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
      <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1.25a4.75 4.75 0 0 1 0 9.5z" fill="currentColor" />
    </svg>
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
  const complete = training && !outside && day.sessions.length > 0 && day.sessions.every((session) => session.status === 'complete')
  const surface = isToday
    ? 'bg-card shadow-[var(--shadow-glow)] ring-2 ring-emerald-500/70 lg:-translate-y-1'
    : !training || outside
      ? 'bg-white/35 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.6)]'
      : draft
        ? 'bg-card shadow-[var(--shadow-card)] outline-2 outline-offset-[-2px] outline-dashed outline-emerald-600/45'
        : complete
          ? 'bg-gradient-to-b from-emerald-50 to-card shadow-[var(--shadow-card)]'
          : past && mode !== 'future'
            ? 'bg-card/75 shadow-[var(--shadow-card)]'
            : 'bg-card shadow-[var(--shadow-card)]'
  return (
    <li
      data-testid={`day-${day.weekday.toLowerCase()}`}
      aria-current={isToday ? 'date' : undefined}
      className={`relative flex min-h-44 flex-col gap-3 rounded-[18px] p-3.5 transition-[transform,box-shadow] duration-200 ease-[var(--ease-out)] ${surface} ${
        training && !outside && !isToday ? 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]' : ''
      }`}
    >
      <p className="flex items-center justify-between text-[12px] leading-4">
        <span className={`font-semibold ${isToday ? 'text-emerald-700' : past ? 'text-faint' : 'text-muted-foreground'}`}>
          {day.weekday.slice(0, 3)}
          {isToday && <span className="ml-1.5">Today</span>}
        </span>
        <span
          className={`num flex size-7 items-center justify-center rounded-full text-[13px] font-semibold ${
            isToday
              ? 'bg-gradient-to-b from-emerald-600 to-emerald-700 text-white shadow-[0_4px_10px_-4px_rgb(27_104_79/0.7)]'
              : complete
                ? 'bg-emerald-600 text-white'
                : past
                  ? 'text-faint'
                  : 'text-foreground/80'
          }`}
        >
          {dayOfMonth}
        </span>
      </p>
      {!training && (
        <p className="mt-auto flex items-center gap-1.5 pb-1 text-[13px] text-faint">
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
          <span aria-hidden className={`size-1.5 rounded-full ${item.status === 'complete' ? 'bg-ok' : 'bg-emerald-400'}`} />
          Unplanned · {item.status === 'complete' ? 'done' : 'draft'}
        </a>
      ))}
    </li>
  )
}

/** Twelve segments: finished weeks deep emerald, this week bright, the rest still to come. */
function BlockRail({ week, weeks }: { week: number; weeks: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: weeks }, (_, index) => (
        <span
          key={index}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            index + 1 < week
              ? 'w-4 bg-emerald-700'
              : index + 1 === week
                ? 'w-7 bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_0_0_3px_rgb(47_154_114/0.18)]'
                : 'w-4 bg-emerald-900/10'
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
      <p data-testid="block-week" className="num text-[15px] font-semibold tracking-[-0.01em]">
        Week {block.week}
        {weeks !== null && <span className="font-medium text-muted-foreground"> of {weeks}</span>}
      </p>
    </div>
  )
}

/** ‹ previous week · This week · next week › — every week of the block is one click away. */
function WeekNav({ week }: { week: Week }) {
  const link =
    'press inline-flex size-8 items-center justify-center rounded-full bg-card text-muted-foreground shadow-[0_1px_2px_rgb(16_52_38/0.08),0_0_0_1px_rgb(16_52_38/0.05)] hover:text-emerald-700'
  return (
    <nav aria-label="Weeks" className="flex items-center gap-1.5">
      <a href={weekHref(addDays(week.week_start, -7))} aria-label="Previous week" className={link}>
        <ChevronLeft className="size-4" aria-hidden />
      </a>
      <a
        href="#/"
        aria-current={week.is_current_week ? 'page' : undefined}
        className={`press inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold ${
          week.is_current_week
            ? 'pointer-events-none bg-emerald-100/70 text-emerald-800'
            : 'bg-card text-foreground shadow-[0_1px_2px_rgb(16_52_38/0.08),0_0_0_1px_rgb(16_52_38/0.05)] hover:text-emerald-700'
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

/** The one thing to do now, chosen from the week: resume, start, or rest. The page's hero. */
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
  // Sessions of this week inside the block: what the ring counts.
  const planned = all.filter(({ date }) => inBlock(date))
  const doneCount = planned.filter(({ session }) => session.status === 'complete').length

  type Tone = 'go' | 'draft' | 'done' | 'quiet'
  let kicker: { text: string; tone: Tone }
  // The share of the open session's working sets already saved (a draft only).
  let progress: number | null = null
  let countdown: number | null = null
  let title: ReactNode
  let meta: ReactNode = null
  let action: ReactNode = null

  const primary =
    'press inline-flex h-11 items-center gap-2 rounded-[12px] bg-white px-5 text-[14px] font-semibold text-emerald-800 shadow-[0_1px_2px_rgb(15_63_48/0.25),0_10px_24px_-12px_rgb(0_0_0/0.45)] hover:bg-emerald-50 disabled:opacity-60'
  const plan = (session: WeekSession) => <span className="num">{setCounts(session)}</span>
  const nextLine = next ? (
    <>
      Next: <span className="font-semibold text-white">{next.session.name}</span>, {formatShortDate(next.date ?? '')} ·{' '}
      {plan(next.session)}
    </>
  ) : (
    'Nothing else planned this week.'
  )

  if (!week.program) {
    kicker = { text: 'Program', tone: 'quiet' }
    title = <h2>No active program</h2>
    meta = 'Programs are imported and activated from the command line. Unplanned sessions can still be logged.'
  } else if (draft) {
    const { session } = draft
    kicker = { text: 'In progress', tone: 'draft' }
    title = session.name
    progress = session.planned_work_sets > 0 ? Math.min((session.actual_work_sets ?? 0) / session.planned_work_sets, 1) : null
    meta = (
      <>
        Draft from {session.workout_on ? formatShortDate(session.workout_on) : 'earlier'} · {plan(session)}
      </>
    )
    action = (
      <button type="button" className={primary} disabled={busy} aria-label={`Continue ${session.name}`} onClick={() => onOpen(session)}>
        Continue workout
        <ChevronRight className="size-4" aria-hidden />
      </button>
    )
  } else if (stale) {
    kicker = { text: 'Unfinished draft', tone: 'draft' }
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
        className={primary}
      >
        Open draft
      </a>
    )
  } else if (block && todayDay?.phase === 'pre_block') {
    const days = daysBetween(today, block.start_on)
    countdown = days > 0 ? days : null
    kicker = { text: 'Before the block', tone: 'quiet' }
    title = `Block starts ${formatShortDate(block.start_on)}`
    meta = `${days === 1 ? 'Tomorrow' : `In ${days} days`}. Anything logged before then is kept as pre-block training.`
  } else if (block && todayDay?.phase === 'post_block') {
    kicker = { text: 'Block complete', tone: 'done' }
    title = weeks !== null ? `${weeks} weeks finished ${formatShortDate(blockEnd(block.start_on, weeks))}` : 'Block finished'
    meta = (
      <>
        Set the next block start in <a href="#/settings" className="font-semibold text-white underline underline-offset-2">Settings</a>;
        programs are imported from the command line.
      </>
    )
  } else if (todays && todays.status === 'not_started') {
    kicker = { text: 'Today', tone: 'go' }
    title = todays.name
    meta = plan(todays)
    action = (
      <button type="button" className={primary} disabled={busy} aria-label={`Start today: ${todays.name}`} onClick={() => onOpen(todays)}>
        Start workout
        <ChevronRight className="size-4" aria-hidden />
      </button>
    )
  } else if (todays && todays.status === 'complete') {
    kicker = { text: 'Done today', tone: 'done' }
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
        className="press inline-flex h-11 items-center rounded-[12px] bg-white/12 px-4 text-[14px] font-semibold text-white ring-1 ring-white/30 hover:bg-white/20"
      >
        Review session
      </a>
    ) : null
  } else {
    kicker = { text: 'Today', tone: 'quiet' }
    title = 'Rest day'
    meta = nextLine
  }

  const dot = { go: 'bg-emerald-300', draft: 'bg-amber-300', done: 'bg-white', quiet: 'bg-white/50' }[kicker.tone]
  return (
    <section aria-label="Today" className="hero-surface relative overflow-hidden px-8 py-7">
      <div className="relative flex flex-wrap items-center justify-between gap-x-10 gap-y-6">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/14 px-2.5 py-1 text-[12px] leading-4 font-semibold text-white ring-1 ring-white/20">
            <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
            {kicker.text}
          </p>
          <div className="text-[34px] leading-[40px] font-semibold tracking-[-0.03em] text-white">{title}</div>
          {meta && <p className="text-[14px] leading-5 text-white/80">{meta}</p>}
          {progress !== null && (
            <span className="mt-1 h-1.5 w-72 max-w-full overflow-hidden rounded-full bg-white/15" aria-hidden>
              <span className="fill-in block h-full rounded-full bg-white" style={{ width: `${progress * 100}%` }} />
            </span>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {action}
            <Button
              variant="ghost"
              size="sm"
              className="h-11 gap-1.5 rounded-[12px] px-3.5 text-[13px] text-white/85 hover:bg-white/10 hover:text-white"
              isDisabled={busy}
              onPress={onUnplanned}
            >
              <Plus aria-hidden />
              Start unplanned session
            </Button>
          </div>
        </div>
        {countdown !== null && (
          <div className="flex size-32 flex-col items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            <span className="num text-[40px] leading-10 font-semibold tracking-[-0.04em] text-white">{countdown}</span>
            <span className="text-[12px] font-medium text-white/70">{countdown === 1 ? 'day to go' : 'days to go'}</span>
          </div>
        )}
        {week.program && planned.length > 0 && (
          <ProgressRing
            value={doneCount}
            max={planned.length}
            size={128}
            stroke={11}
            track="rgb(255 255 255 / 0.16)"
            color="#ffffff"
            label={`${doneCount} of ${planned.length} sessions done this week`}
          >
            <span className="num text-[32px] leading-9 font-semibold tracking-[-0.03em] text-white">
              {doneCount}
              <span className="text-[18px] text-white/60">/{planned.length}</span>
            </span>
            <span className="text-[12px] font-medium text-white/70">sessions</span>
          </ProgressRing>
        )}
      </div>
    </section>
  )
}

function Figure({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="t-micro">{label}</span>
      <span data-testid={testId} className="num text-[14px] leading-5 font-semibold whitespace-nowrap">
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
        <p data-testid="home-bw-avg" className="flex shrink-0 flex-col gap-1">
          <span className="t-hero">
            {summary.current_avg_kg ?? '—'}
            <span className="t-unit"> kg</span>
          </span>
          <span className="t-micro">7-day average · {summary.current_count}/7 days</span>
        </p>
        <div className="flex flex-col items-end gap-2.5 pt-1.5 text-right">
          <Figure label="Latest" testId="home-bw-latest">
            {summary.latest.bodyweight_kg} kg{' '}
            <span className="font-normal text-muted-foreground">{formatShortDate(summary.latest.measured_on)}</span>
          </Figure>
          <Figure label="14-day trend" testId="home-bw-trend">
            {trend.qualified && trend.pct_bw_per_week !== null ? (
              <span className="text-emerald-700">
                {signed(trend.pct_bw_per_week)}
                <span className="font-normal text-muted-foreground"> % BW/week</span>
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">not enough weigh-ins ({trend.weigh_ins}/14)</span>
            )}
          </Figure>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1.5">
        <Sparkline
          label="Bodyweight, recent weeks"
          height={104}
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

const MACRO_COLOR = {
  Protein: 'var(--macro-protein)',
  Carbs: 'var(--macro-carbs)',
  Fat: 'var(--macro-fat)',
} as const

function MacroRow({
  label,
  value,
  target,
  testId,
}: {
  label: keyof typeof MACRO_COLOR
  value: number | null
  target: number | null
  testId: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div data-testid={testId} className="num flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="flex items-baseline gap-1.5">
          <span aria-hidden className="size-2 self-center rounded-full" style={{ background: MACRO_COLOR[label] }} />
          <span className="text-[13px] text-muted-foreground">{label}</span>
          <span className="text-[15px] leading-5 font-semibold">
            {value ?? '—'}
            <span className="text-[12px] font-medium text-muted-foreground"> g</span>
          </span>
        </span>
        <span className="text-[12px] text-muted-foreground">{target === null ? 'target not set' : `target ${target} g`}</span>
      </div>
      {target === null ? <span className="h-1" /> : <Meter value={value} target={target} height={5} color={MACRO_COLOR[label]} />}
    </div>
  )
}

function NutritionSummary({ data, review }: { data: Nutrition; review: NutritionReview | null }) {
  const { day, targets } = data
  const due = review?.review?.decision_due ? review.review : null
  const energy = macroCalories({ protein: day?.protein_g ?? null, carbs: day?.carbs_g ?? null, fat: day?.fat_g ?? null })
  const kcal = day ? day.calories_kcal : null
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center gap-5">
        {/* Calories are the result of the three macros, so the ring's arc is split by them. */}
        <ProgressRing
          value={kcal ?? 0}
          max={targets.calories_kcal ?? (kcal && kcal > 0 ? kcal : null)}
          size={116}
          stroke={10}
          segments={[
            { value: energy.parts.protein, color: MACRO_COLOR.Protein },
            { value: energy.parts.carbs, color: MACRO_COLOR.Carbs },
            { value: energy.parts.fat, color: MACRO_COLOR.Fat },
          ]}
          label={kcal === null ? 'No calories logged today' : `${kcal} kcal from macros`}
        >
          <span data-testid="home-nut-kcal" className="num flex flex-col items-center">
            {kcal === null ? (
              <span className="text-[26px] leading-7 font-semibold text-faint">—</span>
            ) : (
              <AnimatedNumber value={kcal} className="text-[26px] leading-7 font-semibold tracking-[-0.03em]" />
            )}
            <span className="text-[11px] font-medium text-muted-foreground">
              {targets.calories_kcal === null ? 'kcal' : `of ${targets.calories_kcal} kcal`}
            </span>
          </span>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <MacroRow label="Protein" value={day?.protein_g ?? null} target={targets.protein_g} testId="home-nut-protein" />
          <MacroRow label="Carbs" value={day?.carbs_g ?? null} target={targets.carbs_g} testId="home-nut-carbs" />
          <MacroRow label="Fat" value={day?.fat_g ?? null} target={targets.fat_g} testId="home-nut-fat" />
        </div>
      </div>
      {day && targets.calories_kcal !== null && (
        <p className="well num flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]">
          <span className="text-muted-foreground">{day.calories_kcal <= targets.calories_kcal ? 'Left to target' : 'Over target'}</span>
          <span className="font-semibold">
            {Math.abs(targets.calories_kcal - day.calories_kcal)} kcal
            {day.protein_g !== null && day.protein_g < targets.protein_g && (
              <span className="font-normal text-muted-foreground"> · protein {targets.protein_g - day.protein_g} g to go</span>
            )}
          </span>
        </p>
      )}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3 text-[12px] leading-4 text-muted-foreground">
        {!day && <p>Nothing logged today.</p>}
        {day && (
          <p className="num">
            Calories from macros: {energy.parts.protein} + {energy.parts.carbs} + {energy.parts.fat} kcal
            {!day.calories_complete && ' (not every macro recorded)'}
          </p>
        )}
        {targets.calories_kcal === null && <p>Calorie target not calibrated yet.</p>}
        {due && (
          <a data-testid="home-review-due" href="#/nutrition" className="font-semibold text-emerald-700 hover:underline">
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
  const short = latest.planned_work_sets !== null && latest.actual_work_sets < latest.planned_work_sets
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div data-testid="recent-session" className="flex flex-col gap-2.5">
        <a href={workoutHref(latest.workout_id)} className="group/recent flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold tracking-[-0.01em] group-hover/recent:text-emerald-700">
            {latest.planned_workout_name ?? 'Unplanned session'}
          </span>
          <span className="num text-[12px] text-muted-foreground">{formatShortDate(latest.performed_on)}</span>
        </a>
        {short && (
          <p data-testid="recent-shortfall" className="num w-fit rounded-full bg-warn-surface px-2 py-0.5 text-[12px] font-medium text-warn">
            Shortened: {latest.actual_work_sets} of {latest.planned_work_sets} planned working sets
          </p>
        )}
        <ul className="num flex flex-col text-[13px] leading-[18px]">
          {latest.exercises.slice(0, 5).map((group) => (
            <li key={group.exercise.id} className="flex items-baseline justify-between gap-3 border-b border-border/70 py-1.5 last:border-b-0">
              <a href={historyHref(group.exercise.id)} className="min-w-0 truncate text-muted-foreground hover:text-emerald-700">
                {exerciseLabel(group.exercise)}
              </a>
              <span className="shrink-0 text-[12px] font-semibold">
                {group.sets
                  .filter((performed) => performed.set_type !== 'warmup')
                  .map(compactSet)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        <p className="t-micro">Working sets · lb × reps @ RIR</p>
        {latest.exercises.length > 5 && (
          <a href={workoutHref(latest.workout_id)} className="text-[12px] font-medium text-muted-foreground hover:text-emerald-700">
            +{latest.exercises.length - 5} more exercises
          </a>
        )}
      </div>
      {earlier.map((session) => (
        <a
          key={session.workout_id}
          data-testid="recent-session"
          href={workoutHref(session.workout_id)}
          className="well mt-auto flex items-baseline justify-between gap-2 px-3 py-2.5 text-[13px] hover:bg-emerald-50"
        >
          <span>
            <span className="text-muted-foreground">Before that · </span>
            <span className="font-medium">{session.planned_workout_name ?? 'Unplanned session'}</span>
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
    <div className="enter flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-2">
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
        <p className="t-micro -mt-3">
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
        <ol aria-label="This week" style={columns} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:[grid-template-columns:var(--week-cols)]">
          {week.days.map((day) => (
            <DayTile key={day.date} day={day} today={week.today} mode={mode} busy={busy} onOpen={onOpen} />
          ))}
        </ol>
        {week.unscheduled.length > 0 && (
          <div className="flex flex-wrap items-start gap-6 rounded-[18px] bg-white/45 p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.7)]">
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
        <div className="grid gap-5 lg:grid-cols-3">
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
