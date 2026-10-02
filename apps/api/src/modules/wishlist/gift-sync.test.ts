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

const ADMIN_PASSWORD = 'wishlist-gift-sync-admin-password'
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

interface SyncResponse {
  revision: string
  changes: Array<{ entity: string }>
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

function favoritesOf(result: SyncResponse): Array<{ id: string; wishId: string }> {
  return result.changes
    .filter((change) => change.entity === 'wishlist_gift_favorite')
    .map((change) => (change as { favorite: { id: string; wishId: string } }).favorite)
}

function reservationsOf(
  result: SyncResponse,
): Array<{ id: string; wishId: string; memberId: string }> {
  return result.changes
    .filter((change) => change.entity === 'wishlist_gift_reservation')
    .map((change) => (change as { reservation: { id: string; wishId: string; memberId: string } })
      .reservation)
}

async function createWish(
  app: TestApp,
  session: MemberSession,
  title: string,
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/wishlist/wishes',
    headers: memberHeaders(session),
    payload: { title },
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

async function favorite(app: TestApp, session: MemberSession, wishId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/favorite`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(201)
  return (response.json() as { id: string }).id
}

async function unfavorite(app: TestApp, session: MemberSession, wishId: string): Promise<void> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}/favorite`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(204)
}

async function reserve(app: TestApp, session: MemberSession, wishId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/reservation`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(201)
  return (response.json() as { id: string }).id
}

async function cancelReservation(
  app: TestApp,
  session: MemberSession,
  wishId: string,
): Promise<void> {
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/wishlist/wishes/${wishId}/reservation`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(204)
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

async function hideWishlist(app: TestApp, owner: MemberSession, visible: boolean): Promise<void> {
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/space',
    headers: memberHeaders(owner),
    payload: { sections: { wishlist: visible } },
  })
  expect(response.statusCode).toBe(200)
}

describe('the gift favorites and reservations in sync (issue #19)', () => {
  test('a favorite travels to the member who made it alone', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const lamp = await createWish(app, dima, 'Налобный фонарь')
      const bookmark = await favorite(app, anna, lamp.id)

      // Аня's devices carry her bookmark; nobody else's does (issue #19) —
      // not Дима, whose wish it is, and not Люда, another member.
      const annas = await sync(app, anna, '0')
      expect(favoritesOf(annas).map((row) => row.id)).toEqual([bookmark])

      for (const member of [dima, lyuda]) {
        const others = await sync(app, member, '0')
        expect(favoritesOf(others)).toEqual([])
      }

      // A fresh delta repeats the rule: nothing of Аня's bookmark rides to
      // the other members after the cursor either.
      const cursor = (await sync(app, dima, '0')).revision
      const annaCursor = (await sync(app, anna, '0')).revision
      await unfavorite(app, anna, lamp.id)
      const delta = await sync(app, dima, cursor)
      expect(favoritesOf(delta)).toEqual([])
      // And the tombstone of the removal names Аня, nobody else.
      expect(delta.tombstones.filter((row) => row.entity === 'wishlist_gift_favorite')).toEqual([])
      const annasDelta = await sync(app, anna, annaCursor)
      expect(
        annasDelta.tombstones.filter(
          (row) => row.entity === 'wishlist_gift_favorite' && row.entityId === bookmark,
        ),
      ).toEqual([
        {
          entity: 'wishlist_gift_favorite',
          entityId: bookmark,
          audience: 'member',
          memberId: anna.memberId,
        },
      ])
    })
  })

  test('a reservation reaches every member except the wish’s author, its ending included', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const lamp = await createWish(app, lyuda, 'Налобный фонарь')
      const held = await reserve(app, anna, lamp.id)

      // Аня and Дима receive the reservation, with who reserved (issue #19).
      for (const member of [anna, dima]) {
        const result = await sync(app, member, '0')
        expect(reservationsOf(result)).toEqual([
          expect.objectContaining({
            id: held,
            wishId: lamp.id,
            memberId: anna.memberId,
          }),
        ])
      }

      // The author's sync carries no reservation upsert — and no tombstone
      // of it either, when it ends: the author never learns a reservation
      // existed, not even that one ended (issue #19, ADR-0001).
      const dimaCursor = (await sync(app, dima, '0')).revision
      const lyudaCursor = (await sync(app, lyuda, '0')).revision
      await cancelReservation(app, anna, lamp.id)

      const dimaDelta = await sync(app, dima, dimaCursor)
      expect(reservationsOf(dimaDelta)).toEqual([])
      expect(dimaDelta.tombstones).toEqual([
        {
          entity: 'wishlist_gift_reservation',
          entityId: held,
          audience: 'member',
          memberId: dima.memberId,
        },
      ])

      const lyudaDelta = await sync(app, lyuda, lyudaCursor)
      expect(reservationsOf(lyudaDelta)).toEqual([])
      expect(lyudaDelta.tombstones).toEqual([])
    })
  })

  test('marking a wish received or removing it ends its reservation in every member’s delta', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const lamp = await createWish(app, dima, 'Налобный фонарь')
      const held = await reserve(app, anna, lamp.id)
      const annaCursor = (await sync(app, anna, '0')).revision
      const dimaCursor = (await sync(app, dima, '0')).revision

      await markReceived(app, dima, lamp.id)

      // The wish's received mark travels to everyone, the reservation's
      // ending to every member but the author.
      const annaDelta = await sync(app, anna, annaCursor)
      expect(reservationsOf(annaDelta)).toEqual([])
      expect(annaDelta.tombstones).toEqual([
        {
          entity: 'wishlist_gift_reservation',
          entityId: held,
          audience: 'member',
          memberId: anna.memberId,
        },
      ])
      const dimaDelta = await sync(app, dima, dimaCursor)
      expect(reservationsOf(dimaDelta)).toEqual([])
      expect(dimaDelta.tombstones.filter((row) => row.entity === 'wishlist_gift_reservation')).toEqual([])

      // The removal takes the wish's favorites with it, tombstoned to the
      // member who made each (issue #19).
      const scarf = await createWish(app, dima, 'Шёлковый платок')
      const bookmark = await favorite(app, anna, scarf.id)
      const annaCursor2 = (await sync(app, anna, annaDelta.revision)).revision
      const dimaCursor2 = (await sync(app, dima, dimaDelta.revision)).revision

      await removeWish(app, dima, scarf.id)

      const annaDelta2 = await sync(app, anna, annaCursor2)
      expect(favoritesOf(annaDelta2)).toEqual([])
      expect(annaDelta2.tombstones).toEqual([
        { entity: 'wishlist_wish', entityId: scarf.id, audience: 'all' },
        {
          entity: 'wishlist_gift_favorite',
          entityId: bookmark,
          audience: 'member',
          memberId: anna.memberId,
        },
      ])
      // Дима's delta carries the wish's tombstone alone: he never had a
      // favorite or a reservation to be told about.
      const dimaDelta2 = await sync(app, dima, dimaCursor2)
      expect(favoritesOf(dimaDelta2)).toEqual([])
      expect(reservationsOf(dimaDelta2)).toEqual([])
      expect(dimaDelta2.tombstones).toEqual([
        { entity: 'wishlist_wish', entityId: scarf.id, audience: 'all' },
      ])
    })
  })

  test('a hidden wishlist contributes none of the three entities, and a re-shown one resyncs', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')
      const lyuda = await memberSession(app, adminCookie, space.id, 'Люда')

      const lamp = await createWish(app, dima, 'Налобный фонарь')
      const kettle = await createWish(app, lyuda, 'Термос')
      await favorite(app, owner, lamp.id)
      await reserve(app, owner, lamp.id)
      await reserve(app, owner, kettle.id)

      // Before the hide: Аня carries every entity; Дима the ones the policy
      // delivers him — the reservation on Люда's wish, never the one on his
      // own, and never Аня's favorite.
      const beforeOwner = await sync(app, owner, '0')
      expect(beforeOwner.changes.filter((change) => change.entity === 'wishlist_wish'))
        .toHaveLength(2)
      expect(beforeOwner.changes.filter((change) => change.entity === 'wishlist_gift_favorite'))
        .toHaveLength(1)
      expect(beforeOwner.changes.filter((change) => change.entity === 'wishlist_gift_reservation'))
        .toHaveLength(2)
      const before = await sync(app, dima, '0')
      expect(before.changes.filter((change) => change.entity === 'wishlist_gift_reservation'))
        .toHaveLength(1)
      expect(before.changes.filter((change) => change.entity === 'wishlist_gift_favorite'))
        .toEqual([])

      await hideWishlist(app, owner, false)

      // From the pre-hide cursor the delta carries the new sections map and
      // no wishlist rows of any entity (ADR-0011, ADR-0014).
      const delta = await sync(app, dima, before.revision)
      expect(delta.changes.filter((change) => change.entity.startsWith('wishlist_'))).toEqual([])

      await hideWishlist(app, owner, true)

      // The client that saw the re-show discards its cursor and syncs from
      // revision 0 once: the section's full data comes back.
      const resync = await sync(app, dima, '0')
      expect(resync.changes.filter((change) => change.entity === 'wishlist_wish')).toHaveLength(2)
      expect(resync.changes.filter((change) => change.entity === 'wishlist_gift_reservation'))
        .toHaveLength(1)
      // The favorite belongs to Аня, and this is Дима's delta.
      expect(resync.changes.filter((change) => change.entity === 'wishlist_gift_favorite'))
        .toEqual([])
      const resyncOwner = await sync(app, owner, '0')
      expect(resyncOwner.changes.filter((change) => change.entity === 'wishlist_gift_favorite'))
        .toHaveLength(1)
      expect(resyncOwner.changes.filter((change) => change.entity === 'wishlist_gift_reservation'))
        .toHaveLength(2)
    })
  })
})
