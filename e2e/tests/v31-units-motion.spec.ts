import { expect, test, type APIRequestContext } from '@playwright/test'
import { DB_PATH_V31, auditRequests, sql } from './support'

// The V3.1 journey, against its own fresh scratch database: workout loads are pounds end to
// end, a set recorded in kilograms before V3.1 reads as its true weight in pounds, a day's
// calories are built from its macros, and "reduce motion" makes every transition instant.

test.describe.configure({ mode: 'serial' })

const db = (query: string) => sql(query, DB_PATH_V31)
let audit: () => void

test.beforeEach(({ page, baseURL }) => {
  audit = auditRequests(page, [baseURL ?? ''])
})

test.afterEach(() => audit())

function isoDaysAgo(days: number): string {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function call<T>(api: APIRequestContext, method: string, url: string, data?: unknown): Promise<T> {
  const response = await api.fetch(url, { method, data })
  expect(response.ok(), `${method} ${url}: ${await response.text()}`).toBeTruthy()
  return (response.status() === 204 ? null : await response.json()) as T
}

type Week = { days: { sessions: { planned_workout_id: string; workout_key: string }[] }[] }
type Entry = { slots: { slot_key: string; effective_exercise_id: string }[] }

async function openPlanned(api: APIRequestContext, key: string, day: string) {
  const week = await call<Week>(api, 'GET', `/api/week?date=${isoDaysAgo(0)}`)
  const planned = week.days.flatMap((item) => item.sessions).find((session) => session.workout_key === key)
  expect(planned, `planned workout ${key}`).toBeTruthy()
  const opened = await call<{ workout_id: string }>(api, 'POST', `/api/planned-workouts/${planned?.planned_workout_id}/open`, {
    performed_on: day,
  })
  const entry = await call<Entry>(api, 'GET', `/api/workouts/${opened.workout_id}/entry`)
  return { workoutId: opened.workout_id, exerciseId: entry.slots[0]?.effective_exercise_id ?? '' }
}

test('a set recorded in kilograms before V3.1 reads as its true weight in pounds, never rewritten', async ({ page }) => {
  const { workoutId, exerciseId } = await openPlanned(page.request, 'upper_a', isoDaysAgo(3))
  const saved = await call<{ id: string }>(page.request, 'POST', `/api/workouts/${workoutId}/sets`, {
    exercise_id: exerciseId,
    set_type: 'working',
    load_lb: '100',
    reps: 5,
    rir: 2,
  })
  // The shape of the canonical rows saved before V3.1: 33 kg, as integer grams.
  db(`UPDATE performed_set SET load_g = 33000 WHERE id = '${saved.id}'`)
  await call(page.request, 'POST', `/api/workouts/${workoutId}/complete`)

  await page.goto(`/#/workouts/${workoutId}`)
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  await expect(page.getByRole('textbox', { name: 'Load in lb, set 1' })).toHaveValue('72.75')
  await expect(page.getByText('loads in lb')).toBeVisible()

  await page.goto(`/#/history/${exerciseId}`)
  await expect(page.getByTestId('history-set')).toHaveText(['72.75 lb × 5 @ RIR 2'])
  await page.goto('/')
  await expect(page.getByTestId('home-recent')).toContainText('72.75×5@2')
  await expect(page.getByTestId('home-recent')).toContainText('lb × reps @ RIR')
  // Showing it in pounds never rewrote it.
  expect(db(`SELECT load_g FROM performed_set WHERE id = '${saved.id}'`)).toBe('33000')
})

test('loads are entered in pounds, stored exactly, and read back in pounds everywhere', async ({ page }) => {
  const { workoutId, exerciseId } = await openPlanned(page.request, 'lower_a', isoDaysAgo(0))
  await page.goto(`/#/workouts/${workoutId}`)
  const card = page.getByTestId('slot-lower_a.01')
  await card.getByRole('textbox', { name: 'Load in lb, new set 1' }).fill('225')
  await card.getByRole('textbox', { name: 'Reps, new set 1' }).fill('5')
  await card.getByRole('textbox', { name: 'RIR, new set 1' }).fill('2')
  await card.getByRole('textbox', { name: 'Reps, new set 1' }).press('Enter')
  await expect(card.getByTestId('set-row')).toHaveCount(1)
  await expect(card.getByRole('textbox', { name: 'Load in lb, set 1' })).toHaveValue('225')
  // A value finer than 0.01 lb is refused, not rounded.
  await card.getByRole('textbox', { name: 'Load in lb, new set 2' }).fill('225.125')
  await card.getByRole('textbox', { name: 'Reps, new set 2' }).fill('5')
  await card.getByRole('textbox', { name: 'Reps, new set 2' }).press('Enter')
  await expect(card.getByRole('alert')).toContainText('load must be pounds')
  // 225 lb x 453.59237 g/lb = 102058.28 g -> 102058 g.
  expect(db(`SELECT group_concat(load_g) FROM performed_set WHERE workout_id = '${workoutId}'`)).toBe('102058')

  await page.reload()
  await expect(page.getByTestId('slot-lower_a.01').getByRole('textbox', { name: 'Load in lb, set 1' })).toHaveValue('225')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  await page.goto(`/#/history/${exerciseId}`)
  await expect(page.getByTestId('history-set')).toHaveText(['225 lb × 5 @ RIR 2'])
  await expect(page.getByText('Top load per session · lb')).toHaveCount(0) // one session: no chart yet
  await expect(page.locator('body')).not.toContainText(/\d kg ×/)
})

test('a day is logged as macros; its calories are derived live and on reload', async ({ page }) => {
  await page.goto('/#/nutrition')
  await expect(page.getByRole('textbox', { name: /calories/i })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Fat g' }).fill('10')
  await expect(page.getByTestId('nut-live-kcal')).toHaveText('90 kcal')
  await page.getByRole('textbox', { name: 'Fat g' }).fill('70')
  await page.getByRole('textbox', { name: 'Protein g' }).fill('76')
  await page.getByRole('textbox', { name: 'Carbs g' }).fill('210')
  await expect(page.getByTestId('nut-live-kcal')).toHaveText('1774 kcal')
  await expect(page.getByText('304 + 840 + 630 kcal')).toBeVisible()
  await page.getByRole('button', { name: 'Save day' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')
  expect(db(`SELECT protein_g || '/' || carbs_g || '/' || fat_g FROM nutrition_day WHERE logged_on = '${isoDaysAgo(0)}'`)).toBe(
    '76/210/70',
  )
  await page.reload()
  await expect(page.getByRole('region', { name: 'Targets' })).toContainText('1774')
  await expect(page.getByTestId('nut-day').first()).toContainText('1774')
  await page.goto('/')
  await expect(page.getByTestId('home-nut-kcal')).toContainText('1774')
})

test.describe('reduced motion', () => {
  test('motion plays by default', async ({ page }) => {
    await page.goto('/#/nutrition')
    const screen = page.locator('.enter').first()
    await expect(screen).toBeVisible()
    expect(await screen.evaluate((element) => getComputedStyle(element).animationDuration)).toBe('0.21s')
  })

  test('with "reduce motion", every entrance and value change is instant', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', baseURL, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto('/#/nutrition')
    const screen = page.locator('.enter').first()
    await expect(screen).toBeVisible()
    expect(await screen.evaluate((element) => getComputedStyle(element).animationDuration)).toBe('0s')
    // The visible live total is the exact value at once — no glide through intermediate numbers.
    await page.getByRole('textbox', { name: 'Protein g' }).fill('150')
    const shown = page.getByRole('form', { name: 'Log the day' }).locator('.t-metric')
    expect(await shown.textContent()).toBe(String(150 * 4 + 210 * 4 + 70 * 9))
    await context.close()
  })
})
