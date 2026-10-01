import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'

describe('SPA static files', () => {
  let harness: TestHarness
  let webDist: string

  beforeAll(async () => {
    harness = await createTestHarness()
    webDist = await mkdtemp(join(tmpdir(), 'ohana-web-'))
    await mkdir(join(webDist, 'assets'), { recursive: true })
    await mkdir(join(webDist, 'icons'), { recursive: true })
    await writeFile(join(webDist, 'index.html'), '<!doctype html><title>Ohana</title>')
    await writeFile(join(webDist, 'assets', 'app-C1234.js'), 'console.log("app")')
    await writeFile(join(webDist, 'sw.js'), '// the service worker')
    await writeFile(
      join(webDist, 'manifest.webmanifest'),
      JSON.stringify({ name: 'Ohana', display: 'standalone' }),
    )
    await writeFile(join(webDist, 'icons', 'pwa-192.png'), 'png-bytes')
  })

  afterAll(async () => {
    await rm(webDist, { recursive: true, force: true })
    await harness.close()
  })

  async function buildAppWithWebDist() {
    const app = harness.buildTestApp({ webDist })
    await app.ready()
    return app
  }

  test('serves index.html at the root', async () => {
    const app = await buildAppWithWebDist()
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('<!doctype html>')
    } finally {
      await app.close()
    }
  })

  test('serves built assets with immutable caching', async () => {
    const app = await buildAppWithWebDist()
    try {
      const response = await app.inject({ method: 'GET', url: '/assets/app-C1234.js' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('javascript')
      expect(response.headers['cache-control']).toContain('immutable')
      expect(response.body).toBe('console.log("app")')
    } finally {
      await app.close()
    }
  })

  test('serves the PWA artefacts the browser needs to install the app', async () => {
    const app = await buildAppWithWebDist()
    try {
      // The service worker script must revalidate on every update check,
      // or a deployed update stays undetected for the cache's lifetime.
      const worker = await app.inject({ method: 'GET', url: '/sw.js' })
      expect(worker.statusCode).toBe(200)
      expect(worker.headers['content-type']).toContain('javascript')
      expect(worker.headers['cache-control']).toBe('no-cache')

      const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' })
      expect(manifest.statusCode).toBe(200)
      expect(manifest.headers['content-type']).toContain('json')
      expect(manifest.json().display).toBe('standalone')

      const icon = await app.inject({ method: 'GET', url: '/icons/pwa-192.png' })
      expect(icon.statusCode).toBe(200)
      expect(icon.headers['content-type']).toContain('png')
    } finally {
      await app.close()
    }
  })

  test('falls back to index.html for client-side routes', async () => {
    const app = await buildAppWithWebDist()
    try {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await app.inject({ method, url: '/journal/new-entry' })
        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toContain('text/html')
        if (method === 'GET') {
          expect(response.body).toContain('<!doctype html>')
        }
      }
    } finally {
      await app.close()
    }
  })

  test('answers 404 JSON for dotted paths even when HTML is accepted', async () => {
    const app = await buildAppWithWebDist()
    try {
      for (const url of ['/assets/missing-C1234.js', '/journal/v1.2']) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { accept: 'text/html' },
        })
        expect(response.statusCode).toBe(404)
        expect(response.json().error.code).toBe('not_found')
      }
    } finally {
      await app.close()
    }
  })

  test('answers 404 JSON for unknown API routes instead of the SPA', async () => {
    const app = await buildAppWithWebDist()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/nope',
        headers: { accept: 'text/html' },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('not_found')
    } finally {
      await app.close()
    }
  })

  test('serves no files when no web distribution is configured', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('not_found')
    } finally {
      await app.close()
    }
  })
})
