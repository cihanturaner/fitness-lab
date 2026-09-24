import { useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { formatShortDate } from '@/lib/format'

export interface TrendSeries {
  label: string
  /** CSS color token, e.g. var(--series-trend). */
  color: string
  /** A line is the signal; dots are the quiet raw points behind it. */
  kind: 'line' | 'dots'
  /** Dots on a line's points, for sparse series where each point is one event. */
  markers?: boolean
  /** A reference line (e.g. a target), drawn dashed and thin. */
  dashed?: boolean
  /** Write the line's last value at its end. */
  endLabel?: boolean
  /** A soft wash of the line's colour beneath it (the one signal series only). */
  area?: boolean
  values: (number | null)[]
  /** Optional text per point, drawn above line markers (e.g. reps). */
  pointLabels?: (string | null)[]
}

const PAD = { top: 16, right: 52, bottom: 26, left: 44 }

function niceStep(span: number): number {
  const raw = span / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= raw) ?? 10
  return unit * power
}

/**
 * A line/dot chart over consecutive dates: one y axis, recessive grid, a legend for two or
 * more series, and a crosshair tooltip. Missing values leave gaps — a line is never drawn
 * through a day that has no value. `minSpan` keeps small noise from filling the height.
 */
export function TrendChart({
  dates,
  series,
  unit,
  label,
  height = 240,
  minSpan = 1,
}: {
  dates: string[]
  series: TrendSeries[]
  unit: string
  label: string
  height?: number
  minSpan?: number
}) {
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()
  const areaId = useId()
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
    if (high - low < minSpan) {
      const mid = (high + low) / 2
      low = mid - minSpan / 2
      high = mid + minSpan / 2
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
  const plotH = height - PAD.top - PAD.bottom
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

  /** The closed shape under each continuous run of a line, down to the plot's floor. */
  const areaPath = (items: (number | null)[]) => {
    let d = ''
    let run: [number, number][] = []
    const flush = () => {
      if (run.length > 1) {
        const [firstX] = run[0] as [number, number]
        const [lastX] = run.at(-1) as [number, number]
        const floor = (PAD.top + plotH).toFixed(1)
        d += `M${firstX.toFixed(1)},${floor}` + run.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('') + `L${lastX.toFixed(1)},${floor}Z`
      }
      run = []
    }
    items.forEach((value, index) => {
      if (value === null) return flush()
      run.push([x(index), y(value)])
    })
    flush()
    return d
  }

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setHover(Math.max(0, Math.min(dates.length - 1, Math.round(ratio * (dates.length - 1)))))
  }

  const tickDates =
    dates.length <= 1
      ? dates.map((_, i) => i)
      : dates.length <= 4
        ? dates.map((_, i) => i)
        : [0, Math.floor((dates.length - 1) / 3), Math.floor(((dates.length - 1) * 2) / 3), dates.length - 1]

  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
          {series.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              {item.kind === 'line' ? (
                <span
                  className="inline-block h-0 w-4 border-t-2"
                  style={{ borderColor: item.color, borderStyle: item.dashed ? 'dashed' : 'solid' }}
                />
              ) : (
                <span className="inline-block size-1.5 rounded-full" style={{ background: item.color }} />
              )}
              {item.label}
            </span>
          ))}
        </figcaption>
      )}
      <div ref={measure} className="relative w-full">
        <svg width="100%" height={height} role="img" aria-label={label} className="num">
          <defs>
            <linearGradient id={areaId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--emerald-500)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--emerald-500)" stopOpacity={0} />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x={PAD.left - 8} y={PAD.top - 8} width={plotW + 16} height={plotH + 16} />
            </clipPath>
          </defs>
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 4" />
              <text x={PAD.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
                {tick}
              </text>
            </g>
          ))}
          {tickDates.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 6}
              textAnchor={
                dates.length === 1 ? 'middle' : index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'
              }
              className="fill-muted-foreground text-[11px]"
            >
              {formatShortDate(dates[index] ?? '')}
            </text>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {series.map((item) => (
              <g key={item.label}>
                {item.kind === 'line' && item.area && <path d={areaPath(item.values)} fill={`url(#${areaId})`} className="fade-late" />}
                {item.kind === 'line' && (
                  <path
                    d={path(item.values)}
                    // Solid lines draw themselves in once; a dashed reference line just appears.
                    pathLength={item.dashed ? undefined : 1}
                    className={item.dashed ? undefined : 'draw'}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={item.dashed ? 1.25 : 2.5}
                    strokeDasharray={item.dashed ? '4 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {item.kind === 'dots' && (
                  <g className="fade-late">
                    {item.values.map((value, index) =>
                      value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={2.75} fill={item.color} />,
                    )}
                  </g>
                )}
                {item.kind === 'line' &&
                  item.markers &&
                  item.values.map((value, index) =>
                    value === null ? null : (
                      <g key={index} className="fade-late">
                        <circle cx={x(index)} cy={y(value)} r={4} fill={item.color} stroke="var(--card)" strokeWidth={2} />
                        {item.pointLabels?.[index] && (
                          <text x={x(index)} y={y(value) - 10} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                            {item.pointLabels[index]}
                          </text>
                        )}
                      </g>
                    ),
                  )}
              </g>
            ))}
          </g>
          {series
            .filter((item) => item.endLabel)
            .map((item) => {
              const at = item.values.findLastIndex((value) => value !== null)
              const value = item.values[at]
              if (at < 0 || value === null || value === undefined) return null
              return (
                <g key={item.label} className="fade-late">
                  <circle cx={x(at)} cy={y(value)} r={5} fill={item.color} stroke="var(--card)" strokeWidth={2.5} />
                  <text x={x(at) + 10} y={y(value)} dy="0.32em" className="text-[13px] font-semibold" fill={item.color}>
                    {value.toFixed(2)}
                  </text>
                </g>
              )
            })}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--faint)" strokeWidth={1} strokeDasharray="2 3" />
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
            className="pointer-events-none absolute top-2 min-w-36 animate-in rounded-[12px] bg-popover px-3 py-2 text-[12px] shadow-[var(--shadow-raised)] fade-in duration-150"
            style={{ left: Math.min(x(hover) + 10, width - 160) }}
          >
            <p className="font-medium">{formatShortDate(dates[hover])}</p>
            {series.map((item) => (
              <p key={item.label} className="num flex justify-between gap-3 text-muted-foreground">
                {item.label}
                <span className="text-foreground">
                  {item.values[hover] ?? '—'}
                  {item.values[hover] !== null && item.values[hover] !== undefined ? ` ${unit}` : ''}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}

/** The chart's frame with no data yet: its gridlines stay, the message sits inside. */
export function EmptyChartFrame({ height = 240, children }: { height?: number; children: ReactNode }) {
  return (
    <div className="relative w-full" style={{ height }}>
      <div className="absolute inset-x-11 inset-y-4 flex flex-col justify-between" aria-hidden>
        {[0, 1, 2, 3, 4].map((line) => (
          <div key={line} className="border-t border-dashed border-border" />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="rounded-lg bg-card/90 px-2">{children}</div>
      </div>
    </div>
  )
}
