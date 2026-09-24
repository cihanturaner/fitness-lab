import { useId, useRef, useState } from 'react'

/**
 * A word-sized trend: faint daily points and a stronger line (e.g. the 7-day average), with
 * a dot on the line's last value. No axes; the numbers beside it carry the scale. Missing
 * values leave gaps. Renders nothing until there are two values to connect or place.
 */
export function Sparkline({
  points,
  line,
  height = 44,
  minSpan = 1,
  label,
}: {
  points: (number | null)[]
  line: (number | null)[]
  height?: number
  /** The smallest y-range shown, so small noise does not look like a cliff. */
  minSpan?: number
  label: string
}) {
  const [width, setWidth] = useState(200)
  const gradient = useId()
  const observer = useRef<ResizeObserver | null>(null)
  const measure = (node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!node || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.current.observe(node)
  }

  const values = [...points, ...line].filter((value): value is number => value !== null)
  const count = Math.max(points.length, line.length)
  if (values.length < 2 || count < 2) return null
  let low = Math.min(...values)
  let high = Math.max(...values)
  if (high - low < minSpan) {
    const mid = (high + low) / 2
    low = mid - minSpan / 2
    high = mid + minSpan / 2
  }
  const pad = 4
  const x = (index: number) => pad + (index / (count - 1)) * (width - pad * 2)
  const y = (value: number) => pad + (1 - (value - low) / (high - low)) * (height - pad * 2)

  let d = ''
  let area = ''
  let segment: string[] = []
  const closeSegment = () => {
    if (segment.length > 1) {
      const first = segment[0]?.split(',')[0]
      const last = segment.at(-1)?.split(',')[0]
      area += `M${first},${height}L${segment.join('L')}L${last},${height}Z`
    }
    segment = []
  }
  line.forEach((value, index) => {
    if (value === null) {
      if (segment.length > 0) closeSegment()
      return
    }
    const point = `${x(index).toFixed(1)},${y(value).toFixed(1)}`
    d += `${segment.length > 0 ? 'L' : 'M'}${point}`
    segment.push(point)
  })
  closeSegment()
  const lastIndex = line.findLastIndex((value) => value !== null)
  const last = lastIndex >= 0 ? line[lastIndex] : null

  return (
    <div ref={measure} className="w-full">
      <svg width="100%" height={height} role="img" aria-label={label}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--emerald-500)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--emerald-500)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#${gradient})`} className="fade-late" />}
        {points.map((value, index) =>
          value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={1.75} fill="var(--series-daily)" />,
        )}
        <path
          d={d}
          pathLength={1}
          className="draw"
          fill="none"
          stroke="var(--series-trend)"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {last !== null && last !== undefined && (
          <circle
            cx={x(lastIndex)}
            cy={y(last)}
            r={3.5}
            fill="var(--series-trend)"
            stroke="var(--card)"
            strokeWidth={2}
            className="fade-late"
          />
        )}
      </svg>
    </div>
  )
}
