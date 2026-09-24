import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, useTweenedNumber } from './motion'

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))
}

describe('useTweenedNumber', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('jumps straight to a new value when the lifter asks for reduced motion', () => {
    stubMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    const { result, rerender } = renderHook(({ value }) => useTweenedNumber(value), { initialProps: { value: 100 } })
    expect(result.current).toBe(100)
    rerender({ value: 1774 })
    expect(result.current).toBe(1774)
  })

  it('glides to a new value otherwise, and lands on it exactly', () => {
    stubMotion(false)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { result, rerender } = renderHook(({ value }) => useTweenedNumber(value, 300), { initialProps: { value: 0 } })
    // A screen opens on its real number, never on a count-up.
    expect(result.current).toBe(0)
    rerender({ value: 1000 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBeGreaterThan(0)
    expect(result.current).toBeLessThan(1000)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current).toBe(1000)
  })
})
