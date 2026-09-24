import { useState } from 'react'
import { ApiError, api } from '@/api/client'
import type { WeekSession } from '@/api/types'
import { navigate, workoutHref } from '@/lib/route'

export type OpenSession = (session: WeekSession, performedOn?: string) => void

export function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error)
}

/** "2 of 23 working sets": what was recorded against the plan, never the plan alone. */
export function setCounts(session: WeekSession): string {
  if (session.status === 'not_started') return `${session.slot_count} exercises · ${session.planned_work_sets} sets`
  return `${session.actual_work_sets ?? 0} of ${session.planned_work_sets} working sets`
}

/** Completed with fewer working sets than planned: never shown as a full "Done". */
export function isShort(session: WeekSession): boolean {
  return session.status === 'complete' && (session.actual_work_sets ?? 0) < session.planned_work_sets
}

/**
 * Opening a planned session (its one draft) or an unplanned one, then routing to it. `busy`
 * holds every start control while a request is on its way; a failure is reported, not thrown.
 */
export function useOpenSession(today: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async (request: () => Promise<string>) => {
    setBusy(true)
    try {
      navigate(workoutHref(await request()))
    } catch (failure) {
      setError(message(failure))
      setBusy(false)
    }
  }

  const open: OpenSession = (session, performedOn = today) =>
    void go(async () => (await api.openPlanned(session.planned_workout_id, performedOn)).workout_id)
  const startUnplanned = () => void go(async () => (await api.createWorkout(today)).id)

  return { busy, error, setError, open, startUnplanned }
}
