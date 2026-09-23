import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Pencil, Scale, X } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { Bodyweight } from '@/api/types'
import { Button } from '@/components/ui/button'
import { EmptyChartFrame, TrendChart } from '@/components/chart/TrendChart'
import { DateField, EmptyState, LoadError, PageHeader, Skeleton } from '@/components/app/primitives'
import { formatShortDate, localDate, signed } from '@/lib/format'
import { parseBodyweight } from '@/lib/numbers'
import { markUnsaved, useUnsavedKey } from '@/lib/unsaved'

const inputClass =
  'num h-9 rounded-md border border-input bg-card px-2.5 text-[14px] outline-none transition-colors ' +
  'hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

function Stat({
  label,
  testId,
  children,
  caption,
  hero = false,
}: {
  label: string
  testId: string
  children: ReactNode
  /** Context under the figure, outside its value. */
  caption?: ReactNode
  hero?: boolean
}) {
  return (
    <div className={`flex flex-col justify-between gap-2 ${hero ? 'pr-2' : 'border-l border-border pl-8'}`}>
      <span className="t-micro font-medium">{label}</span>
      <span className="flex flex-col">
        <span data-testid={testId} className="num flex flex-col">
          {children}
        </span>
        {caption && <span className="t-micro">{caption}</span>}
      </span>
    </div>
  )
}

function Metric({ value, hero = false, faint = false }: { value: string; hero?: boolean; faint?: boolean }) {
  return (
    <span className={`${hero ? 't-hero' : 't-metric'} ${faint ? 'text-faint' : ''}`}>
      {value}
      <span className="t-unit"> kg</span>
    </span>
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
  const unsavedKey = useUnsavedKey()
  const typed = kg.trim() !== '' || notes.trim() !== ''
  useEffect(() => {
    markUnsaved(unsavedKey, typed ? 'Bodyweight (typed, not saved)' : null)
  }, [unsavedKey, typed])

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
      markUnsaved(unsavedKey, null)
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
      <LoadError what="bodyweight" detail={error} onRetry={() => void load()} />
    ) : (
      <Skeleton label="Loading bodyweight…" blocks={['h-8 w-72', 'h-20', 'h-72']} />
    )
  }

  const { summary, series, entries } = data
  const avgByDate = new Map(series.map((point) => [point.date, point.avg7_kg]))
  const change = summary.change_kg === null ? null : Number(summary.change_kg)
  const ChangeIcon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Bodyweight"
        meta="Morning, after the bathroom, before food or fluid, same scale."
        aside={
          <form onSubmit={(event) => void save(event)} className="flex items-end gap-2" aria-label="Log a weigh-in">
            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Date
              <DateField
                aria-label="Weigh-in date"
                className="w-[9.5rem]"
                value={day}
                max={today}
                onChange={(event) => {
                  setDay(event.target.value)
                  setSaved(null)
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Weight
              <span className="relative">
                <input
                  aria-label="Bodyweight in kg"
                  inputMode="decimal"
                  className={`${inputClass} w-28 pr-8 text-right text-[15px] font-medium`}
                  placeholder={existing?.bodyweight_kg ?? summary.latest?.bodyweight_kg ?? ''}
                  value={kg}
                  aria-invalid={problem !== null || undefined}
                  autoFocus
                  onChange={(event) => {
                    setKg(event.target.value)
                    setProblem(null)
                    setSaved(null)
                  }}
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-faint">kg</span>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Note
              <input
                aria-label="Weigh-in notes"
                placeholder="Optional"
                className={`${inputClass} w-44 placeholder:text-faint`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <Button type="submit" isDisabled={saving} className="h-9 px-4">
              {saving ? 'Saving…' : existing ? 'Replace' : 'Save'}
            </Button>
          </form>
        }
      />
      {(existing || problem || saved) && (
        <div className="-mt-5 flex justify-end text-[12px]">
          {problem ? (
            <p role="alert" className="text-destructive">
              {problem}
            </p>
          ) : saved ? (
            <p role="status" className="animate-in text-ok fade-in">
              {saved}
            </p>
          ) : existing ? (
            <p className="text-muted-foreground">
              {formatShortDate(day)} already has {existing.bodyweight_kg} kg; saving replaces it.
            </p>
          ) : null}
        </div>
      )}

      <section aria-label="Summary" className="flex flex-wrap items-stretch gap-x-8 gap-y-4">
        <Stat label="Latest" testId="bw-latest" hero>
          {summary.latest ? (
            <>
              <Metric value={summary.latest.bodyweight_kg} hero />
              <span className="t-micro"> {formatShortDate(summary.latest.measured_on)}</span>
            </>
          ) : (
            <>
              <span className="t-hero text-faint">—</span>
              <span className="t-micro">no weigh-in yet</span>
            </>
          )}
        </Stat>
        <Stat label="7-day average" testId="bw-avg7">
          <Metric value={summary.current_avg_kg ?? '—'} faint={summary.current_avg_kg === null} />{' '}
          <span className="t-micro">({summary.current_count}/7 days)</span>
        </Stat>
        <Stat label="Previous 7 days" testId="bw-prev7">
          <Metric value={summary.previous_avg_kg ?? '—'} faint={summary.previous_avg_kg === null} />{' '}
          <span className="t-micro">({summary.previous_count}/7 days)</span>
        </Stat>
        <Stat label="Change" testId="bw-change" caption={summary.change_kg === null ? undefined : 'vs previous 7 days'}>
          {summary.change_kg === null ? (
            <>
              <span className="t-metric text-faint">—</span>
              <span className="t-micro">after a week of weigh-ins on each side</span>
            </>
          ) : (
            <>
              <span className="flex items-baseline gap-1">
                <ChangeIcon className="size-6 self-center text-muted-foreground" strokeWidth={2} aria-hidden />
                <span className="t-metric">{signed(summary.change_kg)}</span>
                <span className="t-unit"> kg</span>
                <span className="t-meta"> · {signed(summary.change_pct ?? '0')}%</span>
              </span>
            </>
          )}
        </Stat>
      </section>

      {entries.length === 0 ? (
        <section className="rounded-[10px] border border-border bg-card p-5">
          <EmptyChartFrame height={260}>
            <EmptyState icon={Scale} title="No weigh-ins yet">
              Save your first morning weight above. Daily points and the 7-day trend line start from it.
            </EmptyState>
          </EmptyChartFrame>
        </section>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-12">
          <section aria-label="Trend" className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-5 lg:col-span-8">
            <div className="flex items-baseline justify-between">
              <h2 className="t-section">Trend</h2>
              <span className="t-micro">Last 90 days</span>
            </div>
            <TrendChart
              label="Daily bodyweight and 7-day average"
              unit="kg"
              height={300}
              minSpan={2}
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
                  endLabel: true,
                  values: series.map((point) => (point.avg7_kg === null ? null : Number(point.avg7_kg))),
                },
              ]}
            />
          </section>

          <section aria-label="Weigh-ins" className="flex flex-col rounded-[10px] border border-border bg-card lg:col-span-4">
            <div className="flex items-baseline justify-between px-5 pt-5 pb-3">
              <h2 className="t-section">Weigh-ins</h2>
              <span className="num t-micro">{entries.length} in 90 days</span>
            </div>
            <div className="max-h-[21.5rem] overflow-y-auto px-2 pb-2">
              <table className="num w-full text-[14px]">
                <thead className="sticky top-0 bg-card text-left text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-3 pb-1.5 font-medium">Date</th>
                    <th className="pb-1.5 text-right font-medium">kg</th>
                    <th className="pb-1.5 text-right font-medium">7-day</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.measured_on} data-testid="bw-entry" className="group/row border-t border-border hover:bg-sunken/60">
                      <td className="px-3 py-2">
                        {formatShortDate(entry.measured_on)}
                        {entry.notes && <span className="block truncate text-[12px] text-muted-foreground">{entry.notes}</span>}
                      </td>
                      <td className="py-2 text-right font-semibold">{entry.bodyweight_kg}</td>
                      <td className="py-2 text-right text-muted-foreground">{avgByDate.get(entry.measured_on) ?? ''}</td>
                      <td className="py-2 pr-1 text-right whitespace-nowrap">
                        <span className="opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                          <button
                            type="button"
                            aria-label={`Edit weigh-in of ${entry.measured_on}`}
                            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
                            onClick={() => {
                              setDay(entry.measured_on)
                              setKg(entry.bodyweight_kg)
                              setNotes(entry.notes ?? '')
                              setSaved(null)
                            }}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove weigh-in of ${entry.measured_on}`}
                            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
                            onClick={() => void remove(entry.measured_on, entry.bodyweight_kg)}
                          >
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
