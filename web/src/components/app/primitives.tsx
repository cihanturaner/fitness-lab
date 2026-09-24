import type { CSSProperties, InputHTMLAttributes, MouseEvent, ReactNode } from 'react'
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
      <span className="flex size-12 items-center justify-center rounded-[12px] bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-700 shadow-[inset_0_0_0_1px_rgb(27_104_79/0.08)]">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
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
    <div role="status" aria-label={label} className="skeleton-in flex flex-col gap-6">
      {blocks.map((block, index) => (
        <div key={index} className={`animate-pulse rounded-[14px] bg-card/70 ${block}`} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

const CALLOUT = {
  error: { icon: AlertCircle, className: 'border-destructive/30 bg-destructive/5 text-destructive' },
  ok: { icon: CheckCircle2, className: 'border-ok/20 bg-ok-surface text-ok' },
  warn: { icon: AlertCircle, className: 'border-warn/20 bg-warn-surface text-warn' },
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
  role?: 'alert' | 'status' | 'alertdialog'
  testId?: string
}) {
  const { icon: Icon, className } = CALLOUT[tone]
  return (
    <div
      role={role}
      data-testid={testId}
      className={`flex animate-in gap-2.5 rounded-[14px] border px-4 py-3 fade-in slide-in-from-top-1 duration-200 ${className}`}
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
        className="press rounded-[10px] border border-border-strong bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-sunken"
        onClick={onRetry ?? (() => window.location.reload())}
      >
        Try again
      </button>
    </div>
  )
}

/** A small status signal: a dot and a word. */
export function StatusDot({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'plan'; children: ReactNode }) {
  const dot = { ok: 'bg-ok', warn: 'bg-emerald-500', muted: 'bg-faint', plan: 'bg-plan' }[tone]
  const text = {
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'border border-dashed border-emerald-600/60 bg-emerald-50 text-emerald-800',
    muted: 'bg-sunken text-muted-foreground',
    plan: 'bg-plan-surface text-plan',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${text}`}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  )
}

/**
 * Logged against a known target: a bar whose fill is the logged share (capped at the
 * track), with a tick at the target. Only ever drawn when the target is known. The fill
 * grows in from the left when it first appears and glides when the value changes.
 */
export function Meter({
  value,
  target,
  height = 6,
  color,
}: {
  value: number | null
  target: number
  height?: number
  /** A CSS colour for the fill; default: emerald, deepening once the target is met. */
  color?: string
}) {
  // The track spans 0–125 % of target so "over" is visible past the tick.
  const span = target * 1.25
  const share = value === null ? 0 : Math.min(value / span, 1)
  const met = value !== null && value >= target
  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      <div className="absolute inset-0 rounded-full bg-sunken shadow-[inset_0_1px_1px_rgb(16_52_38/0.06)]" />
      <div
        className={`fill-in absolute inset-y-0 left-0 rounded-full ${color ? '' : met ? 'bg-emerald-700' : 'bg-gradient-to-r from-emerald-600 to-emerald-500'}`}
        style={{ width: `${share * 100}%`, background: color }}
      />
      <div className="absolute -inset-y-[3px] w-[2px] rounded-full bg-foreground/45" style={{ left: `${(1 / 1.25) * 100}%` }} />
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
      className={`relative inline-flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-[14px] transition-[border-color,box-shadow,background-color] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15 ${
        input.disabled
          ? 'border-transparent px-0'
          : quiet
            ? 'border-transparent hover:border-border-strong hover:bg-card'
            : 'border-border-strong bg-card shadow-[0_1px_2px_rgb(16_52_38/0.05)] hover:border-input'
      } ${className}`}
    >
      {!input.disabled && <CalendarDays className="size-4 shrink-0 text-emerald-700/70" aria-hidden />}
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

/**
 * A radial progress ring: the share of `max` reached, capped at a full circle. The arc grows
 * in when it first appears and glides when the value changes (reduced motion: instant).
 */
export function ProgressRing({
  value,
  max,
  size = 120,
  stroke = 10,
  track = 'var(--sunken)',
  color = 'var(--emerald-600)',
  children,
  label,
  segments,
}: {
  value: number
  max: number | null
  size?: number
  stroke?: number
  track?: string
  color?: string
  children?: ReactNode
  label?: string
  /** Parts of the value in their own colours (e.g. calories by macro), drawn end to end. */
  segments?: { value: number; color: string }[]
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const share = max === null || max <= 0 ? 0 : Math.max(0, Math.min(value / max, 1))
  // Segment arcs share the filled length in proportion; 2 px gaps keep the parts legible.
  const filled = circumference * share
  const parts = (segments ?? []).filter((part) => part.value > 0)
  const partsTotal = parts.reduce((sum, part) => sum + part.value, 0)
  let cursor = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        {segments !== undefined &&
          share > 0 &&
          parts.map((part) => {
            const length = partsTotal > 0 ? (filled * part.value) / partsTotal : 0
            const start = cursor
            cursor += length
            const gap = parts.length > 1 ? Math.min(2, length / 2) : 0
            return (
              <circle
                key={part.color}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={part.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(length - gap, 0)} ${circumference}`}
                strokeDashoffset={-start}
                className="ring-segment"
                style={{ '--ring-c': `${circumference}px` } as CSSProperties}
              />
            )
          })}
        {segments === undefined && share > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
            className="ring-arc"
            style={{ '--ring-c': `${circumference}px` } as CSSProperties}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}
