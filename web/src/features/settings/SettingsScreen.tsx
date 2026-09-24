import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, HardDriveDownload } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { ActiveProgram, Backup, Week } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DateField, LoadError, PageHeader, Skeleton } from '@/components/app/primitives'
import { addDays, formatRange, formatShortDate, localDate, mondayOf } from '@/lib/format'
import { ProgramRules } from './ProgramRules'

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

type Loaded = { program: ActiveProgram; week: Week; backups: Backup[] }

const BACKUP_KIND: Record<Backup['kind'], string> = {
  manual: 'Manual backup',
  'pre-migration': 'Before an update',
  'pre-delete': 'Before a delete',
  other: 'Snapshot',
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 className="t-section">{title}</h2>
        {aside && <div className="t-micro">{aside}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

/** "In week 1, Mon 5 Oct – Wed 7 Oct count as pre-block" for a start that is not a Monday. */
function preBlockDays(start: string): string | null {
  const monday = mondayOf(start)
  if (monday === start) return null
  const last = addDays(start, -1)
  return last === monday ? formatShortDate(monday) : `${formatShortDate(monday)} – ${formatShortDate(last)}`
}

function BlockSettings({ loaded, onSaved }: { loaded: Loaded; onSaved: () => Promise<void> }) {
  const current = loaded.week.block?.start_on ?? ''
  const [start, setStart] = useState(current)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const version = loaded.program.version

  if (!version) {
    return (
      <Section title="Training block">
        <p className="t-meta">
          No program is active. Programs are imported and activated from the command line; the block start is set here
          afterwards.
        </p>
      </Section>
    )
  }
  const monday = current ? mondayOf(current) : null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      setProblem('Pick a date first.')
      return
    }
    const weekOne = mondayOf(start)
    const pre = preBlockDays(start)
    const question =
      `Start the block on ${formatShortDate(start)}? Week 1 becomes ${formatRange(weekOne, addDays(weekOne, 6))}` +
      (pre ? `; in week 1, ${pre} count as pre-block.` : '.') +
      ' Recorded workouts keep their dates; only their week numbers follow the new start.'
    if (!window.confirm(question)) return
    setProblem(null)
    try {
      const result = await api.putBlockStart(start)
      setSaved(`Block start saved: week 1 is ${formatRange(result.week_1_start, result.week_1_end)}.`)
      await onSaved()
    } catch (failure) {
      setProblem(`Not saved: ${message(failure)}`)
    }
  }

  return (
    <Section
      title="Training block"
      aside="Week 1 is the Monday–Sunday week containing the start date. Days before the start date are pre-block."
    >
      <dl className="num grid grid-cols-[10rem_minmax(0,1fr)] gap-y-2 text-[14px]">
        <dt className="text-muted-foreground">Start date</dt>
        <dd data-testid="block-start" className="font-medium">
          {current ? formatShortDate(current) : 'Not set — weeks are not numbered yet'}
        </dd>
        {monday && (
          <>
            <dt className="text-muted-foreground">Week 1</dt>
            <dd data-testid="block-week-1">{formatRange(monday, addDays(monday, 6))}</dd>
            <dt className="text-muted-foreground">Length</dt>
            <dd>{version.duration_weeks ?? '—'} weeks</dd>
          </>
        )}
      </dl>
      <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
          {current ? 'Change the start date' : 'Set the start date'}
          <DateField
            aria-label="Block start date"
            className="w-[10rem]"
            value={start}
            onChange={(event) => {
              setStart(event.target.value)
              setSaved(null)
              setProblem(null)
            }}
          />
        </label>
        <Button type="submit" className="h-9" isDisabled={start === current}>
          Save start date
        </Button>
      </form>
      {start && start !== current && preBlockDays(start) && (
        <p className="t-micro">A Monday start makes week 1 a full training week; this one leaves pre-block days in it.</p>
      )}
      {saved && (
        <p role="status" className="inline-flex items-center gap-1 text-[13px] text-ok">
          <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
          {saved}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-[13px] text-destructive">
          {problem}
        </p>
      )}
    </Section>
  )
}

function Backups({ backups, onSaved }: { backups: Backup[]; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const backup = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await api.backup()
      setSaved(`Backup saved and verified: ${made.name}`)
      await onSaved()
    } catch (failure) {
      setProblem(`No backup was made: ${message(failure)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="Backups"
      aside="A backup is a verified full copy of the database in data/snapshots/ on this machine. Copies are also taken automatically before updates and deletions."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-9 gap-1.5" isDisabled={busy} onPress={() => void backup()}>
          <HardDriveDownload aria-hidden />
          Back up now
        </Button>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1 text-[13px] text-ok">
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
      {backups.length === 0 ? (
        <p className="t-meta">No backups yet.</p>
      ) : (
        <table className="num w-full max-w-2xl text-[13px]">
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr className="border-b border-border-strong">
              <th className="py-2 pr-4 font-medium">When (UTC)</th>
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {backups.slice(0, 8).map((item) => (
              <tr key={item.name} data-testid="backup-row" className="border-b border-border" title={item.name}>
                <td className="py-2 pr-4">{item.created_at_utc.replace('T', ' ').replace('Z', '')}</td>
                <td className="py-2 pr-4">{BACKUP_KIND[item.kind]}</td>
                <td className="py-2 text-right text-muted-foreground">{Math.max(1, Math.round(item.size_bytes / 1024))} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="t-micro">
        To restore: stop the app, copy the chosen backup over data/fitness_lab.db, then delete data/fitness_lab.db-wal and
        data/fitness_lab.db-shm if present.
      </p>
    </Section>
  )
}

/** Routine settings: the block start, the program in force and its rules, backups. */
export function SettingsScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = localDate()

  const load = useCallback(
    () =>
      Promise.all([api.activeProgram(), api.week(today, today), api.backups()]).then(
        ([program, week, backups]) => {
          setLoaded({ program, week, backups })
          setError(null)
        },
        (failure: unknown) => setError(message(failure)),
      ),
    [today],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (!loaded) {
    return error ? <LoadError what="settings" detail={error} /> : <Skeleton label="Loading settings…" blocks={['h-8 w-60', 'h-40', 'h-40']} />
  }
  const version = loaded.program.version
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" meta="Everything here stays on this machine." />
      <BlockSettings loaded={loaded} onSaved={load} />
      <Section title="Calorie target" aside="Recorded on the Nutrition screen, where every target and its reason stay listed.">
        <p className="t-meta">
          The app never sets or changes calories on its own. Record a target, or apply a weekly review recommendation, on{' '}
          <a href="#/nutrition" className="font-medium text-foreground underline">
            Nutrition
          </a>
          .
        </p>
      </Section>
      <Section title="Program" aside="Importing and switching programs stays a command-line task.">
        {version ? (
          <>
            <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-2 text-[14px]">
              <dt className="text-muted-foreground">Program</dt>
              <dd className="font-medium">{version.name}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="num">{version.version_label ?? '—'}</dd>
              <dt className="text-muted-foreground">Active since</dt>
              <dd className="num">{loaded.program.activated_at_utc ? formatShortDate(loaded.program.activated_at_utc.slice(0, 10)) : '—'}</dd>
            </dl>
            {loaded.program.notes_text && (
              <div className="flex flex-col gap-2">
                <h3 className="text-[13px] font-medium">Program rules</h3>
                <p className="t-micro">
                  From the locked program. Progression, deload, calibration and the week-12 benchmark are guidance for your
                  decisions; the app does not apply them.
                </p>
                <ProgramRules notes={loaded.program.notes_text} />
              </div>
            )}
          </>
        ) : (
          <p className="t-meta">No program is active.</p>
        )}
      </Section>
      <Backups backups={loaded.backups} onSaved={load} />
    </div>
  )
}
