import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'wishlist-sync-admin-password'
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

interface SyncWish {
  id: string
  authorId: string
  title: string
  details?: string
  link?: string
  receivedAt?: string
}

interface SyncResponse {
  revision: string
  changes: Array<{ entity: string; wish?: SyncWish }>
  tombstones: Array<{ entity: string; entityId: string; audience: string; memberId?: string }>
}

async function sync(app: TestApp, session: MemberSession, since: string): Promise<SyncResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/sync?since=${since}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return response.json()
}

function wishChanges(result: SyncResponse): SyncWish[] {
  return result.changes
    .filter((change) => change.entity === 'wishlist_wish')
    .map((change) => change.wish as SyncWish)
}

async function createWish(
  app: TestApp,
  session: MemberSession,
  body: { title: string; details?: string; link?: string },
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/wishlist/wishes',
    headers: memberHeaders(session),
    payload: body,
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

async function markReceived(app: TestApp, session: MemberSession, wishId: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/received`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
}

async function removeWish(app: TestApp, session: MemberSession, wishId: string): Promise<void> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(204)
}

describe('the wishlist sync contributor (issues #14 and #18)', () => {
  test('every wish reaches every member, and the received mark travels', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, anna, {
        title: 'Налобный фонарь',
        link: 'https://example.com/lamp',
      })

      // From revision 0 both members carry Аня's wish — a wishlist is
      // visible to the other members of the space (CONTEXT.md).
      for (const session of [anna, dima]) {
        const result = await sync(app, session, '0')
        const wishes = wishChanges(result)
        expect(wishes).toHaveLength(1)
        expect(wishes[0]).toMatchObject({
          id: lamp.id,
          title: 'Налобный фонарь',
          authorId: anna.memberId,
        })
        expect(wishes[0]?.receivedAt).toBeUndefined()
      }

      const cursor = (await sync(app, dima, '0')).revision

      // The author's mark rides the delta to the other members.
      await markReceived(app, anna, lamp.id)

      const delta = await sync(app, dima, cursor)
      const wishes = wishChanges(delta)
      expect(wishes).toHaveLength(1)
      expect(wishes[0]).toMatchObject({ id: lamp.id })
      expect(wishes[0]?.receivedAt).toEqual(expect.any(String))
    })
  })

  test('a removal reaches the other devices as a tombstone for everyone', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const wish = await createWish(app, anna, { title: 'Термос' })
      const seen = await sync(app, dima, '0')
      expect(wishChanges(seen)).toHaveLength(1)
      const cursor = seen.revision

      await removeWish(app, anna, wish.id)

      const delta = await sync(app, dima, cursor)
      expect(wishChanges(delta)).toEqual([])
      expect(delta.tombstones).toEqual([
        {
          entity: 'wishlist_wish',
          entityId: wish.id,
          audience: 'all',
        },
      ])

      // A fresh device syncing from 0 gets neither the row (it is gone)
      // nor a stale delivery: the tombstone answers alone.
      const fresh = await sync(app, dima, '0')
      expect(wishChanges(fresh)).toEqual([])
      expect(fresh.tombstones.map((tombstone) => tombstone.entityId)).toContain(wish.id)
    })
  })

  test('wishes of another space never appear', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      await createWish(app, stranger, { title: 'Чужое желание' })

      const result = await sync(app, anna, '0')
      expect(wishChanges(result)).toEqual([])
    })
  })

  test('a hidden wishlist contributes nothing, and a re-shown one resyncs from 0', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const wish = await createWish(app, dima, { title: 'До скрытия' })
      const before = await sync(app, dima, '0')
      expect(wishChanges(before)).toHaveLength(1)

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { wishlist: false } },
      })
      expect(hide.statusCode).toBe(200)

      // From the pre-hide cursor the delta carries the new sections map and
      // no wishlist rows: the client drops the section's rows when it
      // applies the map (ADR-0011, ADR-0014).
      const delta = await sync(app, dima, before.revision)
      expect(wishChanges(delta)).toEqual([])
      const spaceChange = delta.changes.find((change) => change.entity === 'space')
      expect(spaceChange).toMatchObject({
        space: { sections: { journal: true, calendar: true, wishlist: false } },
      })

      const show = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { wishlist: true } },
      })
      expect(show.statusCode).toBe(200)

      // The client that saw the re-show discards its cursor and syncs from
      // revision 0 once: the section's full data comes back.
      const resync = await sync(app, dima, '0')
      expect(wishChanges(resync).map((row) => row.id)).toEqual([wish.id])
    })
  })
})
