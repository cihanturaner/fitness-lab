import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DB_PATH, auditRequests, count, sql } from './support'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test.describe.configure({ mode: 'serial' })

let audit: () => void

test.beforeEach(({ page, baseURL }) => {
  audit = auditRequests(page, [baseURL ?? '', 'http://127.0.0.1:8711'])
})

test.afterEach(() => audit())

function slot(page: Page, key: string): Locator {
  return page.getByTestId(`slot-${key}`)
}

async function addSet(card: Locator, load: string, reps: string, rir: string) {
  const next = card.getByTestId('new-set-row')
  if (!(await next.isVisible())) await card.getByRole('button', { name: 'Add set' }).click()
  const row = card.getByTestId('new-set-row')
  const type = row.getByRole('combobox', { name: /^Set type/ })
  if ((await type.inputValue()) === '') await type.selectOption('working')
  const loadInput = row.getByRole('textbox', { name: /^Load in kg/ })
  await loadInput.fill(load)
  await row.getByRole('textbox', { name: /^Reps/ }).fill(reps)
  await row.getByRole('textbox', { name: /^RIR/ }).fill(rir)
  const before = await card.getByTestId('set-row').count()
  await row.getByRole('button', { name: 'Save set' }).click()
  await expect(card.getByTestId('set-row')).toHaveCount(before + 1)
}

async function actualRows(card: Locator): Promise<string[][]> {
  const rows = card.getByTestId('set-row')
  const result: string[][] = []
  for (let index = 0; index < (await rows.count()); index += 1) {
    const row = rows.nth(index)
    result.push([
      await row.getByRole('textbox', { name: /^Load in kg/ }).inputValue(),
      await row.getByRole('textbox', { name: /^Reps/ }).inputValue(),
      await row.getByRole('textbox', { name: /^RIR/ }).inputValue(),
    ])
  }
  return result
}

async function resumeUpperA(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Resume draft of Upper A' }).click()
  await expect(page).toHaveURL(/#\/workouts\/[a-f0-9]+$/)
  await expect(page.getByRole('heading', { name: 'Upper A', level: 1 })).toBeVisible()
}

function currentWorkoutId(page: Page): string {
  const match = /#\/workouts\/([a-f0-9]+)$/.exec(page.url())
  if (!match?.[1]) throw new Error(`not on a workout page: ${page.url()}`)
  return match[1]
}

test('the active 12-week program and its four planned sessions are visible', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '12-Week Advanced Natural Hypertrophy + Strength Program' }),
  ).toBeVisible()
  const sessions = page.getByRole('list', { name: 'Planned sessions' })
  await expect(sessions.getByRole('listitem')).toHaveCount(4)
  await expect(page.getByTestId('planned-upper_a')).toContainText('9 exercises, 23 planned sets')
  await expect(page.getByTestId('planned-lower_a')).toContainText('6 exercises, 18 planned sets')
  await expect(page.getByTestId('planned-upper_b')).toContainText('8 exercises, 21 planned sets')
  await expect(page.getByTestId('planned-lower_b')).toContainText('6 exercises, 19 planned sets')
  expect(count('workout')).toBe(0)
})

test('opening a planned session creates one empty draft and shows the prescription', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Upper A' }).click()
  await expect(page.getByRole('heading', { name: 'Upper A', level: 1 })).toBeVisible()
  const workoutId = currentWorkoutId(page)

  expect(count('workout')).toBe(1)
  expect(count('performed_set')).toBe(0)
  expect(sql(`SELECT pw.workout_key FROM workout_plan_origin o JOIN planned_workout pw ON pw.id = o.planned_workout_id WHERE o.workout_id = '${workoutId}'`)).toBe('upper_a')

  const bench = slot(page, 'upper_a.01')
  const planned = bench.getByRole('region', { name: /^Planned/ })
  await expect(planned).toContainText('Smith Flat Bench Press')
  await expect(planned.getByRole('table', { name: 'Planned sets' }).getByRole('row')).toHaveCount(4)
  await expect(planned).toContainText('5–8')
  await expect(planned).toContainText('Marker lift')
  await expect(bench.getByRole('region', { name: /^Actual/ })).toContainText('No sets recorded')
  await expect(page.getByTestId('workout-status')).toHaveText('Draft')

  // Opening again resumes the same draft rather than creating another, and the home screen
  // says which record that is.
  await page.goto('/')
  await expect(page.getByTestId('planned-upper_a')).toContainText('Open draft dated')
  await resumeUpperA(page)
  await expect(page).toHaveURL(new RegExp(`#/workouts/${workoutId}$`))
  expect(count('workout')).toBe(1)
})

test('actual sets are entered, survive a reload, and can be edited, reordered and deleted', async ({ page }) => {
  await resumeUpperA(page)
  const bench = slot(page, 'upper_a.01')

  await addSet(bench, '82,5', '6', '2')
  await addSet(bench, '82.5', '5', '2')
  await addSet(bench, '80', '7', '1')
  expect(sql("SELECT group_concat(load_g || 'x' || reps || '@' || rir, ' ') FROM (SELECT * FROM performed_set ORDER BY set_order)")).toBe(
    '82500x6@2 82500x5@2 80000x7@1',
  )

  await page.reload()
  await expect.poll(() => actualRows(slot(page, 'upper_a.01'))).toEqual([
    ['82.5', '6', '2'],
    ['82.5', '5', '2'],
    ['80', '7', '1'],
  ])

  const reps = slot(page, 'upper_a.01').getByRole('textbox', { name: 'Reps, set 2' })
  await reps.fill('6')
  await reps.press('Enter')
  await expect.poll(() => sql('SELECT reps FROM performed_set WHERE set_order = 2')).toBe('6')

  await slot(page, 'upper_a.01').getByRole('button', { name: 'Move set 3 earlier' }).click()
  await expect.poll(() => actualRows(slot(page, 'upper_a.01'))).toEqual([
    ['82.5', '6', '2'],
    ['80', '7', '1'],
    ['82.5', '6', '2'],
  ])

  // Deleting asks first; dismissing keeps the set.
  page.once('dialog', (dialog) => void dialog.dismiss())
  await slot(page, 'upper_a.01').getByRole('button', { name: 'Delete set 2' }).click()
  expect(count('performed_set')).toBe(3)
  page.once('dialog', (dialog) => void dialog.accept())
  await slot(page, 'upper_a.01').getByRole('button', { name: 'Delete set 2' }).click()
  await expect.poll(() => actualRows(slot(page, 'upper_a.01'))).toEqual([
    ['82.5', '6', '2'],
    ['82.5', '6', '2'],
  ])
  expect(sql('SELECT group_concat(set_order) FROM performed_set')).toBe('1,2')

  await page.reload()
  await expect.poll(() => actualRows(slot(page, 'upper_a.01'))).toEqual([
    ['82.5', '6', '2'],
    ['82.5', '6', '2'],
  ])
})

test('a whole slot is substituted and extra work is recorded', async ({ page }) => {
  await resumeUpperA(page)
  const workoutId = currentWorkoutId(page)

  const lateral = slot(page, 'upper_a.06')
  await lateral.getByRole('combobox', { name: 'Exercise performed for slot 6' }).selectOption({ label: 'Machine Lateral Raise' })
  await expect(lateral.getByRole('region', { name: /^Actual/ })).toContainText('substituted for the whole slot')
  await expect(lateral.getByRole('region', { name: /^Planned/ })).toContainText('Cable Lateral Raise')
  expect(sql(`SELECT e.name FROM workout_slot_substitution s JOIN exercise e ON e.id = s.exercise_id WHERE s.workout_id = '${workoutId}'`)).toBe('Machine Lateral Raise')
  await addSet(lateral, '15', '15', '1')

  await page.getByRole('combobox', { name: 'Add an exercise' }).selectOption({ label: 'Leg Extension' })
  const extras = page.getByRole('region', { name: 'Extra exercises' })
  const legExtension = extras.getByRole('article').filter({ hasText: 'Leg Extension' })
  await addSet(legExtension, '40', '12', '1')

  await page.reload()
  await expect(
    slot(page, 'upper_a.06').getByRole('region', { name: 'Actual, Machine Lateral Raise' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Extra exercises' })).toContainText('Leg Extension')
  expect(count('performed_set')).toBe(4)

  // Choosing the planned exercise again clears the substitution.
  await slot(page, 'upper_a.06').getByRole('combobox', { name: 'Exercise performed for slot 6' }).selectOption({ label: 'Cable Lateral Raise (as planned)' })
  await expect.poll(() => count('workout_slot_substitution')).toBe(0)
  await slot(page, 'upper_a.06').getByRole('combobox', { name: 'Exercise performed for slot 6' }).selectOption({ label: 'Machine Lateral Raise' })
  await expect.poll(() => count('workout_slot_substitution')).toBe(1)
})

test('completion locks the record, reopening allows a correction', async ({ page }) => {
  await resumeUpperA(page)
  const workoutId = currentWorkoutId(page)

  // A set typed but not saved blocks completion instead of being silently dropped.
  const row = slot(page, 'upper_a.02')
  await row.getByRole('button', { name: 'Add set' }).click()
  await row.getByTestId('new-set-row').getByRole('textbox', { name: /^Reps/ }).fill('9')
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Not completed' })).toContainText('unsaved')
  expect(sql(`SELECT status FROM workout WHERE id = '${workoutId}'`)).toBe('draft')
  page.once('dialog', (dialog) => void dialog.accept())
  await row.getByRole('button', { name: 'Done' }).click()
  await expect(row.getByTestId('new-set-row')).toHaveCount(0)

  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  expect(sql(`SELECT status FROM workout WHERE id = '${workoutId}'`)).toBe('complete')
  await expect(slot(page, 'upper_a.01').getByRole('textbox', { name: 'Reps, set 1' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add set' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Reopen to correct' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Draft')
  const reps = slot(page, 'upper_a.01').getByRole('textbox', { name: 'Reps, set 2' })
  await reps.fill('5')
  await reps.press('Enter')
  await expect.poll(() => sql("SELECT reps FROM performed_set WHERE set_order = 2")).toBe('5')
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')
  expect(sql(`SELECT count(*) FROM workout_plan_origin WHERE workout_id = '${workoutId}'`)).toBe('1')
})

test('the next occurrence starts empty and shows the last exact performance', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('planned-upper_a')).toContainText('Performed 1×')
  await page.getByRole('button', { name: 'Start Upper A' }).click()
  await expect(page.getByRole('heading', { name: 'Upper A', level: 1 })).toBeVisible()
  const secondId = currentWorkoutId(page)

  expect(count('workout')).toBe(2)
  expect(count('performed_set', `workout_id = '${secondId}'`)).toBe(0)
  const last = slot(page, 'upper_a.01').getByTestId('last-performance')
  await expect(last).toContainText('Upper A')
  await expect(last).toContainText('82.5 kg × 6 @ RIR 2')
  await expect(last).toContainText('82.5 kg × 5 @ RIR 2')
  // The previous occurrence's substitution does not carry over.
  await expect(
    slot(page, 'upper_a.06').getByRole('region', { name: 'Actual, Cable Lateral Raise' }),
  ).toBeVisible()
  await expect(slot(page, 'upper_a.06').getByTestId('last-performance')).toHaveCount(0)
})

test('an unplanned session is first-class', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start unplanned session' }).click()
  await expect(page.getByRole('heading', { name: 'Unplanned session' })).toBeVisible()
  const workoutId = currentWorkoutId(page)
  expect(count('workout_plan_origin', `workout_id = '${workoutId}'`)).toBe(0)

  await page.getByRole('combobox', { name: 'Add an exercise' }).selectOption({ label: 'Hack Squat' })
  const card = page.getByRole('region', { name: 'Extra exercises' }).getByRole('article').filter({ hasText: 'Hack Squat' })
  await addSet(card, '100', '10', '2')
  await page.getByRole('button', { name: 'Complete workout' }).click()
  await expect(page.getByTestId('workout-status')).toHaveText('Complete')

  await page.goto('/')
  await expect(page.getByTestId('recent-workout')).toHaveCount(3)
  await page.screenshot({ path: '../artifacts/m2-home-after-journey.png', fullPage: true })
})

// --- restart and clean shutdown --------------------------------------------------------

function launch(port: number, dbPath: string = DB_PATH): ChildProcess {
  // detached: its own process group, so Ctrl-C can be simulated for the whole group.
  return spawn('bash', [path.join(REPO_ROOT, 'scripts', 'start.sh'), '--no-open'], {
    env: { ...process.env, FITNESS_LAB_DB: dbPath, FITNESS_LAB_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
}

/** True while anything accepts TCP connections on the port. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** Server processes started for this port (uv, uvicorn) that are still alive. */
function survivors(port: number): string {
  try {
    return execFileSync('pgrep', ['-fl', `uvicorn.* --port ${port}`], { encoding: 'utf8' }).trim()
  } catch (error) {
    if ((error as { status?: number }).status === 1) return '' // pgrep: nothing matched
    throw error
  }
}

async function healthy(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok
  } catch {
    return false
  }
}

async function stop(
  child: ChildProcess,
  port: number,
  how: 'SIGTERM' | 'Ctrl-C',
): Promise<number | null> {
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  if (how === 'SIGTERM') child.kill('SIGTERM')
  else process.kill(-(child.pid ?? 0), 'SIGINT') // a terminal's Ctrl-C reaches the whole group
  const code = await exited
  await expect.poll(() => healthy(port), { timeout: 15_000 }).toBe(false)
  await expect.poll(() => listening(port), { timeout: 15_000 }).toBe(false)
  await expect.poll(() => survivors(port), { timeout: 15_000 }).toBe('')
  return code
}

test('data persists across an application restart and the app shuts down cleanly', async ({ page }) => {
  test.setTimeout(120_000)
  const port = 8711
  const before = sql('SELECT count(*) || ":" || group_concat(id) FROM (SELECT id FROM performed_set ORDER BY id)')

  for (const how of ['SIGTERM', 'Ctrl-C'] as const) {
    const child = launch(port)
    await expect.poll(() => healthy(port), { timeout: 60_000 }).toBe(true)
    await page.goto(`http://127.0.0.1:${port}/`)
    await expect(page.getByTestId('recent-workout')).toHaveCount(3)
    await page.getByTestId('recent-workout').filter({ hasText: 'Upper A' }).filter({ hasText: 'Complete' }).getByRole('link').click()
    await expect.poll(() => actualRows(slot(page, 'upper_a.01'))).toEqual([
      ['82.5', '6', '2'],
      ['82.5', '5', '2'],
    ])
    await page.goto('about:blank')
    const code = await stop(child, port, how)
    expect([0, 130, 143, null], `launcher exit code after ${how}`).toContain(code)
    expect(sql('SELECT count(*) || ":" || group_concat(id) FROM (SELECT id FROM performed_set ORDER BY id)')).toBe(before)
  }

  expect(sql('PRAGMA quick_check')).toBe('ok')
  expect(sql('PRAGMA integrity_check')).toBe('ok')
  expect(sql('PRAGMA foreign_key_check')).toBe('')
})

test('a second launcher refuses a port that is already served', async () => {
  test.setTimeout(60_000)
  // The E2E server holds 8710. A second launcher on it (even on another database) must
  // refuse, never report "ready" for the other server or open a browser on it.
  const intruder = launch(8710, `${DB_PATH}.other.db`)
  let output = ''
  intruder.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  intruder.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const code = await new Promise<number | null>((resolve) => intruder.once('exit', resolve))
  expect(code).toBe(3)
  expect(output).toContain('already in use')
  expect(output).not.toContain('==> ready')
  expect(await healthy(8710)).toBe(true)
})
