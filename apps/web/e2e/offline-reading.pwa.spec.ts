import { expect, type Page, test } from '@playwright/test'

/*
 * Reading offline after a sync (issue #14, ADR-0002): a member signs in,
 * the first sync lands, and after the connection goes away the space —
 * its settings, its section visibility, and the members — still opens
 * from the device's local store, with the indicator reporting the offline
 * state. Runs against the production build like the other shell specs:
 * offline, only the service worker can answer the navigation itself.
 *
 * The API is intercepted at the network level; the real cookie and header
 * pairing stays with the API's HTTP tests. IndexedDB and the registry are
 * real.
 */

const ME = '**/api/v1/me'
// The sync request carries ?since=…, so the glob must span the query too.
const SYNC = '**/api/v1/sync*'

const ANYA = '01900000-0000-7000-8000-000000000001'
const MISHA = '01900000-0000-7000-8000-000000000002'
const SPACE_ID = '01900000-0000-7000-8000-00000000000a'

const ME_RESPONSE = {
  member: {
    id: ANYA,
    name: 'Аня',
    displayName: 'Аня Смирнова',
    role: 'owner',
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  space: { id: SPACE_ID, name: 'Наша семья' },
  needsOnboarding: false,
}

const SYNC_RESPONSE = {
  revision: '7',
  changes: [
    {
      entity: 'space',
      space: {
        id: SPACE_ID,
        name: 'Наша семья',
        timezone: 'Europe/Moscow',
        sections: { journal: true, calendar: true, wishlist: true },
      },
    },
    {
      entity: 'member',
      member: {
        id: ANYA,
        name: 'Аня',
        displayName: 'Аня Смирнова',
        role: 'owner',
        createdAt: '2026-08-12T10:00:00.000Z',
      },
    },
    {
      entity: 'member',
      member: {
        id: MISHA,
        name: 'Миша',
        role: 'regular',
        createdAt: '2026-08-14T10:00:00.000Z',
      },
    },
  ],
  tombstones: [],
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

/** Seeds the retained sign-in (the session registry stores no tokens). */
async function seedRegistry(page: Page) {
  await page.addInitScript(
    ([memberId, spaceId]) => {
      window.localStorage.setItem(
        'ohana.sessions',
        JSON.stringify([
          {
            memberId,
            spaceId,
            spaceName: 'Наша семья',
            name: 'Аня',
            displayName: 'Аня Смирнова',
          },
        ]),
      )
      window.localStorage.setItem('ohana.activeMember', memberId as string)
    },
    [ANYA, SPACE_ID],
  )
}

test('the space opens offline from the data the sync brought', async ({ page, context }) => {
  await seedRegistry(page)
  let syncCalls = 0
  await page.route(ME, (route) => route.fulfill(json(200, ME_RESPONSE)))
  await page.route(SYNC, (route) => {
    syncCalls += 1
    return route.fulfill(json(200, SYNC_RESPONSE))
  })

  await page.goto('/')
  // The first sync runs from revision 0 and lands: the home renders the
  // space and its members from the local store.
  await expect(page.getByRole('heading', { name: /Аня Смирнова/ })).toBeVisible()
  await expect(page.getByText('Миша')).toBeVisible()
  await expect(page.locator('[data-slot="sync-status"]').first()).toHaveAttribute(
    'data-state',
    'synced',
  )
  expect(syncCalls).toBeGreaterThan(0)

  // The worker must control the page, or the offline navigation itself
  // would have nobody to answer it.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  await context.setOffline(true)
  await page.reload()

  // The probe cannot reach the API; the retained sign-in reads on from the
  // synchronised partition, and the indicator says the device is offline.
  await expect(page.getByRole('heading', { name: /Аня Смирнова/ })).toBeVisible()
  await expect(page.getByText('Наша семья')).toBeVisible()
  await expect(page.getByText('Миша')).toBeVisible()
  await expect(page.getByText('Свежее в дневнике')).toBeVisible()
  await expect(page.locator('[data-slot="sync-status"]').first()).toHaveAttribute(
    'data-state',
    'offline',
  )
  // Both shells carry the chip; the first wording is enough.
  await expect(page.getByText('Офлайн — изменения сохраняются локально').first()).toBeVisible()
})
