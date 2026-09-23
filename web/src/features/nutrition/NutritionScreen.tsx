import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '@/api/client'
import type { Nutrition, NutritionDay } from '@/api/types'
import { Button } from '@/components/ui/button'
import { addDays, formatShortDate, localDate } from '@/lib/format'
import { parseWhole } from '@/lib/numbers'

// Mirrors backend domain/nutrition.py; the server enforces the same limits.
const FIXED_PROTEIN_FAT_KCAL = 1120
const MAX_KCAL = 15000
const MAX_MACRO_G = 1500

const inputClass =
  'num h-8 rounded-md border border-input bg-card px-2 text-[13px] outline-none ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive'

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

function TargetRow({
  label,
  logged,
  target,
  unit,
  testId,
  unknown,
}: {
  label: string
  logged: number | null
  target: number | null
  unit: string
  testId: string
  unknown: string
}) {
  const diff = logged !== null && target !== null ? logged - target : null
  return (
    <tr className="border-t border-border/70">
      <th scope="row" className="py-1.5 text-left font-medium">
        {label}
      </th>
      <td className="num py-1.5 text-right">{logged === null ? '—' : `${logged} ${unit}`}</td>
      <td className="num py-1.5 pl-6" data-testid={testId}>
        {target === null ? <span className="text-muted-foreground">{unknown}</span> : `${target} ${unit}`}
      </td>
      <td className="num py-1.5 text-right text-muted-foreground">
        {diff === null ? '' : `${diff > 0 ? '+' : ''}${diff} ${unit}`}
      </td>
    </tr>
  )
}

function CalorieTargetForm({ today, onSaved }: { today: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [kcal, setKcal] = useState('')
  const [from, setFrom] = useState(today)
  const [notes, setNotes] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const parsed = parseWhole(kcal, 10000)
  const value = parsed.ok ? parsed.value : null
  const valid = value !== null && value >= FIXED_PROTEIN_FAT_KCAL

  if (!open) {
    return (
      <button type="button" className="self-start text-[12px] text-plan hover:underline" onClick={() => setOpen(true)}>
        Set calorie target…
      </button>
    )
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-dashed border-plan-rule bg-plan-surface p-3 text-[12px]"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid) {
          setProblem(`Enter whole kcal of at least ${FIXED_PROTEIN_FAT_KCAL} (protein and fat alone).`)
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
          <input type="date" aria-label="Target effective from" className={inputClass} value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-muted-foreground">
          Reason (optional)
          <input aria-label="Target reason" className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <Button type="submit" size="sm" className="h-8">
          Record target
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onPress={() => setOpen(false)}>
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

export function NutritionScreen() {
  const today = localDate()
  const [day, setDay] = useState(today)
  const [data, setData] = useState<Nutrition | null>(null)
  const [draft, setDraft] = useState<Draft>(draftOf(null))
  const [error, setError] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
      <p role="alert" className="text-destructive">
        Could not load nutrition: {error}
      </p>
    ) : (
      <p className="text-muted-foreground">Loading nutrition…</p>
    )
  }

  const { targets, recent } = data
  const logged = data.day

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Nutrition</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous day" onPress={() => setDay(addDays(day, -1))}>
            ‹
          </Button>
          <input
            type="date"
            aria-label="Nutrition date"
            className={inputClass}
            value={day}
            max={today}
            onChange={(event) => event.target.value && setDay(event.target.value)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next day"
            isDisabled={day >= today}
            onPress={() => setDay(addDays(day, 1))}
          >
            ›
          </Button>
          {day !== today && (
            <Button variant="ghost" size="sm" onPress={() => setDay(today)}>
              Today
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Log · {formatShortDate(day)}
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {FIELDS.map((field) => (
              <label key={field.key} className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                {field.label} {field.unit}
                <input
                  aria-label={`${field.label} ${field.unit}`}
                  inputMode="numeric"
                  className={`${inputClass} w-full text-right`}
                  value={draft[field.key]}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                    setProblem(null)
                    setSaved(null)
                  }}
                />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            Notes (optional)
            <input
              aria-label="Nutrition notes"
              className={inputClass}
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" isDisabled={saving}>
              {logged ? 'Update day' : 'Save day'}
            </Button>
            {logged && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onPress={() => void remove()}>
                Remove day
              </Button>
            )}
            {saved && (
              <span role="status" className="text-[12px] text-ok">
                {saved}
              </span>
            )}
          </div>
          {problem && (
            <p role="alert" className="text-[12px] text-destructive">
              {problem}
            </p>
          )}
        </form>

        <section aria-label="Targets" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Against target
          </h2>
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="pb-1 font-medium" />
                <th className="pb-1 text-right font-medium">Logged</th>
                <th className="pb-1 pl-6 font-medium">Target</th>
                <th className="pb-1 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              <TargetRow
                label="Calories"
                logged={logged?.calories_kcal ?? null}
                target={targets.calories_kcal}
                unit="kcal"
                testId="nut-target-calories"
                unknown="Calorie target not calibrated yet."
              />
              <TargetRow label="Protein" logged={logged?.protein_g ?? null} target={targets.protein_g} unit="g" testId="nut-target-protein" unknown="" />
              <TargetRow
                label="Carbs"
                logged={logged?.carbs_g ?? null}
                target={targets.carbs_g}
                unit="g"
                testId="nut-target-carbs"
                unknown="Follows the calorie target."
              />
              <TargetRow label="Fat" logged={logged?.fat_g ?? null} target={targets.fat_g} unit="g" testId="nut-target-fat" unknown="" />
            </tbody>
          </table>
          {targets.calorie_target_effective_on && (
            <p className="text-[12px] text-muted-foreground">
              Calorie target {targets.calories_kcal} kcal since {formatShortDate(targets.calorie_target_effective_on)}.
            </p>
          )}
          <CalorieTargetForm today={today} onSaved={() => load(day)} />
        </section>
      </div>

      <section aria-label="Recent days" className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Last 14 days</h2>
        {recent.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing logged in the last 14 days.</p>
        ) : (
          <table className="num w-full text-[13px]">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="pb-1 font-medium">Date</th>
                <th className="pb-1 text-right font-medium">kcal</th>
                <th className="pb-1 text-right font-medium">Protein</th>
                <th className="pb-1 text-right font-medium">Carbs</th>
                <th className="pb-1 text-right font-medium">Fat</th>
                <th className="pb-1 pl-4 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr
                  key={row.logged_on}
                  data-testid="nut-day"
                  className={`cursor-pointer border-t border-border/70 hover:bg-muted/60 ${row.logged_on === day ? 'bg-muted/60' : ''}`}
                  onClick={() => setDay(row.logged_on)}
                >
                  <td className="py-1">{formatShortDate(row.logged_on)}</td>
                  <td className="py-1 text-right">{row.calories_kcal ?? '—'}</td>
                  <td className="py-1 text-right">{row.protein_g ?? '—'}</td>
                  <td className="py-1 text-right">{row.carbs_g ?? '—'}</td>
                  <td className="py-1 text-right">{row.fat_g ?? '—'}</td>
                  <td className="py-1 pl-4 text-muted-foreground">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
