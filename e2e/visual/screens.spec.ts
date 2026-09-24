import { mkdirSync } from 'node:fs'
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'

// Visual QA: every screen, two datasets, two viewports. Seeding goes through the public API of
// a scratch server only (the config never points at the canonical database).

const EMPTY = 'http://127.0.0.1:8720'
const FULL = 'http://127.0.0.1:8721'
const OUT = `../artifacts/visual/${process.env.VISUAL_TAG ?? 'current'}`
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]

test.describe.configure({ mode: 'serial' })

function iso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const now = new Date()
const today = iso(now)
const daysAgo = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days))

async function json<T>(api: APIRequestContext, method: string, path: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, data })
  if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`)
  return (response.status() === 204 ? undefined : await response.json()) as T
}

type Week = {
  days: { date: string; sessions: { planned_workout_id: string; name: string; status: string }[] }[]
}
type Entry = {
  slots: { id: string; effective_exercise_id: string; sets: { set_type: string; reps_min: number; reps_max: number | null; target_rir_min: number | null }[] }[]
  exercises: Record<string, { name: string }>
}

/** A plausible working load in POUNDS for an exercise of the locked program, by its name. */
function baseLoad(name: string): number {
  const table: [RegExp, number][] = [
    [/squat/i, 225],
    [/deadlift|rdl/i, 245],
    [/bench|chest press/i, 185],
    [/incline/i, 155],
    [/leg press/i, 400],
    [/row/i, 155],
    [/pulldown|pull-down|pull up|pullup/i, 145],
    [/shoulder press|overhead/i, 110],
    [/lateral/i, 25],
    [/curl/i, 35],
    [/extension|pushdown/i, 90],
    [/calf/i, 200],
    [/fly|pec/i, 100],
    [/lunge|split/i, 50],
    [/hip thrust/i, 265],
  ]
  return table.find(([pattern]) => pattern.test(name))?.[1] ?? 90
}

const round = (value: number, step: number) => Math.round(value / step) * step

async function logSession(api: APIRequestContext, plannedId: string, date: string, week: number, complete: boolean) {
  const opened = await json<{ workout_id: string }>(api, 'POST', `/api/planned-workouts/${plannedId}/open`, {
    performed_on: date,
  })
  const entry = await json<Entry>(api, 'GET', `/api/workouts/${opened.workout_id}/entry`)
  const slots = complete ? entry.slots : entry.slots.slice(0, 2)
  for (const slot of slots) {
    const name = entry.exercises[slot.effective_exercise_id]?.name ?? ''
    const base = baseLoad(name)
    const step = base >= 90 ? 5 : 2.5
    const load = round(base * (1 + 0.025 * (week - 1)), step)
    if (base >= 130) {
      await json(api, 'POST', `/api/workouts/${opened.workout_id}/sets`, {
        exercise_id: slot.effective_exercise_id,
        set_type: 'warmup',
        load_lb: String(round(load * 0.6, 5)),
        reps: 8,
        rir: null,
      })
    }
    const planned = complete ? slot.sets : slot.sets.slice(0, 2)
    for (const [index, set] of planned.entries()) {
      const top = set.reps_max ?? set.reps_min + 4
      const reps = Math.max(set.reps_min, top - index - (week === 1 ? 1 : 0))
      await json(api, 'POST', `/api/workouts/${opened.workout_id}/sets`, {
        exercise_id: slot.effective_exercise_id,
        set_type: set.set_type,
        load_lb: String(set.set_type === 'backoff' ? round(load * 0.85, step) : load),
        reps,
        rir: set.target_rir_min ?? 2,
      })
    }
  }
  if (complete) await json(api, 'POST', `/api/workouts/${opened.workout_id}/complete`)
  return opened.workout_id
}

async function seedFull(): Promise<{ completed: string | null; draft: string | null }> {
  const api = await request.newContext({ baseURL: FULL })
  let completed: string | null = null
  let draft: string | null = null
  // Three weeks of training: weeks 1 and 2 complete, this week up to yesterday.
  for (const weeksAgo of [2, 1, 0]) {
    const week = await json<Week>(api, 'GET', `/api/week?date=${daysAgo(7 * weeksAgo)}`)
    for (const day of week.days) {
      for (const session of day.sessions) {
        if (day.date < today) {
          completed = await logSession(api, session.planned_workout_id, day.date, 3 - weeksAgo, true)
        }
      }
    }
  }
  // Today: the next unfinished session is open as a draft with its first exercises logged.
  const current = await json<Week>(api, 'GET', `/api/week?date=${today}`)
  const next = current.days.flatMap((day) => day.sessions).find((session) => session.status === 'not_started')
  if (next) draft = await logSession(api, next.planned_workout_id, today, 3, false)

  // Bodyweight: 45 mornings, slowly rising, with a few missed days.
  for (let ago = 44; ago >= 0; ago -= 1) {
    if ([3, 9, 16, 17, 25, 31, 38].includes(ago)) continue
    const trend = 78.4 + (44 - ago) * 0.021
    const noise = Math.sin(ago * 1.7) * 0.35 + Math.cos(ago * 0.6) * 0.15
    await json(api, 'PUT', `/api/bodyweight/${daysAgo(ago)}`, {
      bodyweight_kg: (trend + noise).toFixed(1),
      notes: ago === 12 ? 'Late dinner the night before' : null,
    })
  }
  // Nutrition: a calorie target decided ten days ago, two weeks of logs, today in progress.
  await json(api, 'POST', '/api/nutrition/calorie-targets', {
    effective_on: daysAgo(10),
    calories_kcal: 2900,
    notes: 'Start of lean gain',
  })
  for (let ago = 13; ago >= 1; ago -= 1) {
    if (ago === 6) continue
    // Macros only: the server derives each day's calories from them.
    await json(api, 'PUT', `/api/nutrition/${daysAgo(ago)}`, {
      protein_g: 142 + Math.round(Math.cos(ago) * 9),
      carbs_g: 440 + Math.round(Math.sin(ago * 0.7) * 35),
      fat_g: 58 + Math.round(Math.sin(ago * 1.3) * 7),
      notes: ago === 4 ? 'Restaurant, estimated' : null,
    })
  }
  await json(api, 'PUT', `/api/nutrition/${today}`, {
    protein_g: 112,
    carbs_g: 236,
    fat_g: 41,
    notes: null,
  })
  await api.dispose()
  return { completed, draft }
}

async function shoot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle')
  // Let the entrance, ring and chart motion settle before the frame is taken.
  await page.waitForTimeout(1400)
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 }
  await page.screenshot({ path: `${OUT}/${name}-${width}x${height}.png`, fullPage })
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

test('empty dataset', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto(`${EMPTY}/#/`)
    await expect(page.getByRole('list', { name: 'This week' })).toBeVisible()
    await shoot(page, 'empty-week')
    await page.goto(`${EMPTY}/#/bodyweight`)
    await shoot(page, 'empty-bodyweight')
    await page.goto(`${EMPTY}/#/nutrition`)
    await shoot(page, 'empty-nutrition')
    await page.goto(`${EMPTY}/#/history`)
    await shoot(page, 'empty-history')
    await page.goto(`${EMPTY}/#/sessions`)
    await shoot(page, 'empty-sessions')
    await page.goto(`${EMPTY}/#/settings`)
    await shoot(page, 'empty-settings')
  }
  // The formatted date field is still the native field for the keyboard: typing a date
  // (in the browser's segment order, en-US here) changes the value and the visible label.
  await page.goto(`${EMPTY}/#/bodyweight`)
  const field = page.getByLabel('Weigh-in date')
  await field.focus()
  await page.keyboard.type('09012026')
  await expect(field).toHaveValue('2026-09-01')
  await expect(page.getByText('Tue 1 Sep', { exact: true })).toBeVisible()
  await expect(field).toBeFocused()

  // Last: opening a session creates a draft, which ends the empty state.
  await page.setViewportSize(VIEWPORTS[0]!)
  await page.goto(`${EMPTY}/#/`)
  // Before the block, a session is still loggable, quietly ("Log anyway"), never offered as block work.
  await page.getByRole('button', { name: 'Log Upper A anyway', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await shoot(page, 'empty-workout')
  }
  await page.goto(`${EMPTY}/#/`)
  await page.getByRole('button', { name: 'Start unplanned session' }).click()
  await expect(page.getByRole('heading', { name: 'Unplanned session' })).toBeVisible()
  await shoot(page, 'empty-workout-unplanned')
})

test('populated dataset', async ({ page }) => {
  test.setTimeout(240_000)
  const { completed, draft } = await seedFull()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto(`${FULL}/#/`)
    await expect(page.getByRole('list', { name: 'This week' })).toBeVisible()
    await shoot(page, 'full-week')
    await page.goto(`${FULL}/#/bodyweight`)
    await shoot(page, 'full-bodyweight')
    await page.goto(`${FULL}/#/nutrition`)
    await shoot(page, 'full-nutrition')
    await page.goto(`${FULL}/#/history`)
    await shoot(page, 'full-history')
    await page.goto(`${FULL}/#/sessions`)
    await shoot(page, 'full-sessions')
    await page.goto(`${FULL}/#/settings`)
    await shoot(page, 'full-settings')
    await page.goto(`${FULL}/#/`)
    await page.getByRole('link', { name: 'Previous week' }).click()
    await expect(page.getByTestId('week-mode')).toBeVisible()
    await shoot(page, 'full-week-previous')
    if (draft) {
      await page.goto(`${FULL}/#/workouts/${draft}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await shoot(page, 'full-workout-draft')
      await shoot(page, 'full-workout-draft-page', true)
    }
    if (completed) {
      await page.goto(`${FULL}/#/workouts/${completed}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await shoot(page, 'full-workout-complete')
    }
  }
})
