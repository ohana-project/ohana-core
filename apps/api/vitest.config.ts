import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: './src/testing/globalSetup.ts',
    hookTimeout: 180_000,
    testTimeout: 60_000,
    // The instance administrator is one shared row per run database; the
    // administrative test files re-establish it in their arrange steps, so
    // files must not run against the database at the same time.
    fileParallelism: false,
  },
})
