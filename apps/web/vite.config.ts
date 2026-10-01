import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const rootDir = fileURLToPath(new URL('../..', import.meta.url))
// The API reads PORT from the root .env, so the dev proxy follows it.
const apiTarget = `http://localhost:${loadEnv('development', rootDir, 'PORT').PORT ?? '3000'}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter(),
    react(),
    tailwindcss(),
    /*
     * The installable shell (issue #11, ADR-0012): the generated service
     * worker precaches the build output, and every navigation — any route,
     * including parameterised ones — falls back to index.html, so the SPA
     * router opens it offline. API responses are never cached; offline
     * data comes only from the local store. The worker waits with the new
     * version until the app's update prompt forwards SKIP_WAITING
     * (registerType 'prompt'); registration itself lives in
     * lib/app-update.ts and runs once per page from the app entry.
     */
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: null,
      /*
       * The manifest carries user-visible Russian strings outside
       * packages/i18n: it is one static document read before any code and
       * the app's default language is Russian.
       */
      manifest: {
        id: '/',
        name: 'Ohana',
        short_name: 'Ohana',
        description: 'Семейный альбом, который всегда с вами',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f1ee',
        theme_color: '#f6f1ee',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The favicon and the icons are precached through this glob; there
        // is no separate includeAssets list to keep in step with it.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      // The worker exists only in real builds: development keeps HMR, and
      // the Playwright dev-server harness stays free of a caching
      // interceptor (the PWA specs run against vite preview instead).
      devOptions: { enabled: false },
    }),
  ],
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
