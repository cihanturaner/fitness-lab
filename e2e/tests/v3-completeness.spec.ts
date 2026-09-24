import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { DB_PATH_V3, auditRequests, sql } from './support'

// The V3 completeness journey, against its own fresh scratch database: the locked program,
// a block that started three Mondays ago (weeks 1-3 finished, today in week 4).

test.describe.configure({ mode: 'serial' })

const db = (query: string) => sql(query, DB_PATH_V3)
const START = process.env.FITNESS_LAB_E2E_BLOCK_START_V3 ?? ''
let audit: () => void

test.beforeEach(({ page, baseURL }) => {
  audit = auditRequests(page, [baseURL ?? ''])
})

test.afterEach(() => audit())

function shift(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localToday(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const WEEK3_MONDAY = shift(START, 14)
const WEEK3_SUNDAY = shift(START, 20)

async function logOneBenchSet(page: Page) {
  const bench = page.getByTestId('slot-upper_a.01')
  await bench.getByRole('textbox', { name: 'Load in lb, new set 1' }).fill('80')
  await bench.getByRole('textbox', { name: 'Reps, new set 1' }).fill('8')
  await bench.getByRole('textbox', { name: 'RIR, new set 1' }).fill('2')
  await bench.getByRole('textbox', { name: 'Reps, new set 1' }).press('Enter')
  await expect.poll(() => db('SELECT count(*) FROM performed_set')).toBe('1')
}

test('a past week is one click away, and a shortened session is confirmed and shown as such', async ({ page }) => {
  await page.goto('/#/training')
  await expect(page.getByTestId('block-week')).toHaveText('Week 4 of 12')
  await page.getByRole('navigation', { name: 'Weeks' }).getByRole('link', { name: 'Previous week' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Week 3 of 12')
  await expect(page.getByTestId('week-mode')).toContainText('A past week')
  await expect(page.getByRole('region', { name: 'Today', exact: true })).toHaveCount(0)
  const monday = page.getByTestId('day-monday')
  await expect(monday.getByTestId('session-status')).toHaveText('Not logged')
  await monday.getByRole('button', { name: /^Log Upper A for / }).click()
  await expect(page.getByRole('heading', { name: 'Upper A', level: 1 })).toBeVisible()
  const workoutId = /#\/workouts\/([a-f0-9]+)$/.exec(page.url())?.[1] ?? ''
  expect(db(`SELECT performed_on FROM workout WHERE id = '${workoutId}'`)).toBe(WEEK3_MONDAY)

  await logOneBenchSet(page)

  // Declining keeps it a draft.
  let asked = ''
  page.once('dialog', (dialog) => {
    asked = dialog.message()
    void dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect.poll(() => asked).toBe('1 actual working sets recorded / 23 planned. Complete anyway?')
  await expect(page.getByTestId('workout-status')).toHaveText('Draft')
  expect(db(`SELECT status FROM workout WHERE id = '${workoutId}'`)).toBe('draft')

  // Accepting completes it, and it is never presented as the full session.
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  await expect(page.getByTestId('workout-shortfall')).toHaveText('· shortened')
  await expect(page.getByRole('status')).toContainText('Saved as a shortened session: 1 of 23 planned working sets recorded.')
  expect(db(`SELECT status FROM workout WHERE id = '${workoutId}'`)).toBe('complete')

  await page.goto(`/#/training/${WEEK3_MONDAY}`)
  const tile = page.getByTestId('day-monday').getByTestId('planned-upper_a')
  await expect(tile.getByTestId('session-status')).toHaveText('Shortened')
  await expect(tile.getByTestId('session-sets')).toHaveText('1 of 23 working sets')

  await page.goto('/#/sessions')
  const row = page.getByTestId('recent-workout').first()
  await expect(row.locator('td').first()).toHaveText('3')
  await expect(row.getByTestId('session-work-sets')).toHaveText('1 / 23shortened')

  await page.goto('/#/history')
  await page.getByRole('navigation', { name: 'Exercises' }).getByRole('link', { name: /Smith Flat Bench Press/ }).click()
  const exposure = page.getByTestId('history-exposure').first()
  await expect(exposure.getByTestId('history-week')).toHaveText('3')
  await expect(exposure.getByTestId('history-set')).toHaveText(['80 lb × 8 @ RIR 2'])
})

test('the block start is set in the app; days before it are pre-block', async ({ page }) => {
  const nextMonday = shift(START, 28)
  await page.goto('/#/settings')
  const block = page.getByRole('region', { name: 'Training block' })
  await block.getByLabel('Block start date').fill(nextMonday)
  let asked = ''
  page.once('dialog', (dialog) => {
    asked = dialog.message()
    void dialog.accept()
  })
  await block.getByRole('button', { name: 'Save start date' }).click()
  await expect(block.getByRole('status')).toContainText('Block start saved')
  expect(asked).toContain('Week 1 becomes')
  expect(db('SELECT start_on FROM training_block')).toBe(nextMonday)

  await page.goto('/#/training')
  await expect(page.getByTestId('block-phase')).toContainText('Before the block')
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Today', exact: true })).toContainText('Before the block')
  await page.goto('/#/history')
  await page.getByRole('navigation', { name: 'Exercises' }).getByRole('link', { name: /Smith Flat Bench Press/ }).click()
  await expect(page.getByTestId('history-exposure').first().getByTestId('history-week')).toHaveText('Pre')

  // Put it back: recorded workouts keep their dates; only their week numbers follow.
  await page.goto('/#/settings')
  await block.getByLabel('Block start date').fill(START)
  page.once('dialog', (dialog) => void dialog.accept())
  await block.getByRole('button', { name: 'Save start date' }).click()
  await expect(block.getByRole('status')).toContainText('Block start saved')
  expect(db('SELECT start_on FROM training_block')).toBe(START)
  expect(db('SELECT performed_on FROM workout')).toBe(WEEK3_MONDAY)
})

test('the weekly nutrition review recommends; only an explicit choice changes calories', async ({ page }) => {
  // A starting target recorded before the block, and daily weigh-ins rising 0.07 % BW/week.
  const target = await page.request.post('/api/nutrition/calorie-targets', {
    data: { effective_on: shift(START, -1), calories_kcal: 2650, notes: 'Starting rule' },
  })
  expect(target.status()).toBe(201)
  for (let day = -7, index = 0; shift(START, day) <= localToday(); day += 1, index += 1) {
    const grams = 72_000 + Math.round((7.2 * index) / 10) * 10
    const response = await page.request.put(`/api/bodyweight/${shift(START, day)}`, {
      data: { bodyweight_kg: (grams / 1000).toFixed(2) },
    })
    expect(response.status()).toBe(200)
  }

  await page.goto('/')
  await expect(page.getByTestId('home-review-due')).toHaveText('Weekly review due · week 3')

  await page.goto('/#/nutrition')
  const review = page.getByRole('region', { name: 'Weekly review' })
  await expect(review.getByTestId('review-trend')).toHaveText('+0.07 % BW/week')
  await expect(review.getByTestId('review-status')).toContainText('UNDER_GAIN')
  await expect(review.getByTestId('review-recommendation')).toContainText('+150 kcal/day → 2800 kcal · carbs 420 g')
  // Reading the review changed nothing.
  expect(db('SELECT count(*) FROM calorie_target')).toBe('1')
  expect(db('SELECT count(*) FROM controller_event')).toBe('0')

  await review.getByRole('button', { name: 'Apply +150' }).click()
  await expect(review.getByTestId('review-decided')).toContainText('Applied +150 kcal/day → 2800 kcal')
  await expect(page.getByTestId('nut-target-calories')).toHaveText('2800 kcal')
  await expect(page.getByTestId('nut-target-carbs')).toHaveText('420 g')
  expect(db("SELECT user_choice || '/' || block_week || '/' || trend_pct_bw_per_week FROM controller_event")).toBe(
    'APPLIED/3/0.07',
  )
  expect(db(`SELECT calories_kcal FROM calorie_target WHERE effective_on = '${localToday()}'`)).toBe('2800')

  await page.reload()
  await expect(review.getByRole('button', { name: /Apply/ })).toHaveCount(0)
  await expect(review.getByTestId('review-next')).toContainText('end of week 5')
  await expect(page.getByRole('region', { name: 'Calorie target history' }).getByTestId('target-row')).toHaveCount(2)
  // Week 3 ended on or before today: that is why its review was the one due.
  expect(WEEK3_SUNDAY <= localToday()).toBe(true)
})

test('a backup is one click, verified, and listed', async ({ page }) => {
  await page.goto('/#/settings')
  const backups = page.getByRole('region', { name: 'Backups' })
  await backups.getByRole('button', { name: 'Back up now' }).click()
  await expect(backups.getByRole('status')).toContainText('Backup saved and verified')
  const name = /(\d{8}T\d{12}Z-manual-backup\.db)/.exec((await backups.getByRole('status').textContent()) ?? '')?.[1] ?? ''
  expect(existsSync(path.join(path.dirname(DB_PATH_V3), 'snapshots', name))).toBe(true)
  await expect(backups.getByText('Manual backup')).toBeVisible()
  await page.screenshot({ path: '../artifacts/v3-settings-1440x900.png', fullPage: true })
})
