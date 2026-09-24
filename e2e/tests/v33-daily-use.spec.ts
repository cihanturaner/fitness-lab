import { readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DB_PATH_V33, acceptShortfall, auditRequests, sql } from './support'

// The V3.3 daily-use journey, against its own fresh scratch database (block started two
// Mondays ago): an exercise changed for one workout only, accidental drafts discarded, macro
// targets with an effective-dated history, the day-by-day History, and the program rules in
// Turkish. Screenshots of each at 1440x900 and 1728x1117 go to artifacts/v33/.

test.describe.configure({ mode: 'serial' })

const db = (query: string) => sql(query, DB_PATH_V33)
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
  await page.screenshot({ path: `../artifacts/v33/${name}-${width}x${height}.png` })
}

function localDay(offset = 0): string {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/** "THU 24 SEP", as the History card labels a date. */
function dayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const value = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][value.getDay()]
  const monthName = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][value.getMonth()]
  return `${weekday} ${value.getDate()} ${monthName}`
}

async function plannedId(page: Page, name: string): Promise<string> {
  const active = (await (await page.request.get('/api/program/active')).json()) as {
    planned_workouts: { id: string; name: string }[]
  }
  const found = active.planned_workouts.find((item) => item.name === name)
  if (!found) throw new Error(`no planned workout ${name}`)
  return found.id
}

/** Open (or resume) a planned session dated today and show it. */
async function openSession(page: Page, name: string): Promise<string> {
  const response = await page.request.post(`/api/planned-workouts/${await plannedId(page, name)}/open`, {
    data: { performed_on: localDay() },
  })
  expect(response.status()).toBe(200)
  const workoutId = ((await response.json()) as { workout_id: string }).workout_id
  await page.goto(`/#/workouts/${workoutId}`)
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  return workoutId
}

async function addSet(card: Locator, load: string, reps: string, rir: string) {
  const row = card.getByTestId('new-set-row').first()
  await row.getByRole('textbox', { name: /^Load in lb/ }).fill(load)
  await row.getByRole('textbox', { name: /^Reps/ }).fill(reps)
  await row.getByRole('textbox', { name: /^RIR/ }).fill(rir)
  const before = await card.getByTestId('set-row').count()
  await row.getByRole('textbox', { name: /^RIR/ }).press('Enter')
  await expect(card.getByTestId('set-row')).toHaveCount(before + 1)
}

/** Every planned row of the program: a change for one workout must never alter it. */
function programFingerprint(): string {
  return [
    db('SELECT count(*) FROM program_version'),
    db("SELECT group_concat(id || ':' || exercise_id, ',') FROM (SELECT id, exercise_id FROM planned_exercise_slot ORDER BY id)"),
    db("SELECT count(*) || ':' || total(reps_min) || ':' || total(coalesce(reps_max, 0)) FROM planned_set"),
  ].join('|')
}

test('an exercise is changed for this workout only; the plan and the next session keep it', async ({ page }) => {
  const program = programFingerprint()
  const workoutId = await openSession(page, 'Lower B')

  // An approved substitute from the locked notes: Glute Drive for the planned Smith Hip Thrust.
  const thrust = page.getByTestId('slot-lower_b.02')
  await expect(thrust).toHaveAttribute('aria-label', 'Smith Hip Thrust')
  await thrust.getByRole('button', { name: 'Change exercise, slot 2' }).click()
  const panel = thrust.getByRole('region', { name: 'Change exercise, slot 2' })
  await expect(panel).toContainText('This workout only · the plan stays Smith Hip Thrust')
  await expect(panel.getByRole('button', { name: 'Glute Drive' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Smith Glute Bridge' })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await shoot(page, 'workout-change')
  }
  await page.setViewportSize(VIEWPORTS[0] ?? { width: 1440, height: 900 })
  await panel.getByRole('button', { name: 'Glute Drive' }).click()
  await expect(thrust).toHaveAttribute('aria-label', 'Glute Drive')
  await expect(thrust.getByTestId('planned-exercise')).toHaveText('Planned: Smith Hip Thrust · changed for this workout')

  // Any other existing exercise, found by search: 45° Leg Press for the planned Hack Squat.
  const squat = page.getByTestId('slot-lower_b.01')
  await squat.getByRole('button', { name: 'Change exercise, slot 1' }).click()
  await squat.getByRole('textbox', { name: 'Search exercises, slot 1' }).fill('leg press')
  await squat.getByRole('list', { name: 'Matching exercises' }).getByRole('button', { name: '45° Leg Press' }).click()
  await expect(squat).toHaveAttribute('aria-label', '45° Leg Press')
  await expect(squat.getByTestId('planned-exercise')).toHaveText('Planned: Hack Squat · changed for this workout')

  await addSet(squat, '44', '3', '2')
  await addSet(thrust, '11', '11', '1')
  expect(
    db(
      `SELECT group_concat(name, ',') FROM (SELECT e.name FROM workout_slot_substitution s JOIN exercise e ON e.id = s.exercise_id WHERE s.workout_id = '${workoutId}' ORDER BY e.name)`,
    ),
  ).toBe('45° Leg Press,Glute Drive')
  const asked = acceptShortfall(page)
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  expect(asked()).toContain('2 actual working sets recorded / 19 planned')
  // The performed identity is what was trained; the plan is untouched.
  expect(programFingerprint()).toBe(program)

  // The next Lower B is back on the planned exercises.
  const next = await openSession(page, 'Lower B')
  expect(next).not.toBe(workoutId)
  await expect(page.getByTestId('slot-lower_b.02')).toHaveAttribute('aria-label', 'Smith Hip Thrust')
  await expect(page.getByTestId('slot-lower_b.01')).toHaveAttribute('aria-label', 'Hack Squat')
  await expect(page.getByTestId('planned-exercise')).toHaveCount(0)
  expect(db(`SELECT count(*) FROM workout_slot_substitution WHERE workout_id = '${next}'`)).toBe('0')

  // It was opened by mistake: an empty draft is discarded after a light confirmation.
  let question = ''
  page.once('dialog', (dialog) => {
    question = dialog.message()
    void dialog.accept()
  })
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page).toHaveURL(/#\/$/)
  expect(question).toContain('Discard this empty draft?')
  expect(db(`SELECT count(*) FROM workout WHERE id = '${next}'`)).toBe('0')
  expect(programFingerprint()).toBe(program)
})

test('a draft holding sets is discarded only after a stronger confirmation; the plan stays', async ({ page }) => {
  const program = programFingerprint()
  const workoutId = await openSession(page, 'Upper A')
  await addSet(page.getByTestId('slot-upper_a.01'), '135', '8', '2')

  let dialogs = 0
  page.on('dialog', (dialog) => {
    dialogs += 1
    void dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Discard draft' }).click()
  const ask = page.getByRole('alertdialog')
  await expect(ask).toContainText('Discard this draft and its 1 recorded set?')
  await expect(ask).toContainText('Recorded here: Smith Flat Bench Press.')
  await ask.getByRole('button', { name: 'Keep the draft' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(db(`SELECT count(*) FROM performed_set WHERE workout_id = '${workoutId}'`)).toBe('1')

  await page.getByRole('button', { name: 'Discard draft' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard 1 set' }).click()
  await expect(page).toHaveURL(/#\/$/)
  expect(dialogs).toBe(0)
  expect(db(`SELECT count(*) FROM workout WHERE id = '${workoutId}'`)).toBe('0')
  const snapshots = readdirSync(path.join(path.dirname(DB_PATH_V33), 'snapshots'))
  expect(snapshots.filter((name) => name.endsWith(`pre-discard-workout-${workoutId}.db`))).toHaveLength(1)
  expect(programFingerprint()).toBe(program)

  // Home and Training show no draft at once.
  await expect(page.getByRole('region', { name: 'Today', exact: true })).not.toContainText('In progress')
  await page.goto('/#/training')
  await expect(page.locator('[data-status="draft"]')).toHaveCount(0)
})

test('targets are protein, carbs and fat; calories follow; earlier days keep their target', async ({ page }) => {
  await page.request.put(`/api/nutrition/${localDay(-2)}`, { data: { protein_g: 150, carbs_g: 280, fat_g: 70 } })
  await page.goto('/#/nutrition')
  await page.getByRole('button', { name: 'Set targets…' }).click()
  const form = page.getByRole('form', { name: 'Macro targets' })
  await form.getByRole('textbox', { name: 'Protein target g' }).fill('150')
  await form.getByRole('textbox', { name: 'Carbs target g' }).fill('300')
  await form.getByRole('textbox', { name: 'Fat target g' }).fill('70')
  await form.getByLabel('Targets effective from').fill(localDay(-3))
  await expect(form.getByTestId('target-form-kcal')).toHaveText('150 × 4 + 300 × 4 + 70 × 9 = 2430 kcal')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await shoot(page, 'nutrition-targets')
  }
  await page.setViewportSize(VIEWPORTS[0] ?? { width: 1440, height: 900 })
  await form.getByRole('button', { name: 'Save targets' }).click()
  await expect(page.getByTestId('nut-target-calories')).toHaveText('2430 kcal')

  // Today's macros; calories derived.
  await page.getByRole('textbox', { name: 'Protein g' }).fill('150')
  await page.getByRole('textbox', { name: 'Carbs g' }).fill('200')
  await page.getByRole('textbox', { name: 'Fat g' }).fill('50')
  await page.getByRole('button', { name: /Save day|Update day/ }).click()
  await expect(page.getByRole('status')).toContainText('Saved')

  // A change today: from today on only. This is block week 2, where the source allows a
  // change only for one of its exceptions, so the form asks for one first.
  await page.getByRole('button', { name: 'Change targets…' }).click()
  await expect(form.getByRole('textbox', { name: 'Carbs target g' })).toHaveValue('300')
  await form.getByRole('textbox', { name: 'Carbs target g' }).fill('340')
  await form.getByRole('button', { name: 'Save targets' }).click()
  await expect(form.getByRole('alert')).toContainText('choose the exception')
  expect(db('SELECT count(*) FROM macro_target')).toBe('1')
  await form.getByRole('combobox', { name: 'Target reason' }).selectOption({ label: 'obvious logging error' })
  await form.getByRole('button', { name: 'Save targets' }).click()
  await expect(page.getByTestId('nut-target-calories')).toHaveText('2590 kcal')
  await expect(page.getByTestId('nut-target-line')).toContainText('150 P · 340 C · 70 F = 2590 kcal')
  expect(db("SELECT group_concat(carbs_g, ',') FROM (SELECT carbs_g FROM macro_target ORDER BY effective_on)")).toBe('300,340')
  expect(db('SELECT count(*) FROM calorie_target')).toBe('0')

  // Each day is scored against the target in force on it, and that survives a reload.
  await page.reload()
  const days = page.getByRole('region', { name: 'Recent days' }).getByTestId('nut-day')
  await expect(days.first()).toContainText('1850')
  await expect(days.first()).toContainText('−740') // 1850 against 2590
  await expect(days.nth(1)).toContainText('2350')
  await expect(days.nth(1)).toContainText('−80') // 2350 against 2430, not today's 2590
  await page.getByLabel('Nutrition date').fill(localDay(-2))
  await expect(page.getByTestId('nut-target-calories')).toHaveText('2430 kcal')
  await expect(page.getByTestId('nut-target-carbs')).toHaveText('300 g')
  await expect(page.getByRole('region', { name: 'Target history' }).getByTestId('target-row')).toHaveCount(2)
})

test('History is one card per day, newest first; exercise history stays one click away', async ({ page }) => {
  await page.request.put(`/api/bodyweight/${localDay()}`, { data: { bodyweight_kg: '72.00' } })
  await page.request.put(`/api/bodyweight/${localDay(-1)}`, { data: { bodyweight_kg: '71.80' } })

  await page.goto('/#/history')
  const cards = page.getByTestId('history-day')
  await expect(cards).toHaveCount(3)
  expect(await cards.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))).toEqual([
    dayLabel(localDay()),
    dayLabel(localDay(-1)),
    dayLabel(localDay(-2)),
  ])
  const today = cards.first()
  const workout = today.getByTestId('day-workout')
  await expect(workout).toHaveCount(1) // the discarded drafts are gone, not history
  await expect(workout).toContainText('Lower B')
  await expect(workout.getByTestId('day-shortened')).toHaveText('Shortened')
  await expect(workout).toContainText('2 of 19 working sets')
  const glute = workout.getByTestId('day-exercise').filter({ hasText: 'Glute Drive' })
  await expect(glute.getByTestId('day-planned')).toHaveText('Planned: Smith Hip Thrust')
  await expect(glute).toContainText('11 lb × 11 @ RIR 1')
  await expect(workout.getByTestId('day-exercise').filter({ hasText: '45° Leg Press' })).toContainText('44 lb × 3 @ RIR 2')
  await expect(today.getByTestId('day-bodyweight')).toHaveText('Bodyweight72 kg')
  await expect(today.getByTestId('day-nutrition')).toContainText('1850 kcal · 150P · 200C · 50F')
  await expect(today.getByTestId('day-nutrition')).toContainText('target 2590')
  await expect(cards.nth(1).getByTestId('day-workout')).toHaveCount(0)
  await expect(cards.nth(1).getByTestId('day-bodyweight')).toHaveText('Bodyweight71.8 kg')
  await expect(cards.nth(2).getByTestId('day-nutrition')).toContainText('2350 kcal')
  await expect(cards.nth(2).getByTestId('day-nutrition')).toContainText('target 2430')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await shoot(page, 'history-days')
  }
  await page.setViewportSize(VIEWPORTS[0] ?? { width: 1440, height: 900 })

  const filter = page.getByRole('group', { name: 'Show' })
  await filter.getByRole('button', { name: 'Training' }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first().getByTestId('day-bodyweight')).toHaveCount(0)
  await filter.getByRole('button', { name: 'Bodyweight' }).click()
  await expect(cards).toHaveCount(2)
  await expect(page.getByTestId('day-workout')).toHaveCount(0)
  await filter.getByRole('button', { name: 'Nutrition' }).click()
  await expect(cards).toHaveCount(2)
  await filter.getByRole('button', { name: 'All' }).click()
  await expect(cards).toHaveCount(3)

  // The exercise name opens its history: the secondary view, which names what it replaced.
  await glute.getByRole('link', { name: 'Glute Drive' }).click()
  await expect(page).toHaveURL(/#\/history\/[a-f0-9]+$/)
  await expect(page.getByRole('heading', { name: 'Glute Drive', level: 2 })).toBeVisible()
  await expect(page.getByTestId('history-replaced')).toHaveText('in place of Smith Hip Thrust')
  await expect(page.getByTestId('history-set')).toHaveText(['11 lb × 11 @ RIR 1'])
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await shoot(page, 'history-exercise')
  }
})

test('Settings › Program rules are in Turkish, faithful to the locked source', async ({ page }) => {
  await page.goto('/#/settings')
  const program = page.getByRole('region', { name: 'Program' })
  await expect(program.getByRole('heading', { name: 'Program Kuralları' })).toBeVisible()
  const rules = program.getByTestId('program-rules')
  await expect(rules.getByRole('button')).toHaveText([
    'Program Hakkında',
    'Haftalık Program',
    'Uygulama Kuralları',
    'İlerleme Kuralları',
    'Plato / İlerleme Durması',
    'Kalibrasyon',
    'Hafta 1–11',
    'Deload (P1)',
    'Hafta 12 (P2)',
    'Isınma',
    'Haftalık Hacim',
    'Egzersiz Değişim Matrisi',
  ])
  await rules.getByRole('button', { name: 'Deload (P1)' }).click()
  await expect(rules).toContainText('Süre (gün)7')
  await expect(rules).toContainText('Önceki haftalık set sayısı81')
  await expect(rules).toContainText('Deload haftalık set sayısı48')
  await rules.getByRole('button', { name: 'Egzersiz Değişim Matrisi' }).click()
  await expect(rules).toContainText('Smith/Machine Hip ThrustGlute Drive, Smith Glute Bridge')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await shoot(page, 'settings-rules-tr')
  }
})
