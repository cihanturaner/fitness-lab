import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { NutritionReview, Review, ReviewDecision, ReviewTrend } from '@/api/types'
import { Button } from '@/components/ui/button'
import { formatRange, formatShortDate, signed } from '@/lib/format'

/**
 * The locked nutrition controller as decision support. It reads the last finished block
 * week and says what the plan recommends; nothing changes until the lifter presses Apply
 * (which appends a calorie target) or Keep current (which records the decision only).
 */

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

/** Source ids with the source's own plain meaning (ui_status_labels, in English). */
const STATUS_TEXT: Record<string, string> = {
  INSUFFICIENT_DATA: 'Insufficient data',
  UNDER_GAIN: 'Slow gain',
  IN_RANGE: 'In range',
  OVER_GAIN: 'Fast gain',
  DIAGNOSTIC_GATE: 'Diagnostic gate',
  COMPOSITION_REASSESSMENT: 'Composition check',
  UNKNOWN: 'Unknown',
}

const CHECK_TEXT: Record<string, string> = {
  tracking_method_consistent: 'Calorie tracking method unchanged',
  food_logging_consistent: 'Foods logged consistently',
  restaurant_unlogged_intake_reviewed: 'Restaurant or unlogged intake reviewed',
  weighing_protocol_consistent: 'Weighing protocol unchanged',
  activity_NEAT_changed: 'Activity / NEAT materially changed',
  training_workload_changed: 'Training workload materially changed',
  sleep_recovery_changed: 'Sleep or recovery materially changed',
  illness_travel: 'Illness or travel disrupted the data',
  adherence_consistent: 'Adherence actually consistent',
}

function trendText(trend: ReviewTrend | null): string {
  if (!trend) return 'No finished block week yet.'
  if (trend.reason === 'WAITING_FOR_NEW_TREND') {
    return 'Waiting for a new 14-day trend after the last calorie change.'
  }
  if (trend.pct_bw_per_week === null) {
    return `Not qualified: ${trend.weigh_ins}/14 weigh-ins (needs 6 in each week: ${trend.first_half} + ${trend.second_half}).`
  }
  return `${signed(trend.pct_bw_per_week)} % BW/week`
}

function recommendation(review: Review): string {
  const current = review.current_target_kcal
  switch (review.recommended_action) {
    case 'ADD_CALORIES':
    case 'REDUCE_CALORIES':
      return `${review.recommended_delta_kcal !== null && review.recommended_delta_kcal > 0 ? '+' : '−'}${Math.abs(
        review.recommended_delta_kcal ?? 0,
      )} kcal/day → ${review.recommended_target_kcal} kcal · carbs ${review.recommended_carbs_g} g · protein 145 g and fat 60 g unchanged`
    case 'NO_CHANGE':
      return `No change: keep ${current} kcal/day`
    case 'STRONGER_REASSESSMENT':
      return 'Reassess more strongly (waist, photos, training) before any change'
    case 'AUDIT_BEFORE_CONTINUING':
      return 'Audit before continuing: no automatic third increase'
    case 'FIX_INPUT_PROBLEM_FIRST':
      return 'Fix the input problem first; no calorie change'
    default:
      return '—'
  }
}

function decisionText(decision: ReviewDecision): string {
  const when = formatShortDate(decision.decided_on)
  if (decision.user_choice === 'APPLIED' && decision.new_calorie_target_kcal !== null) {
    const delta = decision.new_calorie_target_kcal - decision.previous_calorie_target_kcal
    return `Applied ${delta > 0 ? '+' : '−'}${Math.abs(delta)} kcal/day → ${decision.new_calorie_target_kcal} kcal (${when})`
  }
  return `Kept ${decision.previous_calorie_target_kcal} kcal (${when})`
}

function GateAuditForm({
  review,
  data,
  today,
  onSaved,
}: {
  review: Review
  data: NutritionReview
  today: string
  onSaved: () => Promise<void>
}) {
  const [answers, setAnswers] = useState<Record<string, boolean | null>>(() =>
    Object.fromEntries(data.gate_checks.map((name) => [name, null])),
  )
  const [notes, setNotes] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const answered = data.gate_checks.every((name) => answers[name] !== null)
  const reliable =
    answered && data.reliability_checks.every((name) => answers[name] === true) && answers.illness_travel === false

  const record = async (result: 'GENUINE_UNDERFEEDING_CONFIRMED' | 'INPUTS_UNRELIABLE') => {
    setProblem(null)
    try {
      await api.recordGate({
        date: today,
        block_week: review.block_week ?? 0,
        checks: Object.fromEntries(data.gate_checks.map((name) => [name, answers[name] === true])),
        result,
        notes: notes.trim() === '' ? null : notes.trim(),
      })
      await onSaved()
    } catch (failure) {
      setProblem(`Not recorded: ${message(failure)}`)
    }
  }

  return (
    <fieldset aria-label="Diagnostic gate audit" className="flex flex-col gap-3 rounded-[16px] border border-warn/25 bg-warn-surface p-4 text-[13px]">
      <legend className="px-1 font-medium">Audit before continuing</legend>
      <p className="text-muted-foreground">
        Two +150 kcal corrections in a row did not bring the trend into the band. Answer every check; only reliable inputs
        allow another +150.
      </p>
      <ul className="flex flex-col gap-1.5">
        {data.gate_checks.map((name) => (
          <li key={name} className="flex flex-wrap items-center justify-between gap-2">
            <span>{CHECK_TEXT[name] ?? name}</span>
            <span className="flex gap-1" role="radiogroup" aria-label={CHECK_TEXT[name] ?? name}>
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  role="radio"
                  aria-checked={answers[name] === value}
                  className={`press rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                    answers[name] === value ? 'border-foreground bg-card' : 'border-border-strong text-muted-foreground hover:bg-card'
                  }`}
                  onClick={() => setAnswers((current) => ({ ...current, [name]: value }))}
                >
                  {value ? 'Yes' : 'No'}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1 text-muted-foreground">
        Note (optional)
        <input
          aria-label="Audit note"
          className="h-9 rounded-[10px] border border-border-strong bg-card px-2.5 text-[14px] text-foreground"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button className="h-9" isDisabled={!reliable} onPress={() => void record('GENUINE_UNDERFEEDING_CONFIRMED')}>
          Underfeeding confirmed
        </Button>
        <Button variant="outline" className="h-9" isDisabled={!answered} onPress={() => void record('INPUTS_UNRELIABLE')}>
          Inputs unreliable
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </fieldset>
  )
}

export function WeeklyReview({
  today,
  onDecided,
  onLoaded,
}: {
  today: string
  onDecided: () => Promise<void>
  onLoaded?: (review: NutritionReview) => void
}) {
  const [data, setData] = useState<NutritionReview | null>(null)
  const [concern, setConcern] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api.nutritionReview(today, concern).then(
        (loaded) => {
          setData(loaded)
          setError(null)
          onLoaded?.(loaded)
        },
        (failure: unknown) => setError(message(failure)),
      ),
    [today, concern, onLoaded],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (!data) {
    return error ? (
      <p role="alert" className="text-[13px] text-destructive">
        The weekly review could not be loaded: {error}
      </p>
    ) : null
  }

  const decide = async (choice: 'APPLIED' | 'KEPT') => {
    const review = data.review
    if (!review || review.block_week === null) return
    setBusy(true)
    setError(null)
    try {
      await api.decideReview({
        date: today,
        block_week: review.block_week,
        choice,
        expected_status: review.status,
        expected_delta_kcal: review.recommended_delta_kcal,
        expected_target_kcal: review.recommended_target_kcal,
        composition_concern: concern,
        notes: null,
      })
      await load()
      await onDecided()
    } catch (failure) {
      setError(`Not recorded: ${message(failure)}`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const review = data.review
  const frame = (children: React.ReactNode) => (
    <section aria-label="Weekly review" className="surface flex flex-col gap-4 p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-section">Weekly review</h2>
        <span className="t-micro">Decision support from the locked plan · the app never changes calories itself</span>
      </div>
      {children}
    </section>
  )

  if (!data.available || !review) {
    return frame(
      <p className="t-meta">
        {data.reason === 'no_program'
          ? 'No program is active, so there is no training block to review.'
          : 'The weekly review starts with the training block. '}
        {data.reason === 'no_block' && (
          <a href="#/settings" className="font-medium text-foreground underline">
            Set the block start in Settings.
          </a>
        )}
      </p>,
    )
  }

  const status = review.status
  const heuristic = ['UNDER_GAIN', 'IN_RANGE', 'OVER_GAIN'].includes(status)
  const due = review.decision_due && !['INSUFFICIENT_DATA', 'UNKNOWN'].includes(status)
  // The audit form stays available after "inputs unreliable": an audit may be redone once fixed.
  const gateOpen =
    due && (review.recommended_action === 'AUDIT_BEFORE_CONTINUING' || review.recommended_action === 'FIX_INPUT_PROBLEM_FIRST')
  const canApply =
    due && review.recommended_delta_kcal !== null && review.recommended_delta_kcal !== 0 && review.recommended_target_kcal !== null
  const canKeep = due && review.recommended_action !== 'AUDIT_BEFORE_CONTINUING'
  const pct = review.trend?.pct_bw_per_week === null || !review.trend ? null : Number(review.trend.pct_bw_per_week)

  return frame(
    <>
      <p className="t-meta">
        {review.block_week !== null && review.week_start && review.week_end ? (
          <>
            Week {review.block_week} · {formatRange(review.week_start, review.week_end)}
            {review.trend && review.trend.pct_bw_per_week !== null && (
              <> · 14-day regression, {review.trend.weigh_ins}/14 weigh-ins, {formatRange(review.trend.window_first, review.trend.window_last)}</>
            )}
          </>
        ) : (
          'Before the first finished block week.'
        )}
      </p>
      <dl className="num grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[11rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Qualified trend</dt>
        <dd data-testid="review-trend" className="font-medium">
          {trendText(review.trend)}
        </dd>
        <dt className="text-muted-foreground">Plan status</dt>
        <dd data-testid="review-status" className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{status}</span>
          <span className="text-muted-foreground">{STATUS_TEXT[status]}</span>
          {heuristic && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">HEURISTIC</span>}
          {status === 'OVER_GAIN' && review.sustained !== null && (
            <span className="text-muted-foreground">· {review.sustained ? 'sustained' : 'not yet sustained'}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Calorie target</dt>
        <dd>{review.current_target_kcal === null ? 'not calibrated yet' : `${review.current_target_kcal} kcal/day`}</dd>
        {due && (
          <>
            <dt className="text-muted-foreground">Plan recommendation</dt>
            <dd data-testid="review-recommendation" className="font-medium text-plan">
              {recommendation(review)}
            </dd>
          </>
        )}
      </dl>
      {review.note && <p className="t-micro">{review.note}</p>}
      {pct !== null && pct > 0.3 && due && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={concern} onChange={(event) => setConcern(event.target.checked)} />
          Waist or photos also look worse (composition concern)
        </label>
      )}
      {gateOpen && <GateAuditForm review={review} data={data} today={today} onSaved={load} />}
      {(canApply || canKeep) && (
        <div className="flex flex-wrap items-center gap-2">
          {canApply && (
            <Button className="h-9" isDisabled={busy} onPress={() => void decide('APPLIED')}>
              Apply {signed(String(review.recommended_delta_kcal))}
            </Button>
          )}
          {canKeep && (
            <Button variant="outline" className="h-9" isDisabled={busy} onPress={() => void decide('KEPT')}>
              Keep current
            </Button>
          )}
          <span className="t-micro">Your choice is recorded with this review.</span>
        </div>
      )}
      {review.decision && (
        <p data-testid="review-decided" className="flex items-center gap-1.5 text-[13px]">
          <ClipboardCheck className="size-4 text-ok" aria-hidden />
          Week {review.block_week}: {decisionText(review.decision)}
        </p>
      )}
      {!due && review.next_decision_week !== null && review.next_decision_on && (
        <p data-testid="review-next" className="t-meta">
          Next routine decision: end of week {review.next_decision_week} ({formatShortDate(review.next_decision_on)}).
        </p>
      )}
      {!due && review.phase === 'post_block' && <p className="t-meta">The block is finished; no routine decision remains.</p>}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      {data.weeks.length > 0 && (
        <table className="num w-full text-[13px]" aria-label="Weekly reviews">
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Week</th>
              <th className="py-2 pr-3 font-medium">Ends</th>
              <th className="py-2 pr-3 text-right font-medium">7-day avg · kg</th>
              <th className="py-2 pr-3 text-right font-medium">14-day trend · % BW/wk</th>
              <th className="py-2 pr-3 font-medium">Band</th>
              <th className="py-2 pr-3 text-right font-medium">Target · kcal</th>
              <th className="py-2 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((row) => (
              <tr key={row.block_week} data-testid="review-week" className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-emerald-50/50">
                <td className="py-1.5 pr-3">{row.block_week}</td>
                <td className="py-1.5 pr-3">{formatShortDate(row.week_end)}</td>
                <td className="py-1.5 pr-3 text-right">
                  {row.avg7_kg ?? '—'} <span className="text-muted-foreground">({row.avg7_count}/7)</span>
                </td>
                <td className="py-1.5 pr-3 text-right">
                  {row.trend.pct_bw_per_week === null ? (
                    <span className="text-muted-foreground">
                      {row.trend.reason === 'WAITING_FOR_NEW_TREND' ? 'waiting' : `${row.trend.weigh_ins}/14`}
                    </span>
                  ) : (
                    signed(row.trend.pct_bw_per_week)
                  )}
                </td>
                <td className="py-1.5 pr-3 text-muted-foreground">{row.trend.band ? STATUS_TEXT[row.trend.band] : '—'}</td>
                <td className="py-1.5 pr-3 text-right">{row.target_kcal ?? '—'}</td>
                <td className="py-1.5">{row.decision ? decisionText(row.decision) : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>,
  )
}
