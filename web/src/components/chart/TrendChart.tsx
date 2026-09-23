import { useId, useRef, useState, type PointerEvent } from 'react'
import { formatShortDate } from '@/lib/format'

export interface TrendSeries {
  label: string
  /** CSS color token, e.g. var(--series-trend). */
  color: string
  kind: 'line' | 'dots'
  /** Dots on a line's points, for sparse series where each point is one event. */
  markers?: boolean
  values: (number | null)[]
}

const HEIGHT = 180
const PAD = { top: 10, right: 12, bottom: 22, left: 40 }

function niceStep(span: number): number {
  const raw = span / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= raw) ?? 10
  return unit * power
}

/**
 * A small line/dot chart over consecutive dates: one y axis, recessive grid, a legend
 * for two or more series, and a crosshair tooltip. Missing values leave gaps — a line is
 * never drawn through a day that has no value.
 */
export function TrendChart({
  dates,
  series,
  unit,
  label,
}: {
  dates: string[]
  series: TrendSeries[]
  unit: string
  label: string
}) {
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()
  const observer = useRef<ResizeObserver | null>(null)
  const measure = (node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!node || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.current.observe(node)
  }

  const values = series.flatMap((item) => item.values.filter((value): value is number => value !== null))
  const scale = (() => {
    if (values.length === 0) return null
    let low = Math.min(...values)
    let high = Math.max(...values)
    if (high - low < 1) {
      const mid = (high + low) / 2
      low = mid - 0.5
      high = mid + 0.5
    }
    const step = niceStep(high - low)
    const min = Math.floor(low / step) * step
    const max = Math.ceil(high / step) * step
    const ticks: number[] = []
    for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toFixed(6)))
    return { min, max, ticks }
  })()

  if (!scale || dates.length === 0) return null
  const plotW = Math.max(width - PAD.left - PAD.right, 10)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (index: number) => PAD.left + (dates.length === 1 ? plotW / 2 : (index / (dates.length - 1)) * plotW)
  const y = (value: number) => PAD.top + (1 - (value - scale.min) / (scale.max - scale.min)) * plotH

  const path = (items: (number | null)[]) => {
    let d = ''
    let pen = false
    items.forEach((value, index) => {
      if (value === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`
      pen = true
    })
    return d
  }

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setHover(Math.round(ratio * (dates.length - 1)))
  }

  const tickDates = dates.length <= 1 ? dates.map((_, i) => i) : [0, Math.floor((dates.length - 1) / 2), dates.length - 1]

  return (
    <figure className="flex flex-col gap-1" aria-label={label}>
      {series.length > 1 && (
        <figcaption className="flex gap-4 text-[11px] text-muted-foreground">
          {series.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              {item.kind === 'line' ? (
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: item.color }} />
              ) : (
                <span className="inline-block size-2 rounded-full" style={{ background: item.color }} />
              )}
              {item.label}
            </span>
          ))}
        </figcaption>
      )}
      <div ref={measure} className="relative w-full">
        <svg width="100%" height={HEIGHT} role="img" aria-label={label}>
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left - 6} y={PAD.top - 6} width={plotW + 12} height={plotH + 12} />
            </clipPath>
          </defs>
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="num fill-muted-foreground text-[10px]">
                {tick}
              </text>
            </g>
          ))}
          {tickDates.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={HEIGHT - 6}
              textAnchor={index === 0 && dates.length > 1 ? 'start' : index === dates.length - 1 && dates.length > 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[10px]"
            >
              {formatShortDate(dates[index] ?? '')}
            </text>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {series.map((item) => (
              <g key={item.label}>
                {item.kind === 'line' && (
                  <path d={path(item.values)} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                )}
                {(item.kind === 'dots' || item.markers) &&
                  item.values.map((value, index) =>
                    value === null ? null : (
                      <circle key={index} cx={x(index)} cy={y(value)} r={item.markers ? 4 : 3} fill={item.color} stroke="var(--card)" strokeWidth={1.5} />
                    ),
                  )}
              </g>
            ))}
          </g>
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="2 2" />
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && dates[hover] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] shadow-sm"
            style={{ left: Math.min(x(hover) + 8, width - 140) }}
          >
            <p className="font-medium">{formatShortDate(dates[hover])}</p>
            {series.map((item) => (
              <p key={item.label} className="num text-muted-foreground">
                {item.label}: <span className="text-foreground">{item.values[hover] ?? '—'}</span>
                {item.values[hover] !== null && item.values[hover] !== undefined ? ` ${unit}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
