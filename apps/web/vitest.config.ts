import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/testing/setup.ts'],
      // the e2e/ specs run under Playwright, not Vitest
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }),
)
