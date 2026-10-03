import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { ADMIN_MARKER_HEADER, ADMIN_SESSION_COOKIE, ensureInitialAdministrator } from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { memberSessions } from '../access/tables.ts'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { members as memberRows } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'archiving-admin-password'

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
    headers: { [ADMIN_MARKER_HEADER]: '1' },
  })
  expect(response.statusCode).toBe(204)
  const cookie = response.cookies.find((candidate) => candidate.name === ADMIN_SESSION_COOKIE)
  if (cookie === undefined) throw new Error('Sign-in set no administrative session cookie')
  return `${ADMIN_SESSION_COOKIE}=${cookie.value}`
}

async function issueAdminCode(app: TestApp, cookie: string, spaceId: string, memberId: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members/${memberId}/access-codes`,
    headers: { cookie, [ADMIN_MARKER_HEADER]: '1' },
  })
  expect(response.statusCode).toBe(201)
  return response.json() as Promise<{ id: string; code: string }>
}

interface MemberSession {
  memberId: string
  cookie: string
}

/** Redeems the code and returns the session the response cookie names. */
async function signInMember(app: TestApp, code: string): Promise<MemberSession> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/access-codes/redeem',
    payload: { code },
  })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((candidate) =>
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

async function archiveForMember(app: TestApp, session: MemberSession, memberId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/members/${memberId}/archive`,
    headers: memberHeaders(session),
  })
}

describe('POST /api/v1/members/:memberId/archive (owner archives a member)', () => {
  test('an owner archives a regular member of their own space', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )

      const before = harness.clock.now()
      const response = await archiveForMember(app, session, member.id)
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toMatchObject({ id: member.id, name: 'Дима', archivedAt: before.toISOString() })

      const rows = await harness.db.select().from(memberRows).where(eq(memberRows.id, member.id))
      expect(rows[0]?.archivedAt).toEqual(before)
    })
  })

  test('a regular member is refused', async () => {
    const space = await harness.createSpace()
    await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    const other = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await archiveForMember(app, session, other.id)
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')

      const rows = await harness.db.select().from(memberRows).where(eq(memberRows.id, other.id))
      expect(rows[0]?.archivedAt).toBeNull()
    })
  })

  test('archiving the last active owner is rejected', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const second = await harness.createMember(space.id, { name: 'Дима', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )

      // The second owner can go; the last one cannot.
      const secondArchive = await archiveForMember(app, session, second.id)
      expect(secondArchive.statusCode).toBe(200)

      const refused = await archiveForMember(app, session, owner.id)
      expect(refused.statusCode).toBe(409)
      expect(refused.json().error.code).toBe('last_owner')

      const rows = await harness.db.select().from(memberRows).where(eq(memberRows.id, owner.id))
      expect(rows[0]?.archivedAt).toBeNull()
    })
  })

  test('an already archived member is refused a second archiving', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      expect((await archiveForMember(app, session, member.id)).statusCode).toBe(200)

      const again = await archiveForMember(app, session, member.id)
      expect(again.statusCode).toBe(409)
      expect(again.json().error.code).toBe('member_already_archived')
    })
  })

  test('a member of another space is not visible to the archiving owner', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const owner = await harness.createMember(family.id, { name: 'Аня', role: 'owner' })
    const stranger = await harness.createMember(other.id, { name: 'Пётр', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, family.id, owner.id)).code,
      )

      const response = await archiveForMember(app, session, stranger.id)
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('member_not_found')
    })
  })

  test('archiving revokes the member sessions and the unused access code', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      // Two devices for the member, and an outstanding invitation.
      await signInMember(app, (await issueAdminCode(app, adminCookie, space.id, member.id)).code)
      const spareCode = await issueAdminCode(app, adminCookie, space.id, member.id)

      expect((await archiveForMember(app, session, member.id)).statusCode).toBe(200)

      const sessions = await harness.db
        .select()
        .from(memberSessions)
        .where(and(eq(memberSessions.spaceId, space.id), eq(memberSessions.memberId, member.id)))
      expect(sessions).toHaveLength(0)

      const redeemed = await app.inject({
        method: 'POST',
        url: '/api/v1/access-codes/redeem',
        payload: { code: spareCode.code },
      })
      // The archiving revoked the outstanding invitation, so the redemption
      // meets a revoked code — the standing refusal for one of those.
      expect(redeemed.statusCode).toBe(409)
      expect(redeemed.json().error.code).toBe('access_code_revoked')
    })
  })

  test('an archived member can no longer authenticate', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      const memberSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, member.id)).code,
      )
      expect((await archiveForMember(app, session, member.id)).statusCode).toBe(200)

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(memberSession),
      })
      expect(me.statusCode).toBe(401)
    })
  })

  test('the role of an archived member cannot be changed', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      expect((await archiveForMember(app, session, member.id)).statusCode).toBe(200)

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${member.id}`,
        headers: memberHeaders(session),
        payload: { role: 'regular' },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('member_archived')
    })
  })
})

describe('POST /api/v1/spaces/:spaceId/members/:memberId/archive (administrative archiving)', () => {
  test('the instance administrator archives a member of any space', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members/${member.id}/archive`,
        headers: { cookie: adminCookie, [ADMIN_MARKER_HEADER]: '1' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().archivedAt).toEqual(harness.clock.now().toISOString())
    })
  })

  test('the administrative route requires the administrative session', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members/${member.id}/archive`,
        headers: { [ADMIN_MARKER_HEADER]: '1' },
      })
      expect(response.statusCode).toBe(401)
    })
  })

  test('the administrative route refuses the last active owner too', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members/${owner.id}/archive`,
        headers: { cookie: adminCookie, [ADMIN_MARKER_HEADER]: '1' },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('last_owner')
    })
  })
})

/*
 * What stays and what disappears (issue #23): the wishes are hidden from
 * the space but kept, the member's reservations are released, and every
 * device learns of the change through the sync — tombstones for what left
 * its view, the member upsert for the archiving stamp itself.
 */

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

async function reserve(app: TestApp, session: MemberSession, wishId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/wishlist/wishes/${wishId}/reservation`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(201)
  return (response.json() as { id: string }).id
}

interface SyncResponse {
  revision: string
  changes: Array<{ entity: string; member?: { id: string; archivedAt?: string }; wish?: { id: string } }>
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

describe('the archiving in sync (issue #23)', () => {
  test('the archiving stamps the member row and tombstones their wishes to everyone', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    const bystander = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const ownerSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      const memberSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, member.id)).code,
      )
      const bystanderSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, bystander.id)).code,
      )
      const wish = await createWish(app, memberSession, 'Велосипед')
      const cursor = (await sync(app, bystanderSession, '0')).revision

      expect((await archiveForMember(app, ownerSession, member.id)).statusCode).toBe(200)

      for (const session of [ownerSession, bystanderSession]) {
        const delta = await sync(app, session, cursor)
        const wishTombstones = delta.tombstones.filter(
          (row) => row.entity === 'wishlist_wish' && row.entityId === wish.id,
        )
        expect(wishTombstones).toHaveLength(1)
        expect(wishTombstones[0]?.audience).toBe('all')
        const memberUpsert = delta.changes.find(
          (change) => change.entity === 'member' && change.member?.id === member.id,
        )
        expect(memberUpsert?.member?.archivedAt).toEqual(expect.any(String))
      }
    })
  })

  test('the member reservations are released, tombstoned per member but never to the author', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    const author = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })
    const bystander = await harness.createMember(space.id, { name: 'Пётр', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const ownerSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      const memberSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, member.id)).code,
      )
      const authorSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, author.id)).code,
      )
      const bystanderSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, bystander.id)).code,
      )
      const wish = await createWish(app, authorSession, 'Книга')
      const reservationId = await reserve(app, memberSession, wish.id)
      const cursors = {
        author: (await sync(app, authorSession, '0')).revision,
        bystander: (await sync(app, bystanderSession, '0')).revision,
      }

      expect((await archiveForMember(app, ownerSession, member.id)).statusCode).toBe(200)

      // Every member but the author learns the reservation ended; the
      // author learns nothing — no all-audience tombstone may carry it.
      const authorDelta = await sync(app, authorSession, cursors.author)
      expect(
        authorDelta.tombstones.filter(
          (row) => row.entity === 'wishlist_gift_reservation' && row.entityId === reservationId,
        ),
      ).toEqual([])

      const bystanderDelta = await sync(app, bystanderSession, cursors.bystander)
      const endings = bystanderDelta.tombstones.filter(
        (row) => row.entity === 'wishlist_gift_reservation' && row.entityId === reservationId,
      )
      expect(endings).toHaveLength(1)
      expect(endings[0]).toMatchObject({ audience: 'member', memberId: bystander.id })
    })
  })

  test('an archived member is excluded from the space and from the reminders differently', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    const other = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const ownerSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, owner.id)).code,
      )
      const memberSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, member.id)).code,
      )
      const otherSession = await signInMember(
        app,
        (await issueAdminCode(app, adminCookie, space.id, other.id)).code,
      )
      const wish = await createWish(app, memberSession, 'Велосипед')
      expect((await archiveForMember(app, ownerSession, member.id)).statusCode).toBe(200)

      // The browse hides the archived author's wishes from everyone else.
      const browse = await app.inject({
        method: 'GET',
        url: '/api/v1/wishlist/wishes',
        headers: memberHeaders(otherSession),
      })
      expect(browse.statusCode).toBe(200)
      expect(browse.json().wishes.some((row: { id: string }) => row.id === wish.id)).toBe(false)

      // The wish itself answers 404 — its existence is not revealed.
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/wishlist/wishes/${wish.id}`,
        headers: memberHeaders(otherSession),
      })
      expect(read.statusCode).toBe(404)

      // A fresh device's sync from zero never receives the hidden wishes.
      const fresh = await sync(app, otherSession, '0')
      expect(
        fresh.changes.filter(
          (change) => change.entity === 'wishlist_wish' && change.wish?.id === wish.id,
        ),
      ).toEqual([])
    })
  })
})
