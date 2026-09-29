import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const rootDir = fileURLToPath(new URL('../..', import.meta.url))
// The API reads PORT from the root .env, so the dev proxy follows it.
const apiTarget = `http://localhost:${loadEnv('development', rootDir, 'PORT').PORT ?? '3000'}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  server: {
    // The API serves the SPA same-origin in production, so the client always
    // calls relative /api paths; the proxy only exists to keep that shape in dev.
    proxy: {
      '/api': apiTarget,
    },
  },
})
