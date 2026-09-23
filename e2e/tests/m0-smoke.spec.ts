import { expect, test } from '@playwright/test'
import { auditRequests, sql } from './support'

test('the page is served by FastAPI and backed by the SQLite file', async ({ page, request, baseURL }) => {
  const audit = auditRequests(page, [baseURL ?? ''])
  await page.goto('/')

  await expect(page.getByTestId('health-status')).toHaveText('ok')
  await expect(page.getByTestId('health-version')).toHaveText(/^\d+\.\d+\.\d+$/)
  await expect(page.getByTestId('db-source')).toHaveText('sqlite')
  await expect(page.getByTestId('db-version')).toHaveText(/^\d+\.\d+\.\d+$/)

  // React -> FastAPI -> SQLite: the API serves exactly the row stored in the file.
  const ping = await (await request.get('/api/ping-db')).json()
  expect(ping.token).toBe(sql('SELECT token FROM m0_technical_check WHERE id = 1'))

  await page.screenshot({ path: '../artifacts/m2-home-1920x1080.png' })
  audit()
})
