import { defineConfig, devices } from '@playwright/test'

/*
 * The shell specs (*.pwa.spec.ts) need the real build artefacts — the
 * service worker and the manifest exist only in a production build — so
 * they run against vite preview instead of the dev server. Run with:
 *   pnpm --filter @ohana/web test:e2e:pwa
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pwa.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
