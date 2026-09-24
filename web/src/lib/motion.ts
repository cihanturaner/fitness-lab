import { useEffect, useRef, useState } from 'react'

/**
 * Motion answers what the lifter did: a value changing, a set saved, a section opening.
 * Nothing loops. Every duration here is ~150–300 ms ease-out, and "reduce motion" turns
 * each effect into an instant state change (see also the global rule in index.css).
 */
export function prefersReducedMotion(): boolean {
  // No matchMedia (jsdom, very old engines): behave as if motion were reduced — instant.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * A number that glides to its new value when it changes (never on first render: a screen
 * opens on its real numbers, not on a count-up). Returns the value to display; with reduced
 * motion that is always the value itself.
 */
export function useTweenedNumber(value: number, duration = 300): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const reduce = prefersReducedMotion()

  useEffect(() => {
    const start = from.current
    if (reduce || start === value || typeof requestAnimationFrame !== 'function') {
      from.current = value
      return
    }
    let frame = 0
    const began = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - began) / duration, 1)
      const next = t === 1 ? value : start + (value - start) * easeOut(t)
      from.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, reduce])

  return reduce ? value : shown
}
