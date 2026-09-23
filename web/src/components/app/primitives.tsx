import type { InputHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { AlertCircle, CalendarDays, CheckCircle2, Info, type LucideIcon } from 'lucide-react'
import { formatShortDate } from '@/lib/format'

/** A page title with its secondary line and optional right-hand controls. */
export function PageHeader({
  title,
  meta,
  aside,
  children,
}: {
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="t-title">{title}</h1>
          {children}
        </div>
        {meta && <div className="t-meta">{meta}</div>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-3">{aside}</div>}
    </header>
  )
}

/** A section title on the paper, with an optional link or control at its right. */
export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="t-section">
        {children}
      </h2>
      {aside}
    </div>
  )
}

/**
 * An empty state: what is missing, why, what creates it, what appears later. Compact and
 * centred in the space the data will occupy, never a sentence in a void.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className = '',
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 px-6 py-8 text-center ${className}`}>
      <span className="flex size-10 items-center justify-center rounded-full bg-sunken text-muted-foreground">
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="t-body font-medium">{title}</p>
        {children && <div className="t-meta">{children}</div>}
      </div>
      {action}
    </div>
  )
}

/** Placeholder blocks while a screen loads; announced once for assistive tech. */
export function Skeleton({ label, blocks = ['h-8 w-72', 'h-28', 'h-56'] }: { label: string; blocks?: string[] }) {
  return (
    <div role="status" aria-label={label} className="flex animate-in flex-col gap-6 fade-in duration-300">
      {blocks.map((block, index) => (
        <div key={index} className={`animate-pulse rounded-[10px] bg-sunken ${block}`} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

const CALLOUT = {
  error: { icon: AlertCircle, className: 'border-destructive/30 bg-destructive/5 text-destructive' },
  ok: { icon: CheckCircle2, className: 'border-ok/25 bg-ok-surface text-ok' },
  warn: { icon: AlertCircle, className: 'border-warn/25 bg-warn-surface text-warn' },
  info: { icon: Info, className: 'border-plan-rule/60 bg-plan-surface text-plan' },
} as const

/** A message with a cause and, where there is one, the fix. */
export function Callout({
  tone,
  title,
  children,
  role,
  testId,
}: {
  tone: keyof typeof CALLOUT
  title: ReactNode
  children?: ReactNode
  role?: 'alert' | 'status'
  testId?: string
}) {
  const { icon: Icon, className } = CALLOUT[tone]
  return (
    <div
      role={role}
      data-testid={testId}
      className={`flex animate-in gap-2.5 rounded-lg border px-3.5 py-2.5 fade-in duration-200 ${className}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1 text-[13px] leading-[18px]">
        <div className="font-medium">{title}</div>
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </div>
  )
}

/** A screen that failed to load: the plain cause, then the raw detail, then a retry. */
export function LoadError({ what, detail, onRetry }: { what: string; detail: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-[18px]" aria-hidden />
      </span>
      <p className="t-body font-medium">Could not load {what}.</p>
      <p className="t-micro">{detail}</p>
      <button
        type="button"
        className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-sunken"
        onClick={onRetry ?? (() => window.location.reload())}
      >
        Try again
      </button>
    </div>
  )
}

/** A small status signal: a dot and a word. */
export function StatusDot({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'plan'; children: ReactNode }) {
  const dot = { ok: 'bg-ok', warn: 'bg-warn', muted: 'bg-faint', plan: 'bg-plan' }[tone]
  const text = { ok: 'text-ok', warn: 'text-warn', muted: 'text-muted-foreground', plan: 'text-plan' }[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${text}`}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  )
}

/**
 * Logged against a known target: a thin bar whose fill is the logged share (capped at the
 * track), with a tick at the target. Only ever drawn when the target is known.
 */
export function Meter({ value, target, height = 6 }: { value: number | null; target: number; height?: number }) {
  // The track spans 0–125 % of target so "over" is visible past the tick.
  const span = target * 1.25
  const share = value === null ? 0 : Math.min(value / span, 1)
  const met = value !== null && value >= target
  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      <div className="absolute inset-0 rounded-full bg-sunken" />
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${met ? 'bg-foreground' : 'bg-plan'}`}
        style={{ width: `${share * 100}%` }}
      />
      <div className="absolute -inset-y-[3px] w-px bg-foreground/60" style={{ left: `${(1 / 1.25) * 100}%` }} />
    </div>
  )
}

/** Opens the platform date picker where the browser allows it (Chrome, Safari 16.4+). */
function openPicker(event: MouseEvent<HTMLInputElement>) {
  try {
    event.currentTarget.showPicker()
  } catch {
    // Not supported or not allowed here: the field still takes typed dates.
  }
}

/**
 * A date field that reads like every other date in the product ("Wed 23 Sep") instead of
 * the operating system's numeric format. The real native date input sits on top, transparent
 * and full size: it takes the click (opening the picker), the keyboard and the label, so
 * behaviour, accessibility and tests are the native field's.
 */
export function DateField({
  value,
  className = '',
  quiet = false,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'className'> & {
  value: string
  className?: string
  /** No border until hovered: for a read-only record. */
  quiet?: boolean
}) {
  return (
    <span
      className={`relative inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-[14px] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40 ${
        input.disabled
          ? 'border-transparent px-0'
          : quiet
            ? 'border-transparent hover:border-border-strong hover:bg-card'
            : 'border-input bg-card hover:border-border-strong'
      } ${className}`}
    >
      {!input.disabled && <CalendarDays className="size-4 shrink-0 text-faint" aria-hidden />}
      <span aria-hidden className="num whitespace-nowrap">
        {/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatShortDate(value) : 'Pick a date'}
      </span>
      <input
        {...input}
        type="date"
        value={value}
        onClick={(event) => {
          openPicker(event)
          input.onClick?.(event)
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 outline-none disabled:cursor-default [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </span>
  )
}
