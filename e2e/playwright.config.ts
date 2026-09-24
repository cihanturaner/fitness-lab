import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// End-to-end runs ALWAYS use a fresh scratch database and a dedicated port. FITNESS_LAB_DB is
// deliberately ignored here, and an already-running server is never reused, so a test run can
// never attach to the app serving the canonical database. The config is evaluated again in
// each worker, so the scratch path is created once and handed down through the environment.
process.env.FITNESS_LAB_E2E_DB ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT ??= '8710'
// The V2 daily-use journey runs against its own fresh scratch database and server, so it
// neither depends on nor disturbs the V1 journey's step-by-step database assertions.
process.env.FITNESS_LAB_E2E_DB_V2 ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-v2-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT_V2 ??= '8712'
// The V3 completeness journey: its own scratch database, block started three Mondays ago, so
// week 3 has just finished and the first routine nutrition decision is due.
process.env.FITNESS_LAB_E2E_DB_V3 ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-v3-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT_V3 ??= '8713'
// The V3.1 journey (pound loads, macro-derived calories, reduced motion): its own scratch
// database, block started two Mondays ago.
process.env.FITNESS_LAB_E2E_DB_V31 ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-v31-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT_V31 ??= '8714'
// The V3.2 journey (Home / Training split, set entry without a set type, perceptible motion):
// its own scratch database, block started two Mondays ago.
process.env.FITNESS_LAB_E2E_DB_V32 ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-v32-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT_V32 ??= '8715'
// The V3.3 daily-use journey (change an exercise for one workout, discard drafts, macro
// targets with history, day-by-day History, Turkish program rules): its own scratch database,
// block started two Mondays ago.
process.env.FITNESS_LAB_E2E_DB_V33 ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-v33-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT_V33 ??= '8716'
// The V3.3.1 journey (a typed exercise for one workout, two slots of one exercise kept apart,
// targets as a setting, Settings > Program in Turkish, day-only History): its own scratch
// database, block started two Mondays ago (block week 2: the source's weeks 1-2 rule applies).
process.env.FITNESS_LAB_E2E_DB_V331 ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'fitness-lab-e2e-v331-')),
  'fitness_lab.db',
)
process.env.FITNESS_LAB_E2E_PORT_V331 ??= '8717'

/** Monday of the local week `weeksAgo` weeks ago. */
function blockStart(weeksAgo: number): string {
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7 * weeksAgo)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}
// V2: today falls in week 3 of the block. V3: weeks 1-3 are finished, today is in week 4.
process.env.FITNESS_LAB_E2E_BLOCK_START ??= blockStart(2)
process.env.FITNESS_LAB_E2E_BLOCK_START_V3 ??= blockStart(3)

export const E2E_DB = process.env.FITNESS_LAB_E2E_DB
export const E2E_PORT = Number(process.env.FITNESS_LAB_E2E_PORT)
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`
const E2E_DB_V2 = process.env.FITNESS_LAB_E2E_DB_V2
const BASE_URL_V2 = `http://127.0.0.1:${process.env.FITNESS_LAB_E2E_PORT_V2}`
const E2E_DB_V3 = process.env.FITNESS_LAB_E2E_DB_V3
const BASE_URL_V3 = `http://127.0.0.1:${process.env.FITNESS_LAB_E2E_PORT_V3}`
const E2E_DB_V31 = process.env.FITNESS_LAB_E2E_DB_V31
const BASE_URL_V31 = `http://127.0.0.1:${process.env.FITNESS_LAB_E2E_PORT_V31}`
const E2E_DB_V32 = process.env.FITNESS_LAB_E2E_DB_V32
const BASE_URL_V32 = `http://127.0.0.1:${process.env.FITNESS_LAB_E2E_PORT_V32}`
const E2E_DB_V33 = process.env.FITNESS_LAB_E2E_DB_V33
const BASE_URL_V33 = `http://127.0.0.1:${process.env.FITNESS_LAB_E2E_PORT_V33}`
const E2E_DB_V331 = process.env.FITNESS_LAB_E2E_DB_V331
const BASE_URL_V331 = `http://127.0.0.1:${process.env.FITNESS_LAB_E2E_PORT_V331}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: '../artifacts/playwright',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /v(2|3|31|32|33|331)-.*\.spec\.ts/,
      // Viewport must come after the device spread - project `use` overrides the
      // top-level one, and Desktop Chrome would otherwise force 1280x720.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: 'v2-daily-use',
      testMatch: /v2-.*\.spec\.ts/,
      // A common Mac laptop viewport: the compact layout must work here, not only at 1920.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: BASE_URL_V2 },
    },
    {
      name: 'v3-completeness',
      testMatch: /v3-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: BASE_URL_V3 },
    },
    {
      name: 'v31-units-motion',
      testMatch: /v31-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: BASE_URL_V31 },
    },
    {
      name: 'v32-simplification',
      testMatch: /v32-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: BASE_URL_V32 },
    },
    {
      name: 'v33-daily-use',
      testMatch: /v33-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: BASE_URL_V33 },
    },
    {
      name: 'v331-patch',
      testMatch: /v331-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: BASE_URL_V331 },
    },
  ],
  webServer: [
    {
      // Seeds the scratch database with the locked program, then runs the real production
      // launcher: build if stale, serve the build through FastAPI.
      command: 'bash scripts/serve-scratch.sh',
      env: { FITNESS_LAB_DB: E2E_DB, FITNESS_LAB_PORT: String(E2E_PORT) },
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Waits for the first server (which builds the frontend if stale) so two launchers
      // never build web/dist at the same time.
      command: `until curl -sf ${BASE_URL}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: E2E_DB_V2,
        FITNESS_LAB_PORT: String(process.env.FITNESS_LAB_E2E_PORT_V2),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_E2E_BLOCK_START,
      },
      url: `${BASE_URL_V2}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `until curl -sf ${BASE_URL}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: E2E_DB_V3,
        FITNESS_LAB_PORT: String(process.env.FITNESS_LAB_E2E_PORT_V3),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_E2E_BLOCK_START_V3,
      },
      url: `${BASE_URL_V3}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `until curl -sf ${BASE_URL}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: E2E_DB_V31,
        FITNESS_LAB_PORT: String(process.env.FITNESS_LAB_E2E_PORT_V31),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_E2E_BLOCK_START,
      },
      url: `${BASE_URL_V31}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `until curl -sf ${BASE_URL}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: E2E_DB_V32,
        FITNESS_LAB_PORT: String(process.env.FITNESS_LAB_E2E_PORT_V32),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_E2E_BLOCK_START,
      },
      url: `${BASE_URL_V32}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `until curl -sf ${BASE_URL}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: E2E_DB_V33,
        FITNESS_LAB_PORT: String(process.env.FITNESS_LAB_E2E_PORT_V33),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_E2E_BLOCK_START,
      },
      url: `${BASE_URL_V33}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `until curl -sf ${BASE_URL}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: E2E_DB_V331,
        FITNESS_LAB_PORT: String(process.env.FITNESS_LAB_E2E_PORT_V331),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_E2E_BLOCK_START,
      },
      url: `${BASE_URL_V331}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
