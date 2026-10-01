import { expect, test } from '@playwright/test'

/*
 * The installable application shell (issue #11, ADR-0012), exercised
 * against the production build: the manifest and its icons are served, the
 * service worker takes control after its first page load, and every route
 * — including parameterised ones — then opens offline from the precache,
 * while API responses never come from the worker.
 */

test('the app is installable: a manifest whose icons exist', async ({ page, request }) => {
  await page.goto('/')

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  const body = await manifest.json()
  expect(body).toMatchObject({
    name: 'Ohana',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  })
  for (const icon of body.icons) {
    expect((await request.get(icon.src)).ok(), `icon ${icon.src} is served`).toBe(true)
  }
  // iOS builds its Home Screen icon from the touch icon, not the manifest.
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true)
})

test('the service worker takes control and every route opens offline', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // The page that registered the worker is not controlled yet; the reload is.
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  await context.setOffline(true)

  // A plain route…
  await page.goto('/design')
  await expect(page.getByRole('heading', { name: 'Дизайн-система Ohana' })).toBeVisible()

  // …and a parameterised one: the worker answers the navigation from the
  // precache and the shell mounts. (What the online-only administrative
  // area then decides about the missing session is not the shell's concern.)
  const parameterised = await page.goto('/admin/spaces/01900000-0000-7000-8000-00000000000a')
  expect(parameterised?.ok()).toBe(true)
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0))
    .toBeGreaterThan(0)

  // The worker never answers for the API: offline, the fetch simply fails
  // instead of returning anything cached.
  const apiFailedOffline = await page.evaluate(() =>
    fetch('/api/health').then(
      () => false,
      () => true,
    ),
  )
  expect(apiFailedOffline).toBe(true)
})

test('offers a reload when a new version waits and reloads on demand', async ({ page }) => {
  const { readFile, writeFile } = await import('node:fs/promises')
  const swUrl = new URL('../dist/sw.js', import.meta.url)

  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  // A new deployment: the worker script changes, so the registration
  // refresh on the next load installs it as a waiting worker. The artefact
  // is restored afterwards — this checkout's dist must stay shippable.
  const deployed = await readFile(swUrl, 'utf8')
  try {
    await writeFile(swUrl, `${deployed}\n// shell.pwa.spec.ts: a new version\n`)

    await page.reload()
    const banner = page.getByRole('status')
    await expect(banner).toContainText('Вышла новая версия Ohana', { timeout: 20_000 })

    // The reload is the member's choice: the current version keeps running
    // until the button, and the reload itself wipes the page state.
    interface ReloadMarker {
      __ohanaBeforeReload?: boolean
    }
    await page.evaluate(() => {
      ;(window as ReloadMarker).__ohanaBeforeReload = true
    })
    await page.getByRole('button', { name: 'Обновить' }).click()

    // Both polls ride out the reload's navigation: an evaluate that lands in
    // the destroyed context mid-reload is retried with a safe placeholder.
    await expect
      .poll(() =>
        page
          .evaluate(() => (window as ReloadMarker).__ohanaBeforeReload ?? false)
          .catch(() => true),
      )
      .toBe(false)
    await expect(banner).not.toBeVisible()
    await expect
      .poll(() =>
        page
          .evaluate(() => navigator.serviceWorker.controller?.state ?? '')
          .catch(() => 'navigating'),
      )
      .toBe('activated')
  } finally {
    await writeFile(swUrl, deployed)
  }
})
