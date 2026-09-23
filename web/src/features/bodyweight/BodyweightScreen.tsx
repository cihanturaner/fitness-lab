import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api } from '@/api/client'
import type { Bodyweight } from '@/api/types'
import { Button } from '@/components/ui/button'
import { TrendChart } from '@/components/chart/TrendChart'
import { formatShortDate, localDate, signed } from '@/lib/format'
import { parseBodyweight } from '@/lib/numbers'

const inputClass =
  'num h-8 rounded-md border border-input bg-card px-2 text-[13px] outline-none ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

function Stat({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-l border-border pl-3 first:border-l-0 first:pl-0">
      <span className="text-[11px] tracking-wider text-muted-foreground uppercase">{label}</span>
      <span data-testid={testId} className="num text-[13px]">
        {children}
      </span>
    </div>
  )
}

export function BodyweightScreen() {
  const today = localDate()
  const [data, setData] = useState<Bodyweight | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState(today)
  const [kg, setKg] = useState('')
  const [notes, setNotes] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    () =>
      api.bodyweight(today, 90).then(
        (loaded) => {
          setData(loaded)
          setError(null)
        },
        (failure: unknown) => setError(message(failure)),
      ),
    [today],
  )

  useEffect(() => {
    void load()
  }, [load])

  const existing = data?.entries.find((entry) => entry.measured_on === day)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const value = parseBodyweight(kg)
    if (value === null) {
      setProblem('Not saved: enter kilograms between 20 and 300, e.g. 72.4 (two decimals at most).')
      return
    }
    if (day > today) {
      setProblem('Not saved: that date is in the future.')
      return
    }
    setProblem(null)
    setSaving(true)
    try {
      await api.putBodyweight(day, value, notes.trim() === '' ? null : notes.trim())
      setSaved(`Saved ${value} kg for ${formatShortDate(day)}.`)
      setKg('')
      setNotes('')
      await load()
    } catch (failure) {
      setProblem(`Not saved: ${message(failure)}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (measuredOn: string, value: string) => {
    if (!window.confirm(`Remove the ${value} kg weigh-in of ${formatShortDate(measuredOn)}?`)) return
    try {
      await api.deleteBodyweight(measuredOn)
      await load()
    } catch (failure) {
      setProblem(message(failure))
    }
  }

  if (!data) {
    return error ? (
      <p role="alert" className="text-destructive">
        Could not load bodyweight: {error}
      </p>
    ) : (
      <p className="text-muted-foreground">Loading bodyweight…</p>
    )
  }

  const { summary, series, entries } = data
  const avgByDate = new Map(series.map((point) => [point.date, point.avg7_kg]))

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4">
        <h1 className="text-xl font-semibold tracking-tight">Bodyweight</h1>
        <p className="text-[12px] text-muted-foreground">
          Morning, after the bathroom, before food or fluid, same scale.
        </p>
      </header>

      <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          Date
          <input
            type="date"
            aria-label="Weigh-in date"
            className={inputClass}
            value={day}
            max={today}
            onChange={(event) => {
              setDay(event.target.value)
              setSaved(null)
            }}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          Weight kg
          <input
            aria-label="Bodyweight in kg"
            inputMode="decimal"
            className={`${inputClass} w-24 text-right`}
            placeholder={existing?.bodyweight_kg ?? summary.latest?.bodyweight_kg ?? 'kg'}
            value={kg}
            aria-invalid={problem !== null || undefined}
            autoFocus
            onChange={(event) => {
              setKg(event.target.value)
              setProblem(null)
              setSaved(null)
            }}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-0.5 text-[11px] text-muted-foreground">
          Notes (optional)
          <input
            aria-label="Weigh-in notes"
            className={inputClass}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <Button type="submit" size="sm" isDisabled={saving} className="h-8">
          {existing ? 'Replace' : 'Save'}
        </Button>
        {existing && (
          <p className="basis-full text-[12px] text-muted-foreground">
            {formatShortDate(day)} already has {existing.bodyweight_kg} kg; saving replaces it.
          </p>
        )}
        {problem && (
          <p role="alert" className="basis-full text-[12px] text-destructive">
            {problem}
          </p>
        )}
        {saved && (
          <p role="status" className="basis-full text-[12px] text-ok">
            {saved}
          </p>
        )}
      </form>

      <section aria-label="Summary" className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-3">
        <Stat label="Latest" testId="bw-latest">
          {summary.latest ? (
            <>
              <span className="text-[18px] font-semibold">{summary.latest.bodyweight_kg}</span> kg ·{' '}
              <span className="text-muted-foreground">{formatShortDate(summary.latest.measured_on)}</span>
            </>
          ) : (
            '—'
          )}
        </Stat>
        <Stat label="7-day average" testId="bw-avg7">
          <span className="text-[18px] font-semibold">{summary.current_avg_kg ?? '—'}</span> kg{' '}
          <span className="text-muted-foreground">({summary.current_count}/7 days)</span>
        </Stat>
        <Stat label="Previous 7 days" testId="bw-prev7">
          <span className="text-[18px] font-semibold">{summary.previous_avg_kg ?? '—'}</span> kg{' '}
          <span className="text-muted-foreground">({summary.previous_count}/7 days)</span>
        </Stat>
        <Stat label="Change" testId="bw-change">
          {summary.change_kg === null ? (
            <span className="text-muted-foreground">needs both weeks</span>
          ) : (
            <>
              <span className="text-[18px] font-semibold">{signed(summary.change_kg)}</span> kg ·{' '}
              {signed(summary.change_pct ?? '0')}%
            </>
          )}
        </Stat>
      </section>

      {series.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-3">
          <TrendChart
            label="Daily bodyweight and 7-day average"
            unit="kg"
            dates={series.map((point) => point.date)}
            series={[
              {
                label: 'Daily',
                color: 'var(--series-daily)',
                kind: 'dots',
                values: series.map((point) => (point.bodyweight_kg === null ? null : Number(point.bodyweight_kg))),
              },
              {
                label: '7-day average',
                color: 'var(--series-trend)',
                kind: 'line',
                values: series.map((point) => (point.avg7_kg === null ? null : Number(point.avg7_kg))),
              },
            ]}
          />
        </section>
      )}

      <section aria-label="Weigh-ins" className="rounded-lg border border-border bg-card p-3">
        {entries.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No weigh-ins in the last 90 days.</p>
        ) : (
          <table className="num w-full text-[13px]">
            <thead className="text-left text-[11px] tracking-wider text-muted-foreground uppercase">
              <tr>
                <th className="pb-1 font-medium">Date</th>
                <th className="pb-1 text-right font-medium">kg</th>
                <th className="pb-1 text-right font-medium">7-day avg</th>
                <th className="pb-1 pl-4 font-medium">Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.measured_on} data-testid="bw-entry" className="border-t border-border/70">
                  <td className="py-1">{formatShortDate(entry.measured_on)}</td>
                  <td className="py-1 text-right font-medium">{entry.bodyweight_kg}</td>
                  <td className="py-1 text-right text-muted-foreground">{avgByDate.get(entry.measured_on) ?? ''}</td>
                  <td className="py-1 pl-4 text-muted-foreground">{entry.notes}</td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="rounded px-1.5 text-[12px] text-plan hover:bg-muted"
                      onClick={() => {
                        setDay(entry.measured_on)
                        setKg(entry.bodyweight_kg)
                        setNotes(entry.notes ?? '')
                        setSaved(null)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove weigh-in of ${entry.measured_on}`}
                      className="rounded px-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={() => void remove(entry.measured_on, entry.bodyweight_kg)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
