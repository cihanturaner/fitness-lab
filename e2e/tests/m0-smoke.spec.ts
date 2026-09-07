import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DB_PATH = process.env.FITNESS_LAB_DB ?? path.join(REPO_ROOT, 'data', 'fitness_lab.db')

/** Read the row straight out of the SQLite file, bypassing the app entirely. */
function readRowFromSqliteFile(): { token: string; createdAt: string } {
  const out = execFileSync(
    'sqlite3',
    ['-separator', '~~', DB_PATH, 'SELECT token, created_at FROM m0_technical_check WHERE id = 1'],
    { encoding: 'utf8' },
  ).trim()
  const [token, createdAt] = out.split('~~')
  if (!token || !createdAt) throw new Error(`unexpected sqlite output: ${JSON.stringify(out)}`)
  return { token, createdAt }
}

test('the M0 page renders the FastAPI and SQLite responses end to end', async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) =>
    failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`),
  )

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'fitness-lab' })).toBeVisible()

  // FastAPI health is represented in the UI.
  await expect(page.getByTestId('health-status')).toHaveText('ok')
  await expect(page.getByTestId('health-service')).toHaveText('fitness-lab')
  await expect(page.getByTestId('health-version')).toHaveText(/^\d+\.\d+\.\d+$/)

  // The SQLite-backed response is represented in the UI, and matches the row as it
  // exists in the database file on disk. React -> FastAPI -> SQLite, proven.
  const row = readRowFromSqliteFile()
  await expect(page.getByTestId('db-source')).toHaveText('sqlite')
  await expect(page.getByTestId('db-token')).toHaveText(row.token)
  await expect(page.getByTestId('db-created-at')).toHaveText(row.createdAt)
  await expect(page.getByTestId('db-version')).toHaveText(/^\d+\.\d+\.\d+$/)

  await page.screenshot({ path: '../artifacts/m0-page-1920x1080.png' })

  expect(consoleErrors, 'browser console errors').toEqual([])
  expect(failedRequests, 'failed network requests').toEqual([])
})

test('re-running the checks refetches both endpoints from the live app', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('db-token')).toBeVisible()

  const [health, pingDb] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/health') && r.status() === 200),
    page.waitForResponse((r) => r.url().endsWith('/api/ping-db') && r.status() === 200),
    page.getByRole('button', { name: 'Re-run checks' }).click(),
  ])

  expect(await health.json()).toMatchObject({ status: 'ok', service: 'fitness-lab' })
  expect(await pingDb.json()).toMatchObject({ status: 'ok', source: 'sqlite', row_id: 1 })
})
