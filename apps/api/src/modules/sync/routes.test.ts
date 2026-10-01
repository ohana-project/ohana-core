import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { spaces } from '../spaces/tables.ts'
import { recordChanges } from './index.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'sync-routes-admin-password'
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

interface MemberSession {
  memberId: string
  cookie: string
}

function memberHeaders(session: MemberSession) {
  return { 'x-ohana-member': session.memberId, cookie: session.cookie }
}

interface SyncResponse {
  revision: string
  changes: Array<Record<string, unknown>>
  tombstones: Array<Record<string, unknown>>
}

async function sync(app: TestApp, session: MemberSession, since: string): Promise<SyncResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/sync?since=${since}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return response.json() as Promise<SyncResponse>
}

async function spaceRevision(spaceId: string): Promise<bigint> {
  const rows = await harness.db.select().from(spaces).where(eq(spaces.id, spaceId))
  const row = rows[0]
  if (row === undefined) throw new Error('The space row disappeared')
  return row.revision
}

describe('GET /api/v1/sync', () => {
  test('answers a member session only', async () => {
    await withApp(async (app) => {
      const denied = await app.inject({ method: 'GET', url: '/api/v1/sync?since=0' })
      expect(denied.statusCode).toBe(401)
    })
  })

  test('the first sync carries the space with its sections map and every profile', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      await harness.createMember(space.id, { name: 'Дима' })

      const result = await sync(app, owner, '0')

      expect(result.revision).toBe('2')
      const spaceChange = result.changes.find((change) => change.entity === 'space')
      expect(spaceChange).toMatchObject({
        entity: 'space',
        space: {
          id: space.id,
          name: 'Наша семья',
          timezone: 'UTC',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      })
      const memberChanges = result.changes.filter((change) => change.entity === 'member')
      expect(memberChanges).toHaveLength(2)
      const names = memberChanges.map((change) => (change.member as { name: string }).name).sort()
      expect(names).toEqual(['Аня', 'Дима'])
      expect(result.tombstones).toEqual([])
    })
  })

  test('revisions only increase, and a delta from the latest revision returns nothing', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')

      const first = await sync(app, owner, '0')
      const firstRevision = BigInt(first.revision)

      const rename = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        payload: { timezone: 'Europe/Moscow' },
        headers: memberHeaders(owner),
      })
      expect(rename.statusCode).toBe(200)

      const second = await sync(app, owner, first.revision)
      expect(BigInt(second.revision)).toBeGreaterThan(firstRevision)
      expect(await spaceRevision(space.id)).toBe(BigInt(second.revision))

      const third = await sync(app, owner, second.revision)
      expect(third.changes).toEqual([])
      expect(third.tombstones).toEqual([])
      expect(BigInt(third.revision)).toBe(BigInt(second.revision))
    })
  })

  test('a delta carries only the rows changed since the cursor', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const cursor = await sync(app, owner, '0')

      const joined = await memberSession(app, adminCookie, space.id, 'Миша')

      const delta = await sync(app, owner, cursor.revision)
      const memberChanges = delta.changes.filter((change) => change.entity === 'member')
      expect(memberChanges).toHaveLength(1)
      expect(memberChanges[0]).toMatchObject({
        entity: 'member',
        member: { id: joined.memberId, name: 'Миша', role: 'regular' },
      })
    })
  })

  test('tombstones are delivered, filtered by their audience', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const other = await memberSession(app, adminCookie, space.id, 'Дима')
      const gone = await harness.createMember(space.id, { name: 'Ушедший' })
      const secret = await harness.createMember(space.id, { name: 'Черновик' })
      const cursor = await sync(app, owner, '0')

      // Something leaves every member's view, and something else leaves only
      // Дима's view; the tombstones are written the way use cases write them.
      await harness.db.transaction(async (tx) =>
        recordChanges(
          tx,
          space.id,
          {
            tombstones: [
              { entity: 'member', entityId: gone.id, audience: { kind: 'all' } },
              {
                entity: 'member',
                entityId: secret.id,
                audience: { kind: 'member', memberId: other.memberId },
              },
            ],
          },
          harness.clock.now(),
        ),
      )

      const forOwner = await sync(app, owner, cursor.revision)
      expect(forOwner.tombstones).toEqual([
        { entity: 'member', entityId: gone.id, audience: 'all' },
      ])

      const forOther = await sync(app, other, cursor.revision)
      expect(forOther.tombstones).toHaveLength(2)
      expect(forOther.tombstones).toEqual(
        expect.arrayContaining([
          { entity: 'member', entityId: gone.id, audience: 'all' },
          {
            entity: 'member',
            entityId: secret.id,
            audience: 'member',
            memberId: other.memberId,
          },
        ]),
      )
    })
  })

  test('another space’s changes never appear', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await harness.createMember(otherSpace.id, { name: 'Чужак' })
      await harness.db.transaction(async (tx) =>
        recordChanges(
          tx,
          otherSpace.id,
          { tombstones: [{ entity: 'member', entityId: stranger.id, audience: { kind: 'all' } }] },
          harness.clock.now(),
        ),
      )

      const result = await sync(app, owner, '0')
      expect(result.revision).toBe('1')
      const spaceChange = result.changes.find((change) => change.entity === 'space')
      expect(spaceChange).toMatchObject({ space: { id: space.id } })
      for (const change of result.changes) {
        const member = change.member as { id: string } | undefined
        if (member !== undefined) expect(member.id).not.toBe(stranger.id)
      }
      expect(result.tombstones).toEqual([])
    })
  })

  test('hiding a section delivers the new map and no tombstones', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const cursor = await sync(app, owner, '0')

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        payload: { sections: { journal: false } },
        headers: memberHeaders(owner),
      })
      expect(hide.statusCode).toBe(200)

      const delta = await sync(app, owner, cursor.revision)
      expect(delta.changes).toEqual([
        {
          entity: 'space',
          space: {
            id: space.id,
            name: space.name,
            timezone: 'UTC',
            sections: { journal: false, calendar: true, wishlist: true },
          },
        },
      ])
      // A hide writes no per-row tombstones (ADR-0011, ADR-0014): the client
      // drops the hidden section's rows when it applies the new map.
      expect(delta.tombstones).toEqual([])
    })
  })

  test('rejects a cursor that is not a plain non-negative integer', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      for (const since of ['-1', '1.5', 'abc', '99999999999999999999999999']) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/sync?since=${since}`,
          headers: memberHeaders(owner),
        })
        expect(response.statusCode).toBe(400)
      }
    })
  })
})
