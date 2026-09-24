import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Visual QA only (not part of `npx playwright test`): screenshots every screen at the two
// target desktop viewports against two fresh SCRATCH databases — one empty, one seeded with a
// realistic three-week history by the spec itself through the public API.
//
//   npx playwright test -c playwright.visual.config.ts
//   VISUAL_BROWSER=webkit VISUAL_TAG=<tag>-webkit npx playwright test -c playwright.visual.config.ts
//
// Screenshots land in ../artifacts/visual/<dataset>-<screen>-<width>x<height>.png.

function scratch(prefix: string): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), prefix)), 'fitness_lab.db')
}
process.env.FITNESS_LAB_VISUAL_DB_EMPTY ??= scratch('fitness-lab-visual-empty-')
process.env.FITNESS_LAB_VISUAL_DB_FULL ??= scratch('fitness-lab-visual-full-')

function iso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const now = new Date()
const monday = (weeksAgo: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7 * weeksAgo)
// Empty: the real pre-block situation (the block starts next week). Full: week 3 of 12.
process.env.FITNESS_LAB_VISUAL_BLOCK_EMPTY ??= iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8))
process.env.FITNESS_LAB_VISUAL_BLOCK_FULL ??= iso(monday(2))

const EMPTY_PORT = 8720
const FULL_PORT = 8721

export default defineConfig({
  testDir: './visual',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../artifacts/playwright-visual',
  // VISUAL_BROWSER=webkit renders the same screens in Safari's engine.
  use: { ...devices[process.env.VISUAL_BROWSER === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'] },
  webServer: [
    {
      command: 'bash scripts/serve-scratch.sh',
      env: {
        FITNESS_LAB_DB: process.env.FITNESS_LAB_VISUAL_DB_EMPTY,
        FITNESS_LAB_PORT: String(EMPTY_PORT),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_VISUAL_BLOCK_EMPTY,
      },
      url: `http://127.0.0.1:${EMPTY_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `until curl -sf http://127.0.0.1:${EMPTY_PORT}/api/health >/dev/null; do sleep 1; done; bash scripts/serve-scratch.sh`,
      env: {
        FITNESS_LAB_DB: process.env.FITNESS_LAB_VISUAL_DB_FULL,
        FITNESS_LAB_PORT: String(FULL_PORT),
        FITNESS_LAB_SEED_BLOCK_START: process.env.FITNESS_LAB_VISUAL_BLOCK_FULL,
      },
      url: `http://127.0.0.1:${FULL_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
})
