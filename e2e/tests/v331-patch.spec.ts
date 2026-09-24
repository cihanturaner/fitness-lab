import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DB_PATH_V331, acceptShortfall, auditRequests, sql } from './support'

// The V3.3.1 patch journey, against its own fresh scratch database (block started two Mondays
// ago, so the source's weeks 1–2 rule is in force): a new exercise typed by name for one
// workout, two planned slots performed as that same exercise kept apart everywhere, the macro
// target as a setting (first setup without an exception, a later change with one, history kept),
// Settings › Program in Turkish, and History with the day timeline as its only primary view.
// Screenshots at 1440x900 and 1728x1117 go to artifacts/v331/.

test.describe.configure({ mode: 'serial' })

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const db = (query: string) => sql(query, DB_PATH_V331)
let audit: () => void

test.beforeEach(({ page, baseURL }) => {
  audit = auditRequests(page, [baseURL ?? ''])
})

test.afterEach(() => audit())

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]

async function shoot(page: Page, name: string, fullPage = false) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(600) // let entrance and fills settle
    await page.screenshot({ path: `../artifacts/v331/${name}-${viewport.width}x${viewport.height}.png`, fullPage })
  }
  await page.setViewportSize(VIEWPORTS[0] as { width: number; height: number })
}

function localDay(offset = 0): string {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

async function plannedId(page: Page, name: string): Promise<string> {
  const active = (await (await page.request.get('/api/program/active')).json()) as {
    planned_workouts: { id: string; name: string }[]
  }
  const found = active.planned_workouts.find((item) => item.name === name)
  if (!found) throw new Error(`no planned workout ${name}`)
  return found.id
}

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

function programFingerprint(): string {
  return [
    db('SELECT count(*) FROM program_version'),
    db("SELECT group_concat(id || ':' || exercise_id, ',') FROM (SELECT id, exercise_id FROM planned_exercise_slot ORDER BY id)"),
    db("SELECT count(*) || ':' || total(reps_min) || ':' || total(coalesce(reps_max, 0)) FROM planned_set"),
  ].join('|')
}

let workoutId = ''

test('a new exercise typed by name is used for this workout only, created once', async ({ page }) => {
  const program = programFingerprint()
  const exercisesBefore = Number(db('SELECT count(*) FROM exercise'))
  workoutId = await openSession(page, 'Upper B')

  const pressdown = page.getByTestId('slot-upper_b.07')
  await expect(pressdown).toHaveAttribute('aria-label', 'Cable Pressdown')
  await pressdown.getByRole('button', { name: 'Change exercise, slot 7' }).click()
  const panel = pressdown.getByRole('region', { name: 'Change exercise, slot 7' })
  await panel.getByRole('textbox', { name: 'Search or type an exercise, slot 7' }).fill('  triceps   curl ')
  const use = panel.getByRole('button', { name: 'Use “Triceps Curl” for this workout' })
  await expect(use).toBeVisible()
  await expect(panel).toContainText('the plan keeps Cable Pressdown')
  await shoot(page, 'change-typed')
  await use.click()
  await expect(pressdown).toHaveAttribute('aria-label', 'Triceps Curl')
  await expect(pressdown.getByTestId('planned-exercise')).toHaveText('Planned: Cable Pressdown · changed for this workout')
  expect(db("SELECT count(*) FROM exercise WHERE name = 'Triceps Curl' AND equipment_label IS NULL")).toBe('1')
  expect(Number(db('SELECT count(*) FROM exercise'))).toBe(exercisesBefore + 1)

  // Typing the same name again, in another case, finds it — no second "Triceps Curl".
  const pecDeck = page.getByTestId('slot-upper_b.06')
  await expect(pecDeck).toHaveAttribute('aria-label', 'Reverse Pec Deck')
  await pecDeck.getByRole('button', { name: 'Change exercise, slot 6' }).click()
  const second = pecDeck.getByRole('region', { name: 'Change exercise, slot 6' })
  await second.getByRole('textbox', { name: 'Search or type an exercise, slot 6' }).fill('TRICEPS curl')
  await expect(second.getByTestId('use-typed-exercise')).toHaveCount(0)
  await second.getByRole('list', { name: 'Matching exercises' }).getByRole('button', { name: 'Triceps Curl' }).click()
  await expect(pecDeck).toHaveAttribute('aria-label', 'Triceps Curl')
  await expect(pecDeck.getByTestId('planned-exercise')).toHaveText('Planned: Reverse Pec Deck · changed for this workout')
  expect(db("SELECT count(*) FROM exercise WHERE lower(name) = 'triceps curl'")).toBe('1')

  // The locked program is untouched.
  expect(programFingerprint()).toBe(program)
})

test('two slots performed as the same exercise keep their own sets, count and history', async ({ page }) => {
  await page.goto(`/#/workouts/${workoutId}`)
  const pressdown = page.getByTestId('slot-upper_b.07')
  const pecDeck = page.getByTestId('slot-upper_b.06')
  await expect(page.getByText(/recorded under exercise/)).toHaveCount(0)
  await addSet(pressdown, '40', '12', '2')
  await addSet(pecDeck, '25', '15', '2')
  await addSet(pressdown, '40', '11', '1')
  await addSet(pecDeck, '25', '14', '1')
  await expect(pressdown.getByTestId('set-row')).toHaveCount(2)
  await expect(pecDeck.getByTestId('set-row')).toHaveCount(2)
  await expect(pressdown.getByTitle('Working sets saved of planned')).toHaveText('2/2')
  await expect(pecDeck.getByTitle('Working sets saved of planned')).toHaveText('2/2')
  await shoot(page, 'workout-two-slots', true)

  // Persisted truth: each set placed in its own slot, never merged by exercise.
  expect(
    db(
      `SELECT group_concat(k || '=' || n, ',') FROM (SELECT ps.slot_key AS k, count(*) AS n FROM performed_set_slot p JOIN planned_exercise_slot ps ON ps.id = p.slot_id WHERE p.workout_id = '${workoutId}' GROUP BY ps.slot_key ORDER BY ps.slot_key)`,
    ),
  ).toBe('upper_b.06=2,upper_b.07=2')

  const asked = acceptShortfall(page)
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  expect(asked()).toContain('4 actual working sets recorded / 21 planned')
  // A reload after completion still shows each slot with only its own sets.
  await page.reload()
  await expect(page.getByTestId('slot-upper_b.07').getByTestId('set-row')).toHaveCount(2)
  await expect(page.getByTestId('slot-upper_b.06').getByTestId('set-row')).toHaveCount(2)

  // The next Upper B opens on the planned exercises.
  const next = await page.request.post(`/api/planned-workouts/${await plannedId(page, 'Upper B')}/open`, {
    data: { performed_on: localDay() },
  })
  const nextId = ((await next.json()) as { workout_id: string }).workout_id
  const nextEntry = (await (await page.request.get(`/api/workouts/${nextId}/entry`)).json()) as {
    slots: { slot_key: string; substitute_exercise_id: string | null }[]
  }
  expect(nextEntry.slots.every((slot) => slot.substitute_exercise_id === null)).toBe(true)
  expect((await page.request.delete(`/api/workouts/${nextId}`)).status()).toBe(204)

  // History, day by day: two lines of Triceps Curl, each with its own planned exercise.
  await page.goto('/#/history')
  const workout = page.getByTestId('day-workout').first()
  const curls = workout.getByTestId('day-exercise').filter({ hasText: 'Triceps Curl' })
  await expect(curls).toHaveCount(2)
  const fromPressdown = curls.filter({ hasText: 'Planned: Cable Pressdown' })
  const fromPecDeck = curls.filter({ hasText: 'Planned: Reverse Pec Deck' })
  await expect(fromPressdown).toContainText('Performed: Triceps Curl')
  await expect(fromPressdown).toContainText('40 lb × 12 @ RIR 2 · 40 lb × 11 @ RIR 1')
  await expect(fromPecDeck).toContainText('Performed: Triceps Curl')
  await expect(fromPecDeck).toContainText('25 lb × 15 @ RIR 2 · 25 lb × 14 @ RIR 1')
  await shoot(page, 'history-two-slots')

  // Exercise history: one row per slot, each "in place of" its own planned exercise.
  await fromPressdown.getByRole('link', { name: 'Triceps Curl' }).click()
  await expect(page.getByRole('heading', { name: 'Triceps Curl', level: 2 })).toBeVisible()
  await expect(page.getByTestId('history-exposure')).toHaveCount(2)
  await expect(page.getByTestId('history-replaced')).toHaveText(['in place of Cable Pressdown', 'in place of Reverse Pec Deck'])
  await shoot(page, 'history-exercise-two-slots')
})

test('the macro target is a setting: first set up without an exception, later changes keep history', async ({ page }) => {
  await page.request.put(`/api/nutrition/${localDay(-2)}`, { data: { protein_g: 150, carbs_g: 280, fat_g: 70 } })
  await page.goto('/#/nutrition')
  await expect(page.getByTestId('nut-target-line')).toHaveText('Current targets: none yet')
  // The day form is intake only.
  const dayForm = page.getByRole('form', { name: 'Log the day' })
  await expect(dayForm.getByRole('textbox')).toHaveCount(4)
  await expect(dayForm).not.toContainText(/target/i)

  // First setup in block weeks 1–2: no exception is asked; effective today unless changed.
  await page.getByRole('button', { name: 'Set targets' }).click()
  const form = page.getByRole('form', { name: 'Macro targets' })
  await expect(form.getByLabel('Targets effective from')).toHaveValue(localDay())
  await expect(form.getByRole('combobox', { name: 'Target reason' })).toHaveCount(0)
  await expect(form).not.toContainText(/exception/i)
  await form.getByRole('textbox', { name: 'Protein target g' }).fill('150')
  await form.getByRole('textbox', { name: 'Carbs target g' }).fill('300')
  await form.getByRole('textbox', { name: 'Fat target g' }).fill('60')
  await form.getByLabel('Targets effective from').fill(localDay(-3))
  await expect(form.getByTestId('target-form-kcal')).toHaveText('150 × 4 + 300 × 4 + 60 × 9 = 2340 kcal')
  await shoot(page, 'nutrition-first-target')
  await form.getByRole('button', { name: 'Save targets' }).click()
  await expect(page.getByTestId('nut-target-line')).toHaveText('Current targets: 150P · 300C · 60F / 2340 kcal')
  expect(db("SELECT protein_g || '/' || carbs_g || '/' || fat_g || '/' || coalesce(notes, '-') FROM macro_target")).toBe(
    '150/300/60/-',
  )
  await shoot(page, 'nutrition-setting')

  // Changing an established target in weeks 1–2 still needs one of the source's exceptions.
  await page.getByRole('button', { name: 'Edit targets' }).click()
  await expect(form.getByRole('textbox', { name: 'Carbs target g' })).toHaveValue('300')
  await form.getByRole('textbox', { name: 'Carbs target g' }).fill('340')
  await form.getByRole('button', { name: 'Save targets' }).click()
  await expect(form.getByRole('alert')).toContainText('choose the exception')
  expect(db('SELECT count(*) FROM macro_target')).toBe('1')
  await form.getByRole('combobox', { name: 'Target reason' }).selectOption({ label: 'obvious logging error' })
  await form.getByRole('button', { name: 'Save targets' }).click()
  await expect(page.getByTestId('nut-target-line')).toHaveText('Current targets: 150P · 340C · 60F / 2500 kcal')
  expect(db("SELECT group_concat(effective_on || ':' || carbs_g, ',') FROM (SELECT effective_on, carbs_g FROM macro_target ORDER BY effective_on)")).toBe(
    `${localDay(-3)}:300,${localDay()}:340`,
  )

  // The earlier day keeps the target it had.
  await page.getByLabel('Nutrition date').fill(localDay(-2))
  await expect(page.getByTestId('nut-day-target')).toHaveText('Judged by the targets in force that day: 150P · 300C · 60F / 2340 kcal.')
  await expect(page.getByTestId('nut-target-carbs')).toHaveText('300 g')
  await expect(page.getByTestId('nut-target-line')).toHaveText('Current targets: 150P · 340C · 60F / 2500 kcal')
  await page.getByRole('button', { name: 'History (2)' }).click()
  await expect(page.getByRole('region', { name: 'Target history' }).getByTestId('target-row')).toHaveCount(2)
  await page.goto('/#/history')
  const earlier = page.getByTestId('history-day').filter({ has: page.getByTestId('day-nutrition') })
  await expect(earlier.getByTestId('day-nutrition')).toContainText('target 2340')
})

test('Settings › Program is wholly Turkish; names and source tokens stay verbatim', async ({ page }) => {
  await page.goto('/#/settings')
  const program = page.getByRole('region', { name: 'Program' })
  await expect(program).toHaveAttribute('lang', 'tr')
  const facts = program.getByTestId('program-facts')
  await expect(facts).toContainText('Sürüm')
  await expect(facts).toContainText('Aktifleşme tarihi')
  await expect(facts).not.toContainText(/Version|Active since/)
  const rules = program.getByTestId('program-rules')
  for (const button of await rules.getByRole('button').all()) await button.click()
  await expect(rules.getByRole('button', { name: 'Hafifletme Haftası (P1)' })).toBeVisible()
  await expect(rules.getByRole('button', { name: '12. Hafta (P2)' })).toBeVisible()
  await expect(rules).toContainText('load * (1 + (reps + RIR) / 30)')
  await expect(rules).toContainText('Yama P7′')

  // Every English word left must be an exercise name or a source token.
  const source = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'programs/advanced-natural-12w/artifact/locked_workout_program.json'), 'utf-8'),
  ) as { substitution_matrix: Record<string, unknown> }
  let text = (await program.textContent()) ?? ''
  const names = new Set<string>(['Upper A', 'Lower A', 'Upper B', 'Lower B', '45° Back Extension', 'Hip Thrust'])
  for (const [key, value] of Object.entries(source.substitution_matrix)) {
    if (!Array.isArray(value)) continue
    names.add(key)
    for (const item of value as string[]) names.add(item.replace(' if unavailable/intolerant', ''))
  }
  for (const name of [...names].sort((a, b) => b.length - a.length)) text = text.split(name).join(' ')
  for (const token of ['load * (1 + (reps + RIR) / 30)', 'FINAL_PATCHED_LOCKED', 'DECISION_GRADE_PASS_WITH_CAVEAT', 'locked_workout_program.json']) {
    text = text.split(token).join(' ')
  }
  expect(
    text.match(
      /\b(the|and|of|to|if|for|from|with|only|not|none|yes|no|week|weeks|deload|taper|version|active|since|rules?|about|source|sets|work|rest|duration|automatic|progression|calibration|warm-?up|volume|direct|fractional|notes?|importing|switching|command|guidance|app|unavailable|intolerant|hamstrings?|core|natural)\b/i,
    ),
  ).toBeNull()
  await shoot(page, 'settings-program-tr', true)
})

test('History is the day timeline only: no Sessions view; exercise history is a secondary link', async ({ page }) => {
  await page.goto('/#/history')
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'History views' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sessions' })).toHaveCount(0)
  await expect(page.getByText('Sessions', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('history-day').first()).toBeVisible()
  await shoot(page, 'history-days')
  await page.getByRole('link', { name: 'Exercise history →' }).click()
  await expect(page).toHaveURL(/#\/history\/exercises$/)
  await expect(page.getByRole('heading', { name: 'Exercise history', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: '← Day by day' }).click()
  await expect(page).toHaveURL(/#\/history$/)
  // The retired Sessions address opens the day timeline.
  await page.goto('/#/sessions')
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await expect(page.getByTestId('history-day').first()).toBeVisible()
})
