import { useEffect, useState } from 'react'
import { confirmLeave } from './unsaved'

export type Route =
  | { name: 'home' }
  | { name: 'training'; week: string | null }
  | { name: 'workout'; id: string }
  | { name: 'bodyweight' }
  | { name: 'nutrition' }
  | { name: 'history' }
  | { name: 'exercises'; exerciseId: string | null }
  | { name: 'settings' }

/**
 * Hash routes survive a reload and need no server-side fallback: `#/` (Home), `#/training`,
 * `#/training/<date>`, `#/workouts/<id>`, `#/bodyweight`, `#/nutrition`, `#/history` (the
 * day-by-day timeline, the only primary History view), `#/history/exercises`,
 * `#/history/<exerciseId>` (exercise history, secondary), `#/settings`. The pre-V3.2
 * `#/week/<date>` still opens that week, now on Training; the retired `#/sessions` list
 * (V3.3.1) opens the day timeline, which holds the same sessions.
 */
export function parseRoute(hash: string): Route {
  const workout = /^#\/workouts\/([A-Za-z0-9]+)$/.exec(hash)
  if (workout?.[1]) return { name: 'workout', id: workout[1] }
  if (hash === '#/history') return { name: 'history' }
  if (hash === '#/history/exercises') return { name: 'exercises', exerciseId: null }
  const exercise = /^#\/history\/([A-Za-z0-9]+)$/.exec(hash)
  if (exercise?.[1]) return { name: 'exercises', exerciseId: exercise[1] }
  if (hash === '#/bodyweight') return { name: 'bodyweight' }
  if (hash === '#/nutrition') return { name: 'nutrition' }
  if (hash === '#/sessions') return { name: 'history' }
  if (hash === '#/settings') return { name: 'settings' }
  if (hash === '#/training') return { name: 'training', week: null }
  const week = /^#\/(?:training|week)\/(\d{4}-\d{2}-\d{2})$/.exec(hash)
  if (week?.[1]) return { name: 'training', week: week[1] }
  return { name: 'home' }
}

/** The Training week containing `date`; `#/training` is always the current week. */
export function weekHref(date: string): string {
  return `#/training/${date}`
}

export const TRAINING_HREF = '#/training'

const BACK_LABELS: Partial<Record<Route['name'], string>> = {
  home: 'Home',
  training: 'Training',
  history: 'History',
  exercises: 'Exercise history',
}

// The last screen that is not a workout: where a workout's Back link returns to.
let back = { href: '#/', label: 'Home' }

function remember(hash: string): void {
  const route = parseRoute(hash)
  const label = BACK_LABELS[route.name]
  if (label) back = { href: hash === '' ? '#/' : hash, label }
}

/** Where "Back" on a workout goes: the screen it was opened from (default Home). */
export function backTarget(): { href: string; label: string } {
  return back
}

export const EXERCISES_HREF = '#/history/exercises'

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
  const [route, setRoute] = useState(() => {
    remember(window.location.hash)
    return parseRoute(window.location.hash)
  })
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
      remember(next)
      setRoute(parseRoute(next))
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
