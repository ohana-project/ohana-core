import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: './src/testing/globalSetup.ts',
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
