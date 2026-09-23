import { useEffect, useState } from 'react'
import { confirmLeave } from './unsaved'

export type Route = { name: 'home' } | { name: 'workout'; id: string }

/** Hash routes survive a reload and need no server-side fallback: `#/`, `#/workouts/<id>`. */
export function parseRoute(hash: string): Route {
  const match = /^#\/workouts\/([A-Za-z0-9]+)$/.exec(hash)
  return match?.[1] ? { name: 'workout', id: match[1] } : { name: 'home' }
}

export function workoutHref(id: string): string {
  return `#/workouts/${id}`
}

export function navigate(href: string): void {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href
}

/**
 * The current route. Every way of leaving a workout — a link, Back/Forward, a trackpad
 * swipe — is a hashchange, so this is the one place that asks before unsaved input is
 * dropped; declining puts the workout's address back without a new history entry.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    let current = window.location.hash
    const onChange = () => {
      const next = window.location.hash
      if (next === current) return
      if (parseRoute(current).name === 'workout' && !confirmLeave()) {
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
