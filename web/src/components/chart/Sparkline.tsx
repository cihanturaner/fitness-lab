import { useRef, useState } from 'react'

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
  let pen = false
  line.forEach((value, index) => {
    if (value === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`
    pen = true
  })
  const lastIndex = line.findLastIndex((value) => value !== null)
  const last = lastIndex >= 0 ? line[lastIndex] : null

  return (
    <div ref={measure} className="w-full">
      <svg width="100%" height={height} role="img" aria-label={label}>
        {points.map((value, index) =>
          value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={1.75} fill="var(--series-daily)" />,
        )}
        <path d={d} fill="none" stroke="var(--series-trend)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last !== null && last !== undefined && (
          <circle cx={x(lastIndex)} cy={y(last)} r={3} fill="var(--series-trend)" stroke="var(--card)" strokeWidth={1.5} />
        )}
      </svg>
    </div>
  )
}
