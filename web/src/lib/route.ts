import { useEffect, useState } from 'react'
import { confirmLeave } from './unsaved'

export type Route =
  | { name: 'home'; week: string | null }
  | { name: 'workout'; id: string }
  | { name: 'bodyweight' }
  | { name: 'nutrition' }
  | { name: 'history'; exerciseId: string | null }
  | { name: 'sessions' }
  | { name: 'settings' }

/**
 * Hash routes survive a reload and need no server-side fallback: `#/`, `#/week/<date>`,
 * `#/workouts/<id>`, `#/bodyweight`, `#/nutrition`, `#/history`, `#/history/<exerciseId>`,
 * `#/sessions`, `#/settings`.
 */
export function parseRoute(hash: string): Route {
  const workout = /^#\/workouts\/([A-Za-z0-9]+)$/.exec(hash)
  if (workout?.[1]) return { name: 'workout', id: workout[1] }
  const history = /^#\/history(?:\/([A-Za-z0-9]+))?$/.exec(hash)
  if (history) return { name: 'history', exerciseId: history[1] ?? null }
  if (hash === '#/bodyweight') return { name: 'bodyweight' }
  if (hash === '#/nutrition') return { name: 'nutrition' }
  if (hash === '#/sessions') return { name: 'sessions' }
  if (hash === '#/settings') return { name: 'settings' }
  const week = /^#\/week\/(\d{4}-\d{2}-\d{2})$/.exec(hash)
  if (week?.[1]) return { name: 'home', week: week[1] }
  return { name: 'home', week: null }
}

/** The week containing `date`; `#/` is always the current week. */
export function weekHref(date: string): string {
  return `#/week/${date}`
}

export function historyHref(exerciseId: string): string {
  return `#/history/${exerciseId}`
}

export function workoutHref(id: string): string {
  return `#/workouts/${id}`
}

export function navigate(href: string): void {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href
}

/**
 * The current route. Every way of leaving a screen — a link, Back/Forward, a trackpad
 * swipe — is a hashchange, so this is the one place that asks before unsaved input is
 * dropped; declining puts the screen's address back without a new history entry.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    let current = window.location.hash
    const onChange = () => {
      const next = window.location.hash
      if (next === current) return
      if (!confirmLeave()) {
        window.history.replaceState(null, '', current)
        return
      }
      current = next
      setRoute(parseRoute(next))
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
