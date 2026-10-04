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

// The photo cache's name is one constant for the build and the runtime
// (the sign-out deletes it) — see src/lib/photo-cache.ts.
import { JOURNAL_PHOTO_CACHE } from './src/lib/photo-cache.ts'

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
        // #f6f1ee is THEME_COLOR.light of src/app/theme.tsx in hex; kept
        // literal so the config does not load a React module, and pinned
        // by src/app/pre-paint.test.ts. The browser chrome follows an
        // explicit theme choice at runtime through the theme-color metas;
        // the manifest does not.
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
        // The push half (issue #22): the generated worker imports the
        // public script that shows the reminders and opens the app on a
        // tap; the text itself is composed server-side (ADR-0006).
        importScripts: ['/push-handler.js'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        /*
         * The photo derivatives are the one API response the worker caches
         * (issue #17, ADR-0002): the feed and viewer images a member has
         * seen are kept for offline reading, keyed by their immutable ids.
         * The original is deliberately absent from the pattern — it is
         * never cached and never fetched in bulk; the API responses proper
         * stay out of the cache, offline data comes only from the local
         * store.
         */
        runtimeCaching: [
          {
            urlPattern:
              /\/api\/v1\/journal\/entries\/[0-9a-f-]+\/images\/[0-9a-f-]+\/variants\/(feed|full)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: JOURNAL_PHOTO_CACHE,
              expiration: { maxEntries: 600, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
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
