import { expect, test, type Page } from '@playwright/test'
import { DB_PATH_V32, auditRequests, sql } from './support'

// The V3.2 journey, against its own fresh scratch database (block started two Mondays ago):
// Home answers only "what today", the week planner lives on Training, a whole planned
// session is logged from the keyboard as lb -> reps -> RIR with no set-type control, and the
// motion is perceptible (and still instant under "reduce motion", see the V3.1 journey).

test.describe.configure({ mode: 'serial' })

const db = (query: string) => sql(query, DB_PATH_V32)
let audit: () => void

test.beforeEach(({ page, baseURL }) => {
  audit = auditRequests(page, [baseURL ?? ''])
})

test.afterEach(() => audit())

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(600) // let entrance and fills settle
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 }
  await page.screenshot({ path: `../artifacts/v32/${name}-${width}x${height}.png` })
}

test('Home is today, its status and three numbers — the week planner is on Training', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const today = page.getByRole('region', { name: 'Today', exact: true })
    await expect(today).toBeVisible()
    // The answer and its action are above the fold.
    await expect(today).toBeInViewport()
    await expect(page.getByTestId('today-status')).toBeVisible()
    for (const card of ['home-bodyweight', 'home-nutrition', 'home-recent']) {
      await expect(page.getByTestId(card)).toBeInViewport()
    }
    // Nothing else: no Monday–Sunday strip, no week navigation, no block rail.
    await expect(page.getByRole('list', { name: 'This week' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Weeks' })).toHaveCount(0)
    await expect(page.locator('[data-testid^="day-"]')).toHaveCount(0)
    await expect(page.locator('main section')).toHaveCount(4)
    await shoot(page, 'home')

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Training' }).click()
    await expect(page).toHaveURL(/#\/training$/)
    await expect(page.getByTestId('block-week')).toHaveText('Week 3 of 12')
    await expect(page.getByRole('list', { name: 'This week' }).getByRole('listitem')).toHaveCount(7)
    await expect(page.getByRole('navigation', { name: 'Weeks' })).toBeVisible()
    await expect(page.getByTestId('week-sessions-done')).toContainText('of 4 sessions done this week')
    await shoot(page, 'training')
  }
})

test('a full planned session is logged from the keyboard: lb, reps, RIR — never a set type', async ({ page }) => {
  await page.goto('/#/training')
  await page.getByRole('button', { name: 'Start Lower A' }).click()
  await expect(page.getByRole('heading', { name: 'Lower A', level: 1 })).toBeVisible()
  const workoutId = /#\/workouts\/([a-f0-9]+)$/.exec(page.url())?.[1] ?? ''
  // No set-type control anywhere on the workout.
  await expect(page.getByRole('combobox', { name: /set type/i })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: /type/i })).toHaveCount(0)

  const cards = page.locator('[data-testid^="slot-lower_a."]')
  const total = await cards.count()
  let logged = 0
  for (let index = 0; index < total; index += 1) {
    const card = cards.nth(index)
    const rows = await card.getByTestId('new-set-row').count()
    // One click into the exercise; from there the keyboard does everything.
    await card.getByTestId('new-set-row').first().getByRole('textbox', { name: /^Load in lb/ }).click()
    for (let row = 0; row < rows; row += 1) {
      await page.keyboard.type(String(100 + index * 10))
      await page.keyboard.press('Tab')
      await page.keyboard.type(String(8 - (row % 2)))
      await page.keyboard.press('Tab')
      await page.keyboard.type('2')
      await page.keyboard.press('Enter')
      logged += 1
      await expect(card.getByTestId('set-row')).toHaveCount(row + 1)
    }
    // Enter on the last planned row leaves the cursor on "Add set".
    await expect(card.getByRole('button', { name: /^Add set/ })).toBeFocused()
  }
  expect(logged).toBe(18)
  await expect.poll(() => db(`SELECT count(*) FROM performed_set WHERE workout_id = '${workoutId}'`)).toBe('18')
  expect(db(`SELECT group_concat(DISTINCT set_type) FROM performed_set WHERE workout_id = '${workoutId}'`)).toBe('working')

  // A just-saved set pops a check (a visible 220 ms confirmation, then gives the number back).
  const confirm = page.locator('.confirm').last()
  expect(await confirm.evaluate((element) => getComputedStyle(element).animationDuration)).toBe('0.22s, 0.26s')

  // All 18 planned working sets: completing does not ask, and nothing says "shortened".
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  await expect(page.getByTestId('workout-shortfall')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Workout completed and saved as evidence.')

  await page.getByRole('link', { name: 'Back to Training' }).click()
  const tile = page.getByTestId('planned-lower_a')
  await expect(tile).toHaveAttribute('data-status', 'complete')
  await expect(tile.getByTestId('session-status')).toHaveText('Done')
  await expect(tile.getByTestId('session-sets')).toHaveText('18 of 18 working sets')
  await page.goto('/')
  await expect(page.getByTestId('home-recent')).toContainText('Lower A')
})

test('motion is perceptible: page entrance, sliding nav, card lift, button press', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Today', exact: true })).toBeVisible()
  const style = (selector: string, property: string) =>
    page.locator(selector).first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)

  // A route change: the screen fades and rises 6 px over 210 ms.
  expect(await style('.enter', 'animation-duration')).toBe('0.21s')
  expect(await style('.enter', 'animation-name')).toBe('rise')
  // The nav indicator slides (200 ms) from Home to Training.
  const indicator = page.getByTestId('nav-indicator')
  expect(await indicator.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0.2s, 0.2s')
  const before = await indicator.boundingBox()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Training' }).click()
  await expect.poll(async () => (await indicator.boundingBox())?.x).toBeGreaterThan((before?.x ?? 0) + 20)
  await page.goto('/')
  // Cards lift 2 px in 140 ms; buttons compress in 100 ms.
  const card = page.getByTestId('home-bodyweight')
  expect(await card.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0.14s, 0.14s')
  // Measure the resting position once the entrance has finished.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
  const rest = await card.boundingBox()
  await card.hover()
  await expect.poll(async () => (await card.boundingBox())?.y).toBeCloseTo((rest?.y ?? 0) - 2, 0)
  expect(await style('.press', 'transition-duration')).toMatch(/^0\.1s/)
})
