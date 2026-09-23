import { useEffect, useState } from 'react'

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

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
