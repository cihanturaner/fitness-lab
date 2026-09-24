import { useTweenedNumber } from '@/lib/motion'

/** An integer that glides between values; the final value is always exact. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const shown = useTweenedNumber(value)
  return <span className={className}>{Math.round(shown)}</span>
}
