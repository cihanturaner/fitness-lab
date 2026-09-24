import { expect, test, type Locator, type Page } from '@playwright/test'
import { DB_PATH_V2, acceptShortfall, auditRequests, sql } from './support'

// The V2 daily-use journey, against its own fresh scratch database (seeded with the locked
// program and a block that started two Mondays ago, so today is in week 3 of 12).

test.describe.configure({ mode: 'serial' })

const db = (query: string) => sql(query, DB_PATH_V2)
let audit: () => void

test.beforeEach(({ page, baseURL }) => {
  audit = auditRequests(page, [baseURL ?? ''])
})

test.afterEach(() => audit())

function isoDaysAgo(days: number): string {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function block(page: Page, key: string): Locator {
  return page.getByTestId(`slot-${key}`)
}

async function savedRows(card: Locator): Promise<string[]> {
  const rows = card.getByTestId('set-row')
  const result: string[] = []
  for (let index = 0; index < (await rows.count()); index += 1) {
    const row = rows.nth(index)
    const load = await row.getByRole('textbox', { name: /^Load in lb/ }).inputValue()
    const reps = await row.getByRole('textbox', { name: /^Reps/ }).inputValue()
    const rir = await row.getByRole('textbox', { name: /^RIR/ }).inputValue()
    result.push(`${load}×${reps}@${rir}`)
  }
  return result
}

test('training shows the current block week and the four sessions on their weekdays; home is empty summaries', async ({ page }) => {
  await page.goto('/#/training')
  await expect(page.getByTestId('block-week')).toHaveText('Week 3 of 12')
  const week = page.getByRole('list', { name: 'This week' })
  await expect(week.getByRole('listitem')).toHaveCount(7)
  const today = WEEKDAYS[new Date().getDay()] ?? ''
  await expect(week.getByTestId(`day-${today}`)).toHaveAttribute('aria-current', 'date')
  for (const [weekday, key] of [
    ['monday', 'upper_a'],
    ['tuesday', 'lower_a'],
    ['thursday', 'upper_b'],
    ['friday', 'lower_b'],
  ] as const) {
    const session = week.getByTestId(`day-${weekday}`).getByTestId(`planned-${key}`)
    await expect(session).toHaveAttribute('data-status', 'not_started')
    await expect(session.getByTestId('session-status')).toHaveText('Not started')
  }
  for (const rest of ['wednesday', 'saturday', 'sunday']) {
    await expect(week.getByTestId(`day-${rest}`)).toContainText('Rest')
  }
  await page.goto('/')
  await expect(page.getByTestId('home-context')).toHaveText('Block week 3 of 12')
  await expect(page.getByRole('list', { name: 'This week' })).toHaveCount(0)
  await expect(page.getByTestId('home-bodyweight')).toContainText('No weigh-ins yet.')
  await expect(page.getByTestId('home-nutrition')).toContainText('No macro target set yet.')
  await expect(page.getByTestId('home-recent')).toContainText('No completed sessions yet.')
})

test('workout: compact blocks, keyboard entry, save, resume, complete, reopen', async ({ page }) => {
  await page.goto('/#/training')
  await page.getByRole('button', { name: 'Start Lower A' }).click()
  await expect(page.getByRole('heading', { name: 'Lower A', level: 1 })).toBeVisible()
  const workoutId = /#\/workouts\/([a-f0-9]+)$/.exec(page.url())?.[1] ?? ''
  expect(db(`SELECT count(*) FROM performed_set WHERE workout_id = '${workoutId}'`)).toBe('0')

  // One compact block per exercise: the name once, the target as secondary context, no split.
  const squat = block(page, 'lower_a.01')
  await expect(squat.getByText('Smith High-Bar Squat', { exact: true })).toHaveCount(1)
  await expect(squat.getByTestId('target')).toHaveText('Target 3 × 5–8 · RIR 2 / 2 / 1')
  await expect(squat).toContainText('Last: none yet')
  await expect(page.getByText('Planned', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Actual', { exact: true })).toHaveCount(0)
  await expect(squat).not.toContainText('Failure')
  await expect(squat).not.toContainText('Rest:')
  // All six Lower A exercises are on the first screen of a 1440x900 viewport.
  for (const key of ['lower_a.01', 'lower_a.02', 'lower_a.03', 'lower_a.04', 'lower_a.05', 'lower_a.06']) {
    await expect(block(page, key)).toBeInViewport()
  }

  // Keyboard: load, Tab, reps, Tab, RIR, Tab — no set type is ever asked.
  await expect(squat.getByRole('combobox')).toHaveCount(0)
  await squat.getByRole('textbox', { name: 'Load in lb, new set 1' }).click()
  await page.keyboard.type('100')
  await page.keyboard.press('Tab')
  await page.keyboard.type('8')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Tab')
  await expect.poll(() => savedRows(squat)).toEqual(['100×8@2'])
  // The next row starts with the previous load (selected); Tab keeps the load.
  const load2 = squat.getByRole('textbox', { name: 'Load in lb, new set 2' })
  await expect(load2).toBeFocused()
  await expect(load2).toHaveValue('100')
  await page.keyboard.press('Tab')
  await page.keyboard.type('7')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Tab')
  await expect.poll(() => savedRows(squat)).toEqual(['100×8@2', '100×7@2'])
  await expect(squat.getByRole('textbox', { name: 'Load in lb, new set 3' })).toBeFocused()
  await page.keyboard.type('102.5')
  await page.keyboard.press('Tab')
  await page.keyboard.type('6')
  await page.keyboard.press('Tab')
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  await expect.poll(() => savedRows(squat)).toEqual(['100×8@2', '100×7@2', '102.5×6@1'])
  // Enter on the last planned row leaves the cursor on "+ Set", ready for an extra set.
  await expect(squat.getByRole('button', { name: /^Add set/ })).toBeFocused()
  expect(
    db(
      `SELECT group_concat(load_g || 'x' || reps || '@' || rir || ':' || set_type, ' ') FROM (SELECT * FROM performed_set WHERE workout_id = '${workoutId}' ORDER BY set_order)`,
    ),
  ).toBe('45359x8@2:working 45359x7@2:working 46493x6@1:working') // pounds, stored as whole grams

  // An invalid value is never saved silently.
  const rdl = block(page, 'lower_a.02')
  await rdl.getByRole('textbox', { name: 'Load in lb, new set 1' }).fill('80.12345')
  await rdl.getByRole('textbox', { name: 'Reps, new set 1' }).fill('10')
  await rdl.getByRole('textbox', { name: 'Reps, new set 1' }).press('Enter')
  await expect(rdl.getByRole('alert')).toContainText('Not saved')
  expect(db(`SELECT count(*) FROM performed_set WHERE workout_id = '${workoutId}'`)).toBe('3')
  await rdl.getByRole('textbox', { name: 'Load in lb, new set 1' }).fill('80')
  await rdl.getByRole('textbox', { name: 'Reps, new set 1' }).press('Enter')
  await expect.poll(() => savedRows(rdl)).toEqual(['80×10@'])

  // Reload and resume: the draft and its sets are the server's truth.
  await page.reload()
  await expect.poll(() => savedRows(block(page, 'lower_a.01'))).toEqual(['100×8@2', '100×7@2', '102.5×6@1'])
  // Home offers the open draft as today's one thing to do.
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Today', exact: true })).toContainText('In progress')
  await expect(page.getByRole('button', { name: 'Continue Lower A' })).toBeVisible()
  await page.goto('/#/training')
  await expect(page.getByTestId('planned-lower_a')).toHaveAttribute('data-status', 'draft')
  await page.getByRole('button', { name: 'Resume draft of Lower A' }).click()
  await expect(page).toHaveURL(new RegExp(`#/workouts/${workoutId}$`))
  await page.screenshot({ path: '../artifacts/v2-workout-1440x900.png' })

  const asked = acceptShortfall(page)
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  expect(asked()).toBe('4 actual working sets recorded / 18 planned. Complete anyway?')
  expect(db(`SELECT status FROM workout WHERE id = '${workoutId}'`)).toBe('complete')
  await expect(page.getByTestId('new-set-row')).toHaveCount(0)
  await page.goto('/#/training')
  await expect(page.getByTestId('planned-lower_a')).toHaveAttribute('data-status', 'complete')
  // Never a full "Done" for 4 of 18: the tile says what was recorded against the plan.
  await expect(page.getByTestId('planned-lower_a').getByTestId('session-status')).toHaveText('Shortened')
  await expect(page.getByTestId('planned-lower_a').getByTestId('session-sets')).toHaveText('4 of 18 working sets')
  await page.getByRole('link', { name: 'View Lower A' }).click()

  await page.getByRole('button', { name: 'Reopen to correct' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Draft')
  const reps = block(page, 'lower_a.01').getByRole('textbox', { name: 'Reps, set 3' })
  await reps.fill('7')
  await reps.press('Enter')
  await expect.poll(() => db(`SELECT reps FROM performed_set WHERE workout_id = '${workoutId}' AND set_order = 3`)).toBe('7')
  acceptShortfall(page)
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')

  // Last performance is visible the next time, with nothing copied into the new draft.
  await page.goto('/#/training')
  await page.getByRole('button', { name: 'Start Lower A again' }).click()
  await expect(page.getByRole('heading', { name: 'Lower A', level: 1 })).toBeVisible()
  await expect(block(page, 'lower_a.01').getByTestId('last-performance')).toContainText(
    'Last (lb) 100×8@2 · 100×7@2 · 102.5×7@1',
  )
  const secondId = /#\/workouts\/([a-f0-9]+)$/.exec(page.url())?.[1] ?? ''
  expect(db(`SELECT count(*) FROM performed_set WHERE workout_id = '${secondId}'`)).toBe('0')
  // It was opened by mistake: discard the empty draft.
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Discard draft' }).click()
  // Back where it was opened from.
  await expect(page).toHaveURL(/#\/training$/)
  expect(db(`SELECT count(*) FROM workout WHERE id = '${secondId}'`)).toBe('0')
})

test('bodyweight: enter, correct, refresh; 7-day averages and change are exact', async ({ page }) => {
  await page.goto('/#/bodyweight')
  const date = page.getByLabel('Weigh-in date')
  const kg = page.getByRole('textbox', { name: 'Bodyweight in kg' })
  const entries: [number, string][] = [
    [10, '71.0'],
    [8, '71.4'],
    [6, '72.0'],
    [4, '72.2'],
    [2, '72.3'],
    [0, '72.5'],
  ]
  for (const [ago, value] of entries) {
    await date.fill(isoDaysAgo(ago))
    await kg.fill(value)
    await kg.press('Enter')
    await expect(page.getByRole('status')).toContainText(`Saved ${value} kg`)
  }
  // Current window: 72.0, 72.2, 72.3, 72.5 -> 72.25. Previous: 71.0, 71.4 -> 71.20.
  await expect(page.getByTestId('bw-avg7')).toHaveText('72.25 kg (4/7 days)')
  await expect(page.getByTestId('bw-prev7')).toHaveText('71.20 kg (2/7 days)')
  // Two weigh-ins in the previous week are not a comparable average, and six weigh-ins in
  // 14 days are not a qualified trend: neither is presented as a rate.
  await expect(page.getByTestId('bw-change')).toContainText('needs 4 weigh-ins in each week')
  await expect(page.getByTestId('bw-trend')).toContainText('not qualified')

  // Today again replaces today: one entry per date. 72.275 rounds half-up to 72.28.
  await date.fill(isoDaysAgo(0))
  await kg.fill('72,6')
  await kg.press('Enter')
  await expect(page.getByRole('status')).toContainText('Saved 72.6 kg')
  await page.reload()
  await expect(page.getByTestId('bw-latest')).toContainText('72.6 kg')
  await expect(page.getByTestId('bw-avg7')).toHaveText('72.28 kg (4/7 days)')
  await expect(page.getByTestId('bw-entry')).toHaveCount(6)
  await expect(page.getByRole('img', { name: 'Daily bodyweight and 7-day average' })).toBeVisible()
  expect(db(`SELECT bodyweight_g FROM bodyweight_entry WHERE measured_on = '${isoDaysAgo(0)}'`)).toBe('72600')
  expect(db('SELECT count(*) FROM bodyweight_entry')).toBe('6')

  // Refused, not rounded.
  await kg.fill('72.456')
  await kg.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Not saved')
  expect(db(`SELECT bodyweight_g FROM bodyweight_entry WHERE measured_on = '${isoDaysAgo(0)}'`)).toBe('72600')
  await page.screenshot({ path: '../artifacts/v2-bodyweight-1440x900.png' })

  await page.goto('/')
  await expect(page.getByTestId('home-bw-latest')).toContainText('72.6 kg')
  await expect(page.getByTestId('home-bw-avg')).toContainText('72.28 kg')
  await expect(page.getByTestId('home-bw-avg')).toContainText('4/7 days')
  await expect(page.getByTestId('home-bw-trend')).toContainText('not enough weigh-ins (6/14)')
})

test('nutrition: log a day, refresh, no target until one is recorded, explicit macro target', async ({ page }) => {
  await page.goto('/#/nutrition')
  await expect(page.getByTestId('nut-target-protein')).toHaveText('no target')
  await expect(page.getByTestId('nut-target-fat')).toHaveText('no target')
  await expect(page.getByTestId('nut-target-calories')).toHaveText('No target yet.')
  await expect(page.getByTestId('nut-target-carbs')).toHaveText('no target')

  // Calories are never typed: they follow live from the macros (Atwater 4 / 4 / 9).
  await expect(page.getByRole('textbox', { name: /calories/i })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Fat g' }).fill('10')
  await expect(page.getByTestId('nut-live-kcal')).toHaveText('90 kcal')
  await page.getByRole('textbox', { name: 'Protein g' }).fill('150')
  await page.getByRole('textbox', { name: 'Carbs g' }).fill('290')
  await page.getByRole('textbox', { name: 'Fat g' }).fill('62')
  await expect(page.getByTestId('nut-live-kcal')).toHaveText('2318 kcal')
  await page.getByRole('button', { name: 'Save day' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')

  await page.reload()
  await expect(page.getByRole('region', { name: 'Targets' })).toContainText('2318')
  await expect(page.getByRole('textbox', { name: 'Protein g' })).toHaveValue('150')
  await expect(page.getByRole('textbox', { name: 'Carbs g' })).toHaveValue('290')
  await expect(page.getByRole('textbox', { name: 'Fat g' })).toHaveValue('62')
  await expect(page.getByTestId('nut-target-calories')).toHaveText('No target yet.')
  expect(
    db(`SELECT protein_g || '/' || carbs_g || '/' || fat_g FROM nutrition_day WHERE logged_on = '${isoDaysAgo(0)}'`),
  ).toBe('150/290/62')
  expect(db('SELECT count(*) FROM macro_target')).toBe('0')

  await page.goto('/')
  await expect(page.getByTestId('home-nut-protein')).toContainText('150 g')
  await expect(page.getByTestId('home-nut-protein')).toContainText('target not set')
  await expect(page.getByTestId('home-nutrition')).toContainText('No macro target set yet.')

  // Only an explicit decision sets targets: protein, carbs and fat; calories follow from them.
  await page.goto('/#/nutrition')
  await page.getByRole('button', { name: 'Set targets…' }).click()
  await page.getByRole('textbox', { name: 'Carbs target g' }).fill('383')
  await page.getByRole('button', { name: 'Save targets' }).click()
  // The source's 145 g protein and 60 g fat were offered: 145 x 4 + 383 x 4 + 60 x 9.
  await expect(page.getByTestId('nut-target-calories')).toHaveText('2652 kcal')
  await expect(page.getByTestId('nut-target-carbs')).toHaveText('383 g')
  expect(db("SELECT protein_g || '/' || carbs_g || '/' || fat_g FROM macro_target")).toBe('145/383/60')
  await page.screenshot({ path: '../artifacts/v2-nutrition-1440x900.png' })
})

test('history: chronological lb/reps/RIR per exercise, week by week', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('home-recent')).toContainText('Smith High-Bar Squat')
  await expect(page.getByTestId('home-recent')).toContainText('100×8@2 · 100×7@2 · 102.5×7@1')

  await page.goto('/#/history/exercises')
  await page.getByRole('navigation', { name: 'Exercises' }).getByRole('link', { name: /Smith High-Bar Squat/ }).click()
  const rows = page.getByTestId('history-exposure')
  await expect(rows).toHaveCount(1)
  await expect(rows.first().getByTestId('history-set')).toHaveText([
    '100 lb × 8 @ RIR 2',
    '100 lb × 7 @ RIR 2',
    '102.5 lb × 7 @ RIR 1',
  ])
  await expect(rows.first()).toContainText('Lower A')
  // Week column: today is in week 3 of the block.
  await expect(rows.first().getByTestId('history-week')).toHaveText('3')

  await page.getByRole('navigation', { name: 'Exercises' }).getByRole('link', { name: /Romanian Deadlift/ }).click()
  await expect(page.getByTestId('history-exposure').first().getByTestId('history-set')).toHaveText(['80 lb × 10'])
  await page.screenshot({ path: '../artifacts/v2-history-1440x900.png' })
  await page.goto('/')
  await expect(page.getByTestId('home-context')).toHaveText('Block week 3 of 12')
  await expect(page.getByTestId('home-recent')).toContainText('Smith High-Bar Squat')
  await page.screenshot({ path: '../artifacts/v2-home-1440x900.png' })
})
