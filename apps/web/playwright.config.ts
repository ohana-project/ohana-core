import { defineConfig, devices } from '@playwright/test'

/*
 * E2E specs run against the /design preview route. The dev server is
 * booted by Playwright itself; CI always starts fresh, locally an
 * already-running server is reused.
 */
export default defineConfig({
  testDir: './e2e',
  // The shell specs (*.pwa.spec.ts) run against a production build through
  // playwright.pwa.config.ts, not against this dev server.
  testIgnore: '**/*.pwa.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
