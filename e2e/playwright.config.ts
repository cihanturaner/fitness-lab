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

export const E2E_DB = process.env.FITNESS_LAB_E2E_DB
export const E2E_PORT = Number(process.env.FITNESS_LAB_E2E_PORT)
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`

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
      // Viewport must come after the device spread - project `use` overrides the
      // top-level one, and Desktop Chrome would otherwise force 1280x720.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
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
})
