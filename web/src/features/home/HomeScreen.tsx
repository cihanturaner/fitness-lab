import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Dumbbell, Plus, Scale } from 'lucide-react'
import { api } from '@/api/client'
import type { Bodyweight, Nutrition, NutritionReview, RecentSession, Week, WeekSession } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Sparkline } from '@/components/chart/Sparkline'
import { EmptyState, LoadError, Meter, ProgressRing, Skeleton } from '@/components/app/primitives'
import { AnimatedNumber } from '@/components/app/AnimatedNumber'
import { blockEnd, compactSet, daysBetween, exerciseLabel, formatLongDate, formatShortDate, localDate, signed } from '@/lib/format'
import { macroCalories } from '@/lib/macros'
import { TRAINING_HREF, historyHref, workoutHref } from '@/lib/route'
import { isShort, message, setCounts, useOpenSession, type OpenSession } from '@/features/training/shared'

type Loaded = {
  week: Week
  bodyweight: Bodyweight
  nutrition: Nutrition
  recent: RecentSession[]
  review: NutritionReview | null
}

/** A summary card: one metric area with its own way in. */
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
    <section data-testid={testId} aria-label={title} className="surface lift flex flex-col gap-4 p-5">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="t-section">{title}</h2>
        <a href={href} className="group/link inline-flex items-center gap-0.5 text-[13px] font-semibold text-emerald-700 hover:text-emerald-800">
          {linkLabel}
          <ChevronRight className="size-3.5 transition-transform duration-150 group-hover/link:translate-x-0.5" aria-hidden />
        </a>
      </header>
      {children}
    </section>
  )
}

/** The one thing to do now: start, continue, review — or rest. Next is small context. */
function TodayHero({
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
  const next = all.find(({ session, date }) => session.status === 'not_started' && date !== null && date > today && inBlock(date))
  const block = week.block
  const weeks = block?.weeks ?? week.program?.duration_weeks ?? null

  type Tone = 'go' | 'draft' | 'done' | 'short' | 'quiet'
  let kicker: { text: string; tone: Tone }
  // The share of the open session's working sets already saved (a draft only).
  let progress: number | null = null
  let title: ReactNode
  let meta: ReactNode = null
  let action: ReactNode = null

  const primary =
    'press inline-flex h-11 items-center gap-2 rounded-[10px] bg-white px-5 text-[14px] font-semibold text-emerald-800 shadow-[0_1px_2px_rgb(15_63_48/0.25),0_10px_24px_-12px_rgb(0_0_0/0.45)] hover:bg-emerald-50 disabled:opacity-60'
  const plan = (session: WeekSession) => <span className="num">{setCounts(session)}</span>

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
        {plan(session)} · started {session.workout_on ? formatShortDate(session.workout_on) : 'earlier'}
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
      <a href={workoutHref(stale.workout_id)} aria-label={`Open the ${stale.name} draft from ${formatShortDate(stale.performed_on)}`} className={primary}>
        Open draft
        <ChevronRight className="size-4" aria-hidden />
      </a>
    )
  } else if (block && todayDay?.phase === 'pre_block') {
    const days = daysBetween(today, block.start_on)
    kicker = { text: 'Before the block', tone: 'quiet' }
    title = `Block starts ${formatShortDate(block.start_on)}`
    meta = `${days === 1 ? 'Tomorrow' : `In ${days} days`}. Anything logged before then is kept as pre-block training.`
  } else if (block && todayDay?.phase === 'post_block') {
    kicker = { text: 'Block complete', tone: 'done' }
    title = weeks !== null ? `${weeks} weeks finished ${formatShortDate(blockEnd(block.start_on, weeks))}` : 'Block finished'
    meta = (
      <>
        Set the next block start in{' '}
        <a href="#/settings" className="font-semibold text-white underline underline-offset-2">
          Settings
        </a>
        ; programs are imported from the command line.
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
    const short = isShort(todays)
    // A shortened session is never presented as a full "Done".
    kicker = short ? { text: 'Shortened', tone: 'short' } : { text: 'Done today', tone: 'done' }
    title = todays.name
    meta = short ? <>Completed with {plan(todays)}</> : plan(todays)
    action = todays.workout_id ? (
      <a
        href={workoutHref(todays.workout_id)}
        aria-label={`Review ${todays.name}`}
        className="press inline-flex h-11 items-center rounded-[10px] bg-white/12 px-4 text-[14px] font-semibold text-white ring-1 ring-white/30 hover:bg-white/20"
      >
        Review session
      </a>
    ) : null
  } else {
    kicker = { text: 'Today', tone: 'quiet' }
    title = 'Rest day'
    meta = 'Nothing planned today.'
  }

  const badge = {
    go: 'bg-white/14 text-white ring-white/20',
    draft: 'bg-white/14 text-white ring-white/20',
    done: 'bg-white text-emerald-800 ring-white',
    short: 'bg-warn-surface text-warn ring-warn-surface',
    quiet: 'bg-white/10 text-white/85 ring-white/15',
  }[kicker.tone]
  const dot = { go: 'bg-emerald-300', draft: 'bg-amber-300', done: 'bg-emerald-600', short: 'bg-warn', quiet: 'bg-white/50' }[kicker.tone]
  // "Next" is context, shown beside today's answer — never when it would repeat it.
  const showNext = week.program !== null && next !== undefined && next.session !== todays && next.session !== draft?.session

  return (
    <section aria-label="Today" className="hero-surface relative overflow-hidden">
      <div className="grid gap-x-10 gap-y-6 px-8 py-7 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-2">
          <p data-testid="today-status" className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-4 font-semibold ring-1 transition-colors duration-200 ${badge}`}>
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
              // Alone (no primary action), it lines up with the text above rather than its padding.
              className={`h-11 gap-1.5 rounded-[10px] px-3.5 text-[13px] text-white/80 hover:bg-white/10 hover:text-white ${action ? '' : '-ml-3.5'}`}
              isDisabled={busy}
              onPress={onUnplanned}
            >
              <Plus aria-hidden />
              Start unplanned session
            </Button>
          </div>
        </div>
        {showNext && next && (
          <a
            href={TRAINING_HREF}
            data-testid="today-next"
            className="group/next flex flex-col justify-center gap-1 self-stretch rounded-[12px] bg-white/[0.07] px-5 py-4 ring-1 ring-white/12 transition-colors duration-150 hover:bg-white/[0.12]"
          >
            <span className="text-[12px] font-medium text-white/60">Next</span>
            <span className="text-[16px] leading-6 font-semibold text-white">{next.session.name}</span>
            <span className="num text-[13px] text-white/70">
              {formatShortDate(next.date ?? '')} · {setCounts(next.session)}
            </span>
            <span className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold text-white/75 group-hover/next:text-white">
              Training
              <ChevronRight className="size-3.5 transition-transform duration-150 group-hover/next:translate-x-0.5" aria-hidden />
            </span>
          </a>
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
      <EmptyState icon={Scale} title="No weigh-ins yet." className="flex-1 py-3">
        Weigh in tomorrow morning. The 7-day average starts with the first entry.
      </EmptyState>
    )
  }
  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* The source's display metric is the 7-day average, not a single weigh-in. */}
      <p data-testid="home-bw-avg" className="flex flex-col gap-1">
        <span className="t-metric">
          {summary.current_avg_kg ?? '—'}
          <span className="t-unit"> kg</span>
        </span>
        <span className="t-micro">7-day average · {summary.current_count}/7 days</span>
      </p>
      <Sparkline
        label="Bodyweight, recent weeks"
        height={48}
        points={series.map((point) => (point.bodyweight_kg === null ? null : Number(point.bodyweight_kg)))}
        line={series.map((point) => (point.avg7_kg === null ? null : Number(point.avg7_kg)))}
      />
      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3">
        <Figure label="Latest" testId="home-bw-latest">
          {summary.latest.bodyweight_kg} kg <span className="font-normal text-muted-foreground">{formatShortDate(summary.latest.measured_on)}</span>
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
  )
}

const MACRO_COLOR = {
  Protein: 'var(--macro-protein)',
  Carbs: 'var(--macro-carbs)',
  Fat: 'var(--macro-fat)',
} as const

function MacroRow({ label, value, target, testId }: { label: keyof typeof MACRO_COLOR; value: number | null; target: number | null; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div data-testid={testId} className="num flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="flex items-baseline gap-1.5">
          <span aria-hidden className="size-2 self-center rounded-full" style={{ background: MACRO_COLOR[label] }} />
          <span className="text-[13px] text-muted-foreground">{label}</span>
          <span className="text-[14px] leading-5 font-semibold">
            {value ?? '—'}
            <span className="text-[12px] font-medium text-muted-foreground"> g</span>
          </span>
        </span>
        <span className="text-[12px] text-muted-foreground">{target === null ? 'target not set' : `target ${target} g`}</span>
      </div>
      {target === null ? <span className="h-1" /> : <Meter value={value} target={target} height={4} color={MACRO_COLOR[label]} />}
    </div>
  )
}

function NutritionSummary({ data, review }: { data: Nutrition; review: NutritionReview | null }) {
  const { day, target } = data
  const due = review?.review?.decision_due ? review.review : null
  const energy = macroCalories({ protein: day?.protein_g ?? null, carbs: day?.carbs_g ?? null, fat: day?.fat_g ?? null })
  const kcal = day ? day.calories_kcal : null
  const notes = [
    !day ? 'Nothing logged today.' : null,
    target === null ? 'No macro target set yet.' : null,
  ].filter((note): note is string => note !== null)
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center gap-5">
        {/* Calories are the result of the three macros, so the ring's arc is split by them. */}
        <ProgressRing
          value={kcal ?? 0}
          max={target?.calories_kcal ?? (kcal && kcal > 0 ? kcal : null)}
          size={96}
          stroke={9}
          segments={[
            { value: energy.parts.protein, color: MACRO_COLOR.Protein },
            { value: energy.parts.carbs, color: MACRO_COLOR.Carbs },
            { value: energy.parts.fat, color: MACRO_COLOR.Fat },
          ]}
          label={kcal === null ? 'No calories logged today' : `${kcal} kcal from macros`}
        >
          <span data-testid="home-nut-kcal" className="num flex flex-col items-center">
            {kcal === null ? (
              <span className="text-[22px] leading-7 font-semibold text-faint">—</span>
            ) : (
              <AnimatedNumber value={kcal} className="text-[22px] leading-7 font-semibold tracking-[-0.03em]" />
            )}
            <span className="text-[11px] font-medium text-muted-foreground">
              {target === null ? 'kcal' : `of ${target.calories_kcal}`}
            </span>
          </span>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <MacroRow label="Protein" value={day?.protein_g ?? null} target={target?.protein_g ?? null} testId="home-nut-protein" />
          <MacroRow label="Carbs" value={day?.carbs_g ?? null} target={target?.carbs_g ?? null} testId="home-nut-carbs" />
          <MacroRow label="Fat" value={day?.fat_g ?? null} target={target?.fat_g ?? null} testId="home-nut-fat" />
        </div>
      </div>
      {(notes.length > 0 || due) && (
        <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3 text-[12px] leading-4 text-muted-foreground">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          {due && (
            <a data-testid="home-review-due" href="#/nutrition" className="font-semibold text-emerald-700 hover:underline">
              Weekly review due · week {due.block_week}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function RecentTraining({ sessions }: { sessions: RecentSession[] }) {
  const [latest] = sessions
  if (!latest) {
    return (
      <EmptyState icon={Dumbbell} title="No completed sessions yet." className="flex-1 py-3">
        Complete a workout and its sets appear here.
      </EmptyState>
    )
  }
  const short = latest.planned_work_sets !== null && latest.actual_work_sets < latest.planned_work_sets
  return (
    <div data-testid="recent-session" className="flex flex-1 flex-col gap-3">
      <a href={workoutHref(latest.workout_id)} className="group/recent flex flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[16px] leading-6 font-semibold tracking-[-0.015em] group-hover/recent:text-emerald-700">
            {latest.planned_workout_name ?? 'Unplanned session'}
          </span>
          <span className="num text-[12px] text-muted-foreground">{formatShortDate(latest.performed_on)}</span>
        </span>
        {short ? (
          <span data-testid="recent-shortfall" className="num text-[12px] font-medium text-warn">
            Shortened: {latest.actual_work_sets} of {latest.planned_work_sets} planned working sets
          </span>
        ) : (
          <span className="num text-[12px] text-muted-foreground">
            {latest.actual_work_sets} working {latest.actual_work_sets === 1 ? 'set' : 'sets'}
          </span>
        )}
      </a>
      <ul className="num flex flex-col text-[13px] leading-[18px]">
        {latest.exercises.slice(0, 3).map((group, index) => (
          <li key={`${index}:${group.exercise.id}`} className="flex items-baseline justify-between gap-3 border-t border-border/80 py-1.5">
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
      <p className="t-micro mt-auto">
        lb × reps @ RIR
        {latest.exercises.length > 3 && (
          <>
            {' · '}
            <a href={workoutHref(latest.workout_id)} className="font-medium hover:text-emerald-700">
              +{latest.exercises.length - 3} more
            </a>
          </>
        )}
      </p>
    </div>
  )
}

/**
 * Home answers three questions and nothing else: what to do today, how today's workout
 * stands, and the key current numbers. The week's schedule lives on Training.
 */
export function HomeScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const today = localDate()
  const { busy, error, setError, open, startUnplanned } = useOpenSession(today)

  useEffect(() => {
    let live = true
    Promise.all([
      api.week(today, today),
      api.bodyweight(today, 28),
      api.nutrition(today),
      api.recentTraining(1),
      api.nutritionReview(today).catch(() => null),
    ]).then(
      ([week, bodyweight, nutrition, recent, review]) => live && setLoaded({ week, bodyweight, nutrition, recent, review }),
      (failure: unknown) => live && setError(message(failure)),
    )
    return () => {
      live = false
    }
  }, [today, setError])

  if (!loaded) {
    return error ? <LoadError what="today" detail={error} /> : <Skeleton label="Loading today…" blocks={['h-8 w-80', 'h-44', 'h-64']} />
  }

  const { week } = loaded
  const weeks = week.block?.weeks ?? week.program?.duration_weeks ?? null
  // One line of context, never navigation: which block week today falls in.
  const context = week.block?.phase === 'block' ? `Block week ${week.block.week}${weeks !== null ? ` of ${weeks}` : ''}` : null

  return (
    <div className="enter flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
        <h1 className="t-title">{formatLongDate(today)}</h1>
        {context && (
          <p data-testid="home-context" className="t-meta num">
            {context}
          </p>
        )}
      </header>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <TodayHero week={week} busy={busy} onOpen={open} onUnplanned={startUnplanned} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Bodyweight" href="#/bodyweight" linkLabel="Log weight" testId="home-bodyweight">
          <BodyweightSummary data={loaded.bodyweight} />
        </Card>
        <Card title="Nutrition today" href="#/nutrition" linkLabel="Log food" testId="home-nutrition">
          <NutritionSummary data={loaded.nutrition} review={loaded.review} />
        </Card>
        <Card title="Recent training" href="#/history" linkLabel="History" testId="home-recent">
          <RecentTraining sessions={loaded.recent} />
        </Card>
      </div>
    </div>
  )
}
