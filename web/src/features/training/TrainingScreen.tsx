import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Moon } from 'lucide-react'
import { api } from '@/api/client'
import type { Week, WeekDay, WeekSession } from '@/api/types'
import { Button } from '@/components/ui/button'
import { LoadError, Skeleton } from '@/components/app/primitives'
import { addDays, blockEnd, daysBetween, formatRange, formatShortDate, localDate } from '@/lib/format'
import { TRAINING_HREF, weekHref, workoutHref } from '@/lib/route'
import { isShort, message, setCounts, useOpenSession, type OpenSession } from './shared'

/** Where a week sits relative to the current one: it decides what a tile may offer. */
type WeekMode = 'current' | 'past' | 'future'

const quiet =
  'press rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-sunken hover:text-foreground disabled:opacity-45'

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
  let action: ReactNode = null
  if (done && session.workout_id) {
    action = (
      <>
        <a
          href={workoutHref(session.workout_id)}
          aria-label={`View ${session.name}`}
          className="press inline-flex h-7 items-center rounded-md bg-card px-2.5 text-[12px] font-semibold shadow-[0_0_0_1px_var(--border-strong)] hover:bg-sunken"
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
        className="h-7 rounded-md px-2.5 text-[12px]"
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
        className="h-7 rounded-md px-2.5 text-[12px]"
        isDisabled={busy}
        aria-label={`Start ${session.name}`}
        onPress={() => onOpen(session)}
      >
        Start
      </Button>
    )
  }
  // A status badge only where there is a status to report: done, shortened, a draft. Not yet
  // recorded is plain words.
  const badge =
    tone === 'ok'
      ? 'rounded-md px-1.5 py-0.5 bg-emerald-100 text-emerald-800'
      : short
        ? 'rounded-md px-1.5 py-0.5 bg-warn-surface text-warn'
        : tone === 'warn'
          ? 'rounded-md px-1.5 py-0.5 border border-dashed border-emerald-600/60 bg-emerald-50 text-emerald-800'
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
        <span className={`inline-flex items-center gap-1 font-semibold ${badge}`}>
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
    ? 'bg-card shadow-[var(--shadow-glow)] ring-2 ring-emerald-500/70'
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
      className={`relative flex min-h-44 flex-col gap-3 rounded-[12px] p-3.5 transition-[transform,box-shadow] duration-150 ease-[var(--ease-out)] ${surface} ${
        training && !outside ? 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]' : ''
      }`}
    >
      <p className="flex items-center justify-between text-[12px] leading-4">
        <span className={`font-semibold ${isToday ? 'text-emerald-700' : past ? 'text-faint' : 'text-muted-foreground'}`}>
          {day.weekday.slice(0, 3)}
          {isToday && <span className="ml-1.5">Today</span>}
        </span>
        <span
          className={`num flex size-7 items-center justify-center rounded-md text-[13px] font-semibold transition-colors duration-200 ${
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
        <SessionCell key={session.planned_workout_id} session={session} day={day} mode={mode} today={today} busy={busy} onOpen={onOpen} />
      ))}
      {day.unplanned.map((item) => (
        <a key={item.workout_id} href={workoutHref(item.workout_id)} className="flex items-center gap-1.5 text-[13px] font-medium hover:underline">
          <span aria-hidden className={`size-1.5 rounded-full ${item.status === 'complete' ? 'bg-ok' : 'bg-emerald-400'}`} />
          Unplanned · {item.status === 'complete' ? 'done' : 'draft'}
        </a>
      ))}
    </li>
  )
}

/** One segment per block week: finished weeks deep emerald, this week bright, the rest to come. */
function BlockRail({ week, weeks }: { week: number; weeks: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: weeks }, (_, index) => (
        <span
          key={index}
          className={`h-1.5 rounded-sm transition-all duration-300 ${
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

/** Block progress: where this week sits in the block, and what this week has recorded. */
function BlockStatus({ week }: { week: Week }) {
  const { block, program } = week
  if (!program || !block) return null
  const weeks = block.weeks ?? program.duration_weeks
  let line: ReactNode
  if (block.phase === 'pre_block') {
    const days = daysBetween(week.today, block.start_on)
    line = (
      <p data-testid="block-phase" className="num text-[13px] text-muted-foreground">
        Before the block · starts <span className="font-medium text-foreground">{formatShortDate(block.start_on)}</span>
        {days > 0 && ` · in ${days} ${days === 1 ? 'day' : 'days'}`}
      </p>
    )
  } else if (block.phase === 'post_block' && weeks !== null) {
    line = (
      <p data-testid="block-phase" className="num text-[13px] text-muted-foreground">
        After the block · finished <span className="font-medium text-foreground">{formatShortDate(blockEnd(block.start_on, weeks))}</span>
      </p>
    )
  } else {
    const inBlock = [
      ...week.days.filter((day) => day.phase === null || day.phase === 'block').flatMap((day) => day.sessions),
      ...week.unscheduled,
    ]
    const done = inBlock.filter((session) => session.status === 'complete').length
    line = (
      <p data-testid="week-sessions-done" className="num text-[13px] text-muted-foreground">
        <span className="font-semibold text-foreground">{done}</span> of {inBlock.length} sessions done this week
      </p>
    )
  }
  const railWeek = block.phase === 'pre_block' ? 0 : block.phase === 'post_block' && weeks !== null ? weeks + 1 : block.week
  return (
    <div className="flex flex-col items-end gap-2">
      {weeks !== null && <BlockRail week={railWeek} weeks={weeks} />}
      {line}
    </div>
  )
}

/** ‹ previous week · This week · next week › — every week of the block is one click away. */
function WeekNav({ week }: { week: Week }) {
  const link =
    'press inline-flex size-8 items-center justify-center rounded-md bg-card text-muted-foreground shadow-[0_1px_2px_rgb(16_52_38/0.08),0_0_0_1px_rgb(16_52_38/0.06)] hover:text-emerald-700'
  return (
    <nav aria-label="Weeks" className="flex items-center gap-1.5">
      <a href={weekHref(addDays(week.week_start, -7))} aria-label="Previous week" className={link}>
        <ChevronLeft className="size-4" aria-hidden />
      </a>
      <a
        href={TRAINING_HREF}
        aria-current={week.is_current_week ? 'page' : undefined}
        className={`press inline-flex h-8 items-center rounded-md px-3 text-[13px] font-semibold ${
          week.is_current_week
            ? 'pointer-events-none bg-emerald-100/80 text-emerald-800'
            : 'bg-card text-foreground shadow-[0_1px_2px_rgb(16_52_38/0.08),0_0_0_1px_rgb(16_52_38/0.06)] hover:text-emerald-700'
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

/** Training: the block week, its Monday–Sunday schedule, and every way into a session. */
export function TrainingScreen({ week: requested = null }: { week?: string | null }) {
  const [week, setWeek] = useState<Week | null>(null)
  const today = localDate()
  const { busy, error, setError, open, startUnplanned } = useOpenSession(today)

  // App keys this screen by week, so a new week always starts from a fresh, empty state.
  const load = useCallback(() => {
    api.week(requested ?? today, today).then(setWeek, (failure: unknown) => setError(message(failure)))
  }, [requested, today, setError])

  useEffect(load, [load])

  if (!week) {
    return error ? (
      <LoadError what="the week" detail={error} />
    ) : (
      <Skeleton label="Loading the week…" blocks={['h-8 w-80', 'h-52']} />
    )
  }

  // Judged against the day the week was loaded for, so past/future never disagree with it.
  const mode: WeekMode = week.is_current_week ? 'current' : week.week_start < week.today ? 'past' : 'future'
  const columns = {
    '--week-cols': week.days.map((day) => (hasTraining(day) ? 'minmax(0,1.35fr)' : 'minmax(0,0.8fr)')).join(' '),
  } as CSSProperties
  const weeks = week.block?.weeks ?? week.program?.duration_weeks ?? null
  const inBlock = week.block !== null && week.block.phase === 'block'

  return (
    <div className="enter flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title" data-testid={inBlock ? 'block-week' : undefined}>
            {inBlock && week.block ? `Week ${week.block.week}${weeks !== null ? ` of ${weeks}` : ''}` : formatRange(week.week_start, week.week_end)}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <WeekNav week={week} />
            <p className="t-meta">
              {week.program ? week.program.name : 'No program'}
              {inBlock && <span className="num"> · {formatRange(week.week_start, week.week_end)}</span>}
            </p>
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
      {mode !== 'current' && (
        <p data-testid="week-mode" className="t-meta -mt-2">
          {mode === 'past'
            ? 'A past week: what was recorded, and what was not. Sessions are dated the day they were logged.'
            : 'A week still to come: the plan only. Sessions start from the current week.'}
        </p>
      )}

      <section aria-labelledby="week-title" className="flex flex-col gap-3">
        <h2 id="week-title" className="sr-only">
          Schedule
        </h2>
        <ol aria-label="This week" style={columns} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:[grid-template-columns:var(--week-cols)]">
          {week.days.map((day) => (
            <DayTile key={day.date} day={day} today={week.today} mode={mode} busy={busy} onOpen={open} />
          ))}
        </ol>
        {week.unscheduled.length > 0 && (
          <div className="flex flex-wrap items-start gap-6 rounded-[12px] bg-white/45 p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.7)]">
            <p className="t-micro pt-0.5">No fixed day</p>
            {week.unscheduled.map((session) => (
              <SessionCell key={session.planned_workout_id} session={session} day={null} mode={mode} today={week.today} busy={busy} onOpen={open} />
            ))}
          </div>
        )}
      </section>
      {mode === 'current' && (
        <p className="t-micro">
          Training outside the plan?{' '}
          <button type="button" disabled={busy} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50" onClick={startUnplanned}>
            Start an unplanned session
          </button>
        </p>
      )}
    </div>
  )
}
