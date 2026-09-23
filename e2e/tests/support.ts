import { execFileSync } from 'node:child_process'
import { expect, type Page } from '@playwright/test'

function scratch(name: string): string {
  const value = process.env[name] ?? ''
  if (!value || value.endsWith('/data/fitness_lab.db') || value.includes('/data/dev/')) {
    throw new Error(`E2E refuses to run without a scratch database (${name}=${JSON.stringify(value)})`)
  }
  return value
}

export const DB_PATH = scratch('FITNESS_LAB_E2E_DB')
/** The V2 daily-use journey's own scratch database. */
export const DB_PATH_V2 = scratch('FITNESS_LAB_E2E_DB_V2')

/** Query the SQLite file directly, bypassing the app, so assertions check persisted truth. */
export function sql(query: string, dbPath: string = DB_PATH): string {
  // A read can meet a transient lock while the app writes; wait for it like the app does
  // (busy_timeout) instead of failing on SQLITE_BUSY.
  return execFileSync('sqlite3', ['-cmd', '.timeout 5000', dbPath, query], { encoding: 'utf8' }).trim()
}

export function count(table: string, where = '1 = 1'): number {
  return Number(sql(`SELECT count(*) FROM ${table} WHERE ${where}`))
}

/** Fails the test if the page talks to anything but the local app. */
export function auditRequests(page: Page, origins: string[]): () => void {
  const foreign: string[] = []
  const failed: string[] = []
  const consoleErrors: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    const local = origins.some((origin) => origin !== '' && url.startsWith(origin))
    if (!local && !url.startsWith('data:')) foreign.push(url)
  })
  page.on('requestfailed', (request) =>
    failed.push(`${request.url()} ${request.failure()?.errorText ?? ''}`),
  )
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
  return () => {
    expect(foreign, 'requests to anything but the local app').toEqual([])
    expect(failed, 'failed requests').toEqual([])
    expect(consoleErrors, 'browser console errors').toEqual([])
  }
}
