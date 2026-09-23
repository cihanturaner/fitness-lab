import { useEffect, useId } from 'react'

/**
 * Everything the lifter has typed that is not yet saved, keyed by the input that holds it.
 * Completing a workout, leaving the screen and closing the tab all check this first, so
 * typed evidence is never dropped silently.
 */
const pending = new Map<string, string>()

export function markUnsaved(key: string, description: string | null): void {
  if (description === null) pending.delete(key)
  else pending.set(key, description)
}

export function unsavedDescriptions(): string[] {
  return [...new Set(pending.values())]
}

/** True when it is fine to leave: nothing is unsaved, or the lifter agreed to drop it. */
export function confirmLeave(): boolean {
  if (pending.size === 0) return true
  return window.confirm(
    `Unsaved input will be lost: ${unsavedDescriptions().join('; ')}. Leave anyway?`,
  )
}

/** A stable key for one input; its entry is removed when the input unmounts. */
export function useUnsavedKey(): string {
  const key = useId()
  useEffect(() => () => markUnsaved(key, null), [key])
  return key
}

let guarded = false

/** Browsers show their own "leave site?" prompt while anything is unsaved. */
export function installUnloadGuard(): void {
  if (guarded) return
  guarded = true
  window.addEventListener('beforeunload', (event) => {
    if (pending.size === 0) return
    event.preventDefault()
    event.returnValue = ''
  })
}
