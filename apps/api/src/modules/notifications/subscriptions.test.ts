import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { pushSubscriptions } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'notifications-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

/*
 * The administrator is a singleton, so each file that signs in re-establishes
 * it in its arrange step; test files run one at a time (vitest.config.ts).
 */
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await ensureInitialAdministrator(harness, ADMIN_PASSWORD)

type TestApp = ReturnType<TestHarness['buildTestApp']>

async function withApp(body: (app: TestApp) => Promise<void>) {
  const app = harness.buildTestApp()
  await app.ready()
  try {
    await body(app)
  } finally {
    await app.close()
  }
}

async function signInAdmin(app: TestApp): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    payload: { password: ADMIN_PASSWORD },
    headers: MARKER,
  })
  expect(response.statusCode).toBe(204)
  const cookie = response.cookies.find((candidate) => candidate.name === ADMIN_SESSION_COOKIE)
  if (cookie === undefined) throw new Error('Sign-in set no administrative session cookie')
  return `${ADMIN_SESSION_COOKIE}=${cookie.value}`
}

interface MemberSession {
  memberId: string
  cookie: string
}

/** Provisions a member and signs them in through redemption. */
async function memberSession(
  app: TestApp,
  adminCookie: string,
  spaceId: string,
  name: string,
  role: 'owner' | 'regular' = 'regular',
): Promise<MemberSession> {
  const provision = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members`,
    payload: { name, role },
    headers: { cookie: adminCookie, ...MARKER },
  })
  expect(provision.statusCode).toBe(201)
  const member = provision.json() as { id: string }
  const issue = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members/${member.id}/access-codes`,
    headers: { cookie: adminCookie, ...MARKER },
  })
  expect(issue.statusCode).toBe(201)
  const { code } = issue.json() as { code: string }

  const redeem = await app.inject({
    method: 'POST',
    url: '/api/v1/access-codes/redeem',
    payload: { code },
  })
  expect(redeem.statusCode).toBe(200)
  const cookie = redeem.cookies.find((candidate) =>
    candidate.name.startsWith('ohana_member_session_'),
  )
  if (cookie === undefined) throw new Error('Redemption produced no session cookie')
  return {
    memberId: cookie.name.slice('ohana_member_session_'.length),
    cookie: `${cookie.name}=${cookie.value}`,
  }
}

function memberHeaders(session: MemberSession) {
  return { 'x-ohana-member': session.memberId, cookie: session.cookie }
}

const PHONE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/endpoint/phone'
const TABLET_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/endpoint/tablet'

async function rowsForMember(memberId: string) {
  return harness.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.memberId, memberId))
}

describe('GET /api/v1/notifications/push/public-key', () => {
  test('requires the member session', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id)
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/push/public-key',
        headers: { 'x-ohana-member': member.id },
      })
      expect(response.statusCode).toBe(401)
    })
  })

  test('answers the persisted pair, the same on every ask', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      const first = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/push/public-key',
        headers: memberHeaders(anya),
      })
      expect(first.statusCode).toBe(200)
      const { publicKey } = first.json() as { publicKey: string }
      expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/)

      // The keys are generated on first start and persisted: a second ask —
      // the next device, the next day — meets the same identity.
      const second = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/push/public-key',
        headers: memberHeaders(anya),
      })
      expect((second.json() as { publicKey: string }).publicKey).toBe(publicKey)
    })
  })
})

describe('PUT /api/v1/notifications/push/subscription', () => {
  test('stores the device subscription after the member action', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-phone', auth: 'auth-phone' },
          notifyDetails: false,
        },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(204)
      const rows = await rowsForMember(anya.memberId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        spaceId: space.id,
        endpoint: PHONE_ENDPOINT,
        p256dh: 'p256dh-phone',
        auth: 'auth-phone',
        notifyDetails: false,
      })
    })
  })

  test('a re-subscription of the same device replaces the credentials, never a second row', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      for (const notifyDetails of [false, true]) {
        const response = await app.inject({
          method: 'PUT',
          url: '/api/v1/notifications/push/subscription',
          payload: {
            endpoint: PHONE_ENDPOINT,
            keys: { p256dh: `p256dh-${notifyDetails}`, auth: 'auth-phone' },
            notifyDetails,
          },
          headers: memberHeaders(anya),
        })
        expect(response.statusCode).toBe(204)
      }
      const rows = await rowsForMember(anya.memberId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ p256dh: 'p256dh-true', notifyDetails: true })
    })
  })

  test('two devices of one member each carry their own opt-in to details', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      const phone = await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-phone', auth: 'auth-phone' },
          notifyDetails: true,
        },
        headers: memberHeaders(anya),
      })
      const tablet = await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: TABLET_ENDPOINT,
          keys: { p256dh: 'p256dh-tablet', auth: 'auth-tablet' },
          notifyDetails: false,
        },
        headers: memberHeaders(anya),
      })
      expect(phone.statusCode).toBe(204)
      expect(tablet.statusCode).toBe(204)
      const rows = await rowsForMember(anya.memberId)
      expect(
        rows.map((row) => ({ endpoint: row.endpoint, notifyDetails: row.notifyDetails })),
      ).toEqual([
        { endpoint: PHONE_ENDPOINT, notifyDetails: true },
        { endpoint: TABLET_ENDPOINT, notifyDetails: false },
      ])
    })
  })

  test('a member of another space keeps their own subscriptions apart', async () => {
    const ours = await harness.createSpace()
    const theirs = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, ours.id, 'Аня')
      // The same browser (the same endpoint) signed in as a member of the
      // other space: their subscription is that member's own row.
      const boris = await memberSession(app, adminCookie, theirs.id, 'Борис')
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-boris', auth: 'auth-boris' },
          notifyDetails: false,
        },
        headers: memberHeaders(boris),
      })
      expect(response.statusCode).toBe(204)
      const anyaRows = await rowsForMember(anya.memberId)
      const borisRows = await rowsForMember(boris.memberId)
      expect(anyaRows).toHaveLength(0)
      expect(borisRows).toHaveLength(1)
      expect(borisRows[0]?.spaceId).toBe(theirs.id)
    })
  })

  test('refuses a payload without the keys', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: { endpoint: PHONE_ENDPOINT, notifyDetails: true },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('validation_failed')
    })
  })
})

describe('PATCH /api/v1/notifications/push/subscription', () => {
  test('flips the device opt-in to event details', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-phone', auth: 'auth-phone' },
          notifyDetails: false,
        },
        headers: memberHeaders(anya),
      })
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/push/subscription',
        payload: { endpoint: PHONE_ENDPOINT, notifyDetails: true },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(204)
      const rows = await rowsForMember(anya.memberId)
      expect(rows[0]?.notifyDetails).toBe(true)
    })
  })

  test('answers 404 for an endpoint that is not this member’s subscription', async () => {
    const ours = await harness.createSpace()
    const theirs = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, ours.id, 'Аня')
      const boris = await memberSession(app, adminCookie, theirs.id, 'Борис')
      await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-boris', auth: 'auth-boris' },
          notifyDetails: false,
        },
        headers: memberHeaders(boris),
      })
      // Anya cannot flip the switch on Boris's device — and cannot learn it
      // exists beyond the 404 any invisible resource answers with.
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/push/subscription',
        payload: { endpoint: PHONE_ENDPOINT, notifyDetails: true },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('push_subscription_not_found')
    })
  })
})

describe('DELETE /api/v1/notifications/push/subscription', () => {
  test('removes the device and is quiet about an already-gone one', async () => {
    const space = await harness.createSpace()
    // A fresh endpoint: the release answer counts the installation's rows,
    // and other tests' subscriptions must not speak for this one.
    const endpoint = 'https://fcm.googleapis.com/fcm/send/endpoint/quiet'
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint,
          keys: { p256dh: 'p256dh-phone', auth: 'auth-phone' },
          notifyDetails: false,
        },
        headers: memberHeaders(anya),
      })
      const first = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notifications/push/subscription',
        payload: { endpoint },
        headers: memberHeaders(anya),
      })
      expect(first.statusCode).toBe(200)
      // Nobody holds the browser subscription any more: the page may call
      // the browser's own unsubscribe.
      expect(first.json()).toEqual({ releaseBrowserSubscription: true })
      expect(await rowsForMember(anya.memberId)).toHaveLength(0)
      const second = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notifications/push/subscription',
        payload: { endpoint },
        headers: memberHeaders(anya),
      })
      expect(second.statusCode).toBe(200)
      // The endpoint is gone; an absence says nothing about who else
      // holds it, so the answer is false — the client has unsubscribed
      // already anyway.
      expect(second.json()).toEqual({ releaseBrowserSubscription: false })
    })
  })

  test('another member’s device is not theirs to delete', async () => {
    const ours = await harness.createSpace()
    const theirs = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, ours.id, 'Аня')
      const boris = await memberSession(app, adminCookie, theirs.id, 'Борис')
      await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-boris', auth: 'auth-boris' },
          notifyDetails: false,
        },
        headers: memberHeaders(boris),
      })
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/notifications/push/subscription',
        payload: { endpoint: PHONE_ENDPOINT },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(200)
      // Boris still holds the browser subscription: the page must not
      // unsubscribe it out from under him.
      expect(response.json()).toEqual({ releaseBrowserSubscription: false })
      // Quietly refused: Boris's subscription is untouched.
      expect(await rowsForMember(boris.memberId)).toHaveLength(1)
    })
  })
})

describe('GET /api/v1/notifications/push/subscription', () => {
  test('answers the member’s own row, and a stranger’s endpoint stays invisible', async () => {
    const ours = await harness.createSpace()
    const theirs = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, ours.id, 'Аня')
      const boris = await memberSession(app, adminCookie, theirs.id, 'Борис')
      await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: PHONE_ENDPOINT,
          keys: { p256dh: 'p256dh-anya', auth: 'auth-anya' },
          notifyDetails: true,
        },
        headers: memberHeaders(anya),
      })

      const own = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications/push/subscription?endpoint=${encodeURIComponent(PHONE_ENDPOINT)}`,
        headers: memberHeaders(anya),
      })
      expect(own.statusCode).toBe(200)
      expect(own.json()).toEqual({ notifyDetails: true })

      // Boris's browser may hold the same physical subscription; his own
      // row is absent, and Anya's is not his to read.
      const stranger = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications/push/subscription?endpoint=${encodeURIComponent(PHONE_ENDPOINT)}`,
        headers: memberHeaders(boris),
      })
      expect(stranger.statusCode).toBe(404)
      expect(stranger.json().error.code).toBe('push_subscription_not_found')
    })
  })
})

describe('endpoint validation', () => {
  test('a non-https endpoint is refused', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/subscription',
        payload: {
          endpoint: 'http://push.example/endpoint',
          keys: { p256dh: 'p256dh', auth: 'auth' },
          notifyDetails: false,
        },
        headers: memberHeaders(anya),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('validation_failed')
      expect(await rowsForMember(anya.memberId)).toHaveLength(0)
    })
  })

  test('only the public push services are accepted — a reminder must not probe the network', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anya = await memberSession(app, adminCookie, space.id, 'Аня')
      for (const endpoint of [
        'https://192.168.1.1/fcm/send/1',
        'https://localhost/fcm/send/1',
        'https://localhost./fcm/send/1',
        'https://nas.local:5001/push',
        'https://127.0.0.1.nip.io/fcm/send/1',
        'https://evil.example/fcm/send/1',
        'https://fcm.googleapis.com:8443/fcm/send/1',
      ]) {
        const response = await app.inject({
          method: 'PUT',
          url: '/api/v1/notifications/push/subscription',
          payload: {
            endpoint,
            keys: { p256dh: 'p256dh', auth: 'auth' },
            notifyDetails: false,
          },
          headers: memberHeaders(anya),
        })
        expect(response.statusCode).toBe(400)
        expect(response.json().error.code).toBe('invalid_push_endpoint')
      }
      expect(await rowsForMember(anya.memberId)).toHaveLength(0)
      // The real services pass, a trailing root dot and a sharded
      // Windows host included.
      for (const endpoint of [
        'https://fcm.googleapis.com/fcm/send/1',
        'https://fcm.googleapis.com./fcm/send/4',
        'https://web.push.apple.com/2',
        'https://updates.push.services.mozilla.com/wpush/v2/3',
        'https://wns2-bn3p.notify.windows.com/w/?token=3',
      ]) {
        const response = await app.inject({
          method: 'PUT',
          url: '/api/v1/notifications/push/subscription',
          payload: {
            endpoint,
            keys: { p256dh: 'p256dh', auth: 'auth' },
            notifyDetails: false,
          },
          headers: memberHeaders(anya),
        })
        expect(response.statusCode).toBe(204)
      }
      expect((await rowsForMember(anya.memberId)).map((row) => row.endpoint)).toEqual([
        'https://fcm.googleapis.com/fcm/send/1',
        'https://fcm.googleapis.com./fcm/send/4',
        'https://web.push.apple.com/2',
        'https://updates.push.services.mozilla.com/wpush/v2/3',
        'https://wns2-bn3p.notify.windows.com/w/?token=3',
      ])
    })
  })
})
