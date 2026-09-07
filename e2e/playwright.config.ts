import { defineConfig, devices } from '@playwright/test'

const BASE_URL = 'http://127.0.0.1:8000'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
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
    // The real production launcher: build if stale, serve the build through FastAPI.
    command: 'bash ../scripts/start.sh --no-open',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
