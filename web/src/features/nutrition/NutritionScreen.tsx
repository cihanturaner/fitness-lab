import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, Utensils } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { CalorieTarget, Nutrition, NutritionDay, NutritionReview } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DateField, EmptyState, LoadError, Meter, PageHeader, Skeleton } from '@/components/app/primitives'
import { addDays, formatLongDate, formatShortDate, localDate } from '@/lib/format'
import { parseWhole } from '@/lib/numbers'
import { confirmLeave, markUnsaved, useUnsavedKey } from '@/lib/unsaved'
import { WeeklyReview } from './WeeklyReview'

// Mirrors backend domain/nutrition.py; the server enforces the same limits.
const FIXED_PROTEIN_FAT_KCAL = 1120
const MAX_KCAL = 15000
const MAX_MACRO_G = 1500

const inputClass =
  'num h-9 rounded-md border border-input bg-card px-2.5 text-[14px] outline-none transition-colors ' +
  'hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20'

type FieldKey = 'calories_kcal' | 'protein_g' | 'carbs_g' | 'fat_g'
const FIELDS: { key: FieldKey; label: string; unit: string; max: number }[] = [
  { key: 'calories_kcal', label: 'Calories', unit: 'kcal', max: MAX_KCAL },
  { key: 'protein_g', label: 'Protein', unit: 'g', max: MAX_MACRO_G },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', max: MAX_MACRO_G },
  { key: 'fat_g', label: 'Fat', unit: 'g', max: MAX_MACRO_G },
]

type Draft = Record<FieldKey | 'notes', string>

function draftOf(day: NutritionDay | null): Draft {
  const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))
  return {
    calories_kcal: text(day?.calories_kcal),
    protein_g: text(day?.protein_g),
    carbs_g: text(day?.carbs_g),
    fat_g: text(day?.fat_g),
    notes: day?.notes ?? '',
  }
}

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

function carbsFor(kcal: number): number {
  // (calories - 1120) / 4, half-up to whole grams, as the server computes it.
  return Math.floor((kcal - FIXED_PROTEIN_FAT_KCAL) / 4 + 0.5)
}

/**
 * One macro for the day: the logged number leads, the target follows, and a bar appears only
 * when the target is known. An unknown target is said in words, never drawn as an empty bar.
 */
function MacroMeter({
  label,
  logged,
  target,
  unit,
  testId,
  unknown,
  minimum = false,
}: {
  label: string
  logged: number | null
  target: number | null
  unit: string
  testId: string
  unknown: string
  /** Protein is a floor: meeting it earns a check. For the rest, over is just "over". */
  minimum?: boolean
}) {
  const diff = logged !== null && target !== null ? logged - target : null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {diff !== null && (
          <span className={`num text-[12px] ${diff >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
            {diff >= 0 ? (
              <span className="inline-flex items-center gap-1">
                {minimum && <Check className="size-3.5 text-ok" strokeWidth={2.5} aria-hidden />}
                {diff === 0 ? 'on target' : `${diff} ${unit} over`}
              </span>
            ) : (
              `${-diff} ${unit} to go`
            )}
          </span>
        )}
      </div>
      <p className="num flex items-baseline gap-1.5">
        <span className={`t-metric ${logged === null ? 'text-faint' : ''}`}>{logged ?? '—'}</span>
        <span className="t-unit">{unit}</span>
        {target !== null && <span className="ml-1 text-[13px] text-muted-foreground">of</span>}
        <span
          data-testid={testId}
          className={target === null ? 'ml-1 text-[13px] text-muted-foreground' : 'text-[13px] font-medium text-muted-foreground'}
        >
          {target === null ? unknown : `${target} ${unit}`}
        </span>
      </p>
      {target === null ? (
        <div className="h-1.5" aria-hidden />
      ) : (
        <Meter value={logged} target={target} />
      )}
    </div>
  )
}

function CalorieTargetForm({
  today,
  calibrated,
  exceptions,
  onSaved,
}: {
  today: string
  calibrated: boolean
  /** Weeks 1-2 with a target already in force: only the source's exceptions justify a change. */
  exceptions: string[] | null
  onSaved: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [kcal, setKcal] = useState('')
  const [from, setFrom] = useState(today)
  const [notes, setNotes] = useState('')
  const [intake, setIntake] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const parsed = parseWhole(kcal, 10000)
  const value = parsed.ok ? parsed.value : null
  const valid = value !== null && value >= FIXED_PROTEIN_FAT_KCAL
  const stable = parseWhole(intake, 9850)
  const starting = stable.ok && stable.value !== null && stable.value + 150 >= FIXED_PROTEIN_FAT_KCAL ? stable.value + 150 : null

  if (!open) {
    return (
      <button
        type="button"
        className="self-start rounded-md border border-border-strong bg-card px-2.5 py-1 text-[13px] font-medium hover:bg-sunken"
        onClick={() => setOpen(true)}
      >
        Set calorie target…
      </button>
    )
  }
  return (
    <form
      className="flex animate-in flex-col gap-3 rounded-lg border border-plan-rule/70 bg-plan-surface p-4 text-[13px] fade-in slide-in-from-top-1 duration-150"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid) {
          setProblem(`Enter whole kcal of at least ${FIXED_PROTEIN_FAT_KCAL} (protein and fat alone).`)
          return
        }
        if (exceptions && notes.trim() === '') {
          setProblem('Weeks 1–2 allow no routine change: choose the exception that applies.')
          return
        }
        void api
          .addCalorieTarget(from, value, notes.trim() === '' ? null : notes.trim())
          .then(async () => {
            setOpen(false)
            setKcal('')
            setNotes('')
            await onSaved()
          })
          .catch((failure: unknown) => setProblem(`Not saved: ${message(failure)}`))
      }}
    >
      <p className="text-muted-foreground">
        Your decision, recorded as-is. The app never sets or changes calories on its own; carbohydrate
        becomes (calories − 1120) / 4.
      </p>
      {!calibrated && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-card/70 p-3">
          <label className="flex flex-col gap-0.5 text-muted-foreground">
            Recent stable intake kcal
            <input
              aria-label="Recent stable intake in kcal"
              inputMode="numeric"
              className={`${inputClass} w-24 text-right`}
              value={intake}
              onChange={(event) => setIntake(event.target.value)}
            />
          </label>
          <p className="num pb-2">
            Starting rule: recent stable intake + 150
            {starting !== null && (
              <>
                {' '}= <strong data-testid="starting-target">{starting} kcal</strong> · carbs {carbsFor(starting)} g
              </>
            )}
          </p>
          {starting !== null && (
            <Button
              variant="outline"
              className="h-9 border-border-strong bg-card"
              onPress={() => {
                setKcal(String(starting))
                setNotes(`Starting rule: recent stable intake ${starting - 150} + 150`)
              }}
            >
              Use {starting}
            </Button>
          )}
        </div>
      )}
      {exceptions && (
        <p className="text-warn">
          Weeks 1–2: no routine bodyweight-driven changes. Record a change only for one of the source’s exceptions.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-muted-foreground">
          Calories kcal
          <input
            aria-label="Calorie target in kcal"
            inputMode="numeric"
            className={`${inputClass} w-24 text-right`}
            value={kcal}
            onChange={(event) => {
              setKcal(event.target.value)
              setProblem(null)
            }}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-muted-foreground">
          From
          <DateField aria-label="Target effective from" className="w-[9.5rem]" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        {exceptions ? (
          <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-muted-foreground">
            Exception
            <select aria-label="Target reason" className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)}>
              <option value="">Choose…</option>
              {exceptions.map((item) => (
                <option key={item} value={`Weeks 1–2 exception: ${item}`}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-muted-foreground">
            Reason (optional)
            <input aria-label="Target reason" className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        )}
        <Button type="submit" className="h-9">
          Record target
        </Button>
        <Button variant="ghost" className="h-9" onPress={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {valid && (
        <p className="num">
          Carbohydrate target: ({value} − 1120) / 4 = <strong>{carbsFor(value)} g</strong>
        </p>
      )}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </form>
  )
}

/** The calorie target in force on a day: latest effective on or before it, ties by recording. */
function targetOn(history: CalorieTarget[], day: string): number | null {
  const found = history
    .filter((item) => item.effective_on <= day)
    .sort((a, b) => (a.effective_on === b.effective_on ? b.set_at_utc.localeCompare(a.set_at_utc) : b.effective_on.localeCompare(a.effective_on)))[0]
  return found ? found.calories_kcal : null
}

/** Every calorie-target decision, newest first, append-only: corrections are new rows. */
function TargetHistory({ history }: { history: CalorieTarget[] }) {
  if (history.length === 0) return null
  const ordered = [...history].sort((a, b) =>
    a.effective_on === b.effective_on ? b.set_at_utc.localeCompare(a.set_at_utc) : b.effective_on.localeCompare(a.effective_on),
  )
  return (
    <section aria-label="Calorie target history" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="t-section">Calorie target history</h2>
        <span className="t-micro">Never edited; to correct one, record a new target for the same date.</span>
      </div>
      <table className="num w-full text-[14px]">
        <thead className="text-left text-[12px] text-muted-foreground">
          <tr className="border-b border-border-strong">
            <th className="py-2 pr-4 font-medium">From</th>
            <th className="py-2 pr-4 text-right font-medium">Calories · kcal</th>
            <th className="py-2 pr-4 text-right font-medium">Change</th>
            <th className="py-2 pr-4 text-right font-medium">Carbs · g</th>
            <th className="py-2 pl-4 font-medium">Reason</th>
            <th className="py-2 pl-4 font-medium">Recorded</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((item, index) => {
            const previous = ordered[index + 1]
            const change = previous ? item.calories_kcal - previous.calories_kcal : null
            return (
              <tr key={item.id} data-testid="target-row" className="border-b border-border">
                <td className="py-2 pr-4">{formatShortDate(item.effective_on)}</td>
                <td className="py-2 pr-4 text-right font-medium">{item.calories_kcal}</td>
                <td className="py-2 pr-4 text-right text-muted-foreground">
                  {change === null ? 'first' : change === 0 ? '±0' : `${change > 0 ? '+' : '−'}${Math.abs(change)}`}
                </td>
                <td className="py-2 pr-4 text-right">{carbsFor(item.calories_kcal)}</td>
                <td className="max-w-80 truncate py-2 pl-4 text-muted-foreground">{item.notes ?? '—'}</td>
                <td className="py-2 pl-4 text-muted-foreground">{item.set_at_utc.slice(0, 10)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export function NutritionScreen() {
  const today = localDate()
  const [day, setDay] = useState(today)
  const [data, setData] = useState<Nutrition | null>(null)
  const [draft, setDraft] = useState<Draft>(draftOf(null))
  const [error, setError] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [review, setReview] = useState<NutritionReview | null>(null)
  // A new calorie target changes the review; remounting it re-reads it.
  const [reviewKey, setReviewKey] = useState(0)
  const unsavedKey = useUnsavedKey()
  const saved_ = draftOf(data?.day ?? null)
  const typed = (Object.keys(saved_) as (keyof Draft)[]).some((key) => draft[key].trim() !== saved_[key].trim())
  useEffect(() => {
    markUnsaved(unsavedKey, typed ? 'Nutrition log (typed, not saved)' : null)
  }, [unsavedKey, typed])
  /** Another date replaces the form; typed input is only dropped if the lifter agrees. */
  const goTo = (next: string) => {
    if (next === day || !confirmLeave()) return
    markUnsaved(unsavedKey, null)
    setDay(next)
  }

  const load = useCallback(
    (date: string) =>
      api.nutrition(date).then(
        (loaded) => {
          setData(loaded)
          setDraft(draftOf(loaded.day))
          setError(null)
        },
        (failure: unknown) => setError(message(failure)),
      ),
    [],
  )

  useEffect(() => {
    void load(day)
  }, [day, load])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (day > today) {
      setProblem('Not saved: that date is in the future.')
      return
    }
    const values: Partial<Record<FieldKey, number | null>> = {}
    for (const field of FIELDS) {
      const parsed = parseWhole(draft[field.key], field.max)
      if (!parsed.ok) {
        setProblem(`Not saved: ${field.label.toLowerCase()} must be a whole number of ${field.unit} (0–${field.max}).`)
        return
      }
      values[field.key] = parsed.value
    }
    if (FIELDS.every((field) => values[field.key] === null)) {
      setProblem('Not saved: enter at least one of calories, protein, carbs or fat.')
      return
    }
    setProblem(null)
    setSaving(true)
    try {
      await api.putNutrition(day, {
        calories_kcal: values.calories_kcal ?? null,
        protein_g: values.protein_g ?? null,
        carbs_g: values.carbs_g ?? null,
        fat_g: values.fat_g ?? null,
        notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
      })
      markUnsaved(unsavedKey, null)
      setSaved(`Saved ${formatShortDate(day)}.`)
      await load(day)
    } catch (failure) {
      setProblem(`Not saved: ${message(failure)}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Remove the nutrition log of ${formatShortDate(day)}?`)) return
    try {
      await api.deleteNutrition(day)
      setSaved(null)
      await load(day)
    } catch (failure) {
      setProblem(message(failure))
    }
  }

  if (!data) {
    return error ? (
      <LoadError what="nutrition" detail={error} onRetry={() => void load(day)} />
    ) : (
      <Skeleton label="Loading nutrition…" blocks={['h-8 w-72', 'h-64', 'h-48']} />
    )
  }

  const { targets, recent } = data
  const logged = data.day
  const hasTargets = data.target_history.length > 0
  const isToday = day === today

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Nutrition"
        meta={
          <>
            {formatLongDate(day)}
            {isToday ? ' · today' : ''}
          </>
        }
        aside={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous day" onPress={() => goTo(addDays(day, -1))}>
              <ChevronLeft aria-hidden />
            </Button>
            <DateField
              aria-label="Nutrition date"
              className="w-[9.5rem]"
              value={day}
              max={today}
              onChange={(event) => event.target.value && goTo(event.target.value)}
            />
            <Button variant="ghost" size="icon" aria-label="Next day" isDisabled={day >= today} onPress={() => goTo(addDays(day, 1))}>
              <ChevronRight aria-hidden />
            </Button>
            <Button variant="outline" className="ml-1 h-9 border-border-strong bg-card" isDisabled={isToday} onPress={() => goTo(today)}>
              Today
            </Button>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <section aria-label="Targets" className="flex flex-col gap-6 rounded-[10px] border border-border bg-card p-6 lg:col-span-7">
          <div className="flex items-baseline justify-between">
            <h2 className="t-section">Daily summary</h2>
            <span className="t-micro">{logged ? `Logged ${formatShortDate(logged.logged_on)}` : 'Nothing logged for this day'}</span>
          </div>
          <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
            <MacroMeter
              label="Calories"
              logged={logged?.calories_kcal ?? null}
              target={targets.calories_kcal}
              unit="kcal"
              testId="nut-target-calories"
              unknown="Calorie target not calibrated yet."
            />
            <MacroMeter label="Protein" logged={logged?.protein_g ?? null} target={targets.protein_g} unit="g" testId="nut-target-protein" unknown="" minimum />
            <MacroMeter
              label="Carbs"
              logged={logged?.carbs_g ?? null}
              target={targets.carbs_g}
              unit="g"
              testId="nut-target-carbs"
              unknown="Follows the calorie target."
            />
            <MacroMeter label="Fat" logged={logged?.fat_g ?? null} target={targets.fat_g} unit="g" testId="nut-target-fat" unknown="" />
          </div>
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="t-meta">
              {targets.calorie_target_effective_on ? (
                <>
                  Calorie target <span className="num font-medium text-foreground">{targets.calories_kcal} kcal</span> since{' '}
                  {formatShortDate(targets.calorie_target_effective_on)}. Protein 145 g and fat 60 g are fixed; carbohydrate
                  follows the calories.
                </>
              ) : (
                <>
                  Protein 145 g and fat 60 g are fixed. Calories stay open until you record a target; carbohydrate then
                  follows as (calories − 1120) / 4.
                </>
              )}
            </p>
            <CalorieTargetForm
              today={today}
              calibrated={targets.calories_kcal !== null}
              exceptions={
                review?.review?.phase === 'early' && review.review.current_target_kcal !== null ? review.week_1_2_exceptions : null
              }
              onSaved={async () => {
                await load(day)
                setReviewKey((key) => key + 1)
              }}
            />
          </div>
        </section>

        <form
          onSubmit={(event) => void save(event)}
          aria-label="Log the day"
          className="flex flex-col gap-4 rounded-[10px] border border-border bg-card p-6 lg:col-span-5"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="t-section">{logged ? 'Update the day' : 'Log the day'}</h2>
            <span className="t-micro">{formatShortDate(day)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((field) => (
              <label key={field.key} className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
                {field.label}
                <span className="relative">
                  <input
                    aria-label={`${field.label} ${field.unit}`}
                    inputMode="numeric"
                    className={`${inputClass} w-full pr-11 text-right text-[15px] font-medium text-foreground`}
                    value={draft[field.key]}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                      setProblem(null)
                      setSaved(null)
                    }}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] font-normal text-faint">
                    {field.unit}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
            Note
            <input
              aria-label="Nutrition notes"
              placeholder="Optional — e.g. restaurant, estimated"
              className={`${inputClass} font-normal text-foreground placeholder:text-faint`}
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" isDisabled={saving} className="h-9 px-4">
              {logged ? 'Update day' : 'Save day'}
            </Button>
            {logged && (
              <Button variant="ghost" className="h-9 text-muted-foreground" onPress={() => void remove()}>
                Remove day
              </Button>
            )}
            {saved && (
              <span role="status" className="ml-auto inline-flex animate-in items-center gap-1 text-[13px] text-ok fade-in">
                <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
                {saved}
              </span>
            )}
          </div>
          {problem && (
            <p role="alert" className="text-[13px] text-destructive">
              {problem}
            </p>
          )}
        </form>
      </div>

      <WeeklyReview key={reviewKey} today={today} onDecided={() => load(day)} onLoaded={setReview} />

      <section aria-label="Recent days" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="t-section">Last 14 days</h2>
          {recent.length > 0 && (
            <span className="t-micro">
              Protein target met on{' '}
              <span className="num font-medium text-foreground">
                {recent.filter((row) => row.protein_g !== null && row.protein_g >= targets.protein_g).length} of {recent.length}
              </span>{' '}
              logged days
            </span>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-border-strong">
            <EmptyState icon={Utensils} title="Nothing logged in the last 14 days." className="py-6">
              Each saved day appears here with its calories and macros, so a fortnight reads at a glance.
            </EmptyState>
          </div>
        ) : (
          <table className="num w-full text-[14px]">
            <thead className="text-left text-[12px] text-muted-foreground">
              <tr className="border-b border-border-strong">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 text-right font-medium">Calories · kcal</th>
                {hasTargets && <th className="py-2 pr-4 text-right font-medium">vs target that day</th>}
                <th className="py-2 pr-4 text-right font-medium">Protein · g</th>
                <th className="py-2 pr-4 text-right font-medium">Carbs · g</th>
                <th className="py-2 pr-4 text-right font-medium">Fat · g</th>
                <th className="py-2 pl-4 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => {
                // Each day against the target in force on that day, never today's.
                const rowTarget = targetOn(data.target_history, row.logged_on)
                const kcalDiff = rowTarget !== null && row.calories_kcal !== null ? row.calories_kcal - rowTarget : null
                const proteinMet = row.protein_g !== null && row.protein_g >= targets.protein_g
                return (
                  <tr
                    key={row.logged_on}
                    data-testid="nut-day"
                    className={`cursor-pointer border-b border-border hover:bg-card ${row.logged_on === day ? 'bg-card' : ''}`}
                    onClick={() => goTo(row.logged_on)}
                  >
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        className={`rounded text-left hover:underline ${row.logged_on === day ? 'font-semibold' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          goTo(row.logged_on)
                        }}
                      >
                        {formatShortDate(row.logged_on)}
                      </button>
                    </td>
                    <td className="py-2 pr-4 text-right font-medium">{row.calories_kcal ?? '—'}</td>
                    {hasTargets && (
                      <td className="py-2 pr-4 text-right text-muted-foreground">
                        {kcalDiff === null ? '' : `${kcalDiff > 0 ? '+' : kcalDiff < 0 ? '−' : ''}${Math.abs(kcalDiff)}`}
                      </td>
                    )}
                    <td className="py-2 pr-4 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {row.protein_g ?? '—'}
                        <span
                          aria-label={proteinMet ? 'protein target met' : undefined}
                          className={`size-1.5 rounded-full ${proteinMet ? 'bg-ok' : 'bg-border-strong'}`}
                        />
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right">{row.carbs_g ?? '—'}</td>
                    <td className="py-2 pr-4 text-right">{row.fat_g ?? '—'}</td>
                    <td className="max-w-64 truncate py-2 pl-4 text-muted-foreground">{row.notes}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
      <TargetHistory history={data.target_history} />
    </div>
  )
}
