import { expect, test } from '@playwright/test'

/*
 * The installable application shell (issue #11, ADR-0012), exercised
 * against the production build: the manifest and its icons are served, the
 * service worker takes control after its first page load, and every route
 * — including parameterised ones — then opens offline from the precache,
 * while API responses never come from the worker.
 */

// The update spec simulates a deployment by rewriting the built worker; if
// the test dies on a timeout, this restores the shippable artefact anyway.
const SW_URL = new URL('../dist/sw.js', import.meta.url)
let pendingRestore: string | null = null

test.afterEach(async () => {
  const { writeFile } = await import('node:fs/promises')
  if (pendingRestore !== null) {
    await writeFile(SW_URL, pendingRestore)
    pendingRestore = null
  }
})

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

  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  // A new deployment: the worker script changes, so the registration
  // refresh on the next load installs it as a waiting worker. The
  // afterEach hook restores the artefact even if this test times out.
  const deployed = await readFile(SW_URL, 'utf8')
  pendingRestore = deployed
  try {
    await writeFile(SW_URL, `${deployed}\n// shell.pwa.spec.ts: a new version\n`)

    await page.reload()
    // Both role=status (sync chip, spinners) and this banner exist; name
    // the banner by its text.
    const banner = page.getByRole('status').filter({ hasText: 'Вышла новая версия Ohana' })
    await expect(banner).toBeVisible({ timeout: 20_000 })

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
    await writeFile(SW_URL, deployed)
    pendingRestore = null
  }
})
