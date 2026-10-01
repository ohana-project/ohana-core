import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { members as memberRows } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'owner-members-admin-password'

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

async function issueCode(app: TestApp, cookie: string, spaceId: string, memberId: string) {
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

describe('POST /api/v1/members (owner provisions a member)', () => {
  test('an owner provisions a member in their own space', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const before = harness.clock.now()
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/members',
        headers: memberHeaders(session),
        payload: { name: 'Дима', role: 'regular' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json()).toEqual({
        id: expect.any(String),
        name: 'Дима',
        role: 'regular',
        createdAt: before.toISOString(),
      })

      const rows = await harness.db
        .select()
        .from(memberRows)
        .where(eq(memberRows.id, response.json().id))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.spaceId).toBe(space.id)
      expect(rows[0]?.role).toBe('regular')
    })
  })

  test('a regular member is rejected and provisions nothing', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      await signInMember(app, (await issueCode(app, adminCookie, space.id, owner.id)).code)
      const regularSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/members',
        headers: memberHeaders(regularSession),
        payload: { name: 'Люда', role: 'regular' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')

      const rows = await harness.db
        .select()
        .from(memberRows)
        .where(eq(memberRows.spaceId, space.id))
      // Only the two arrange members exist; the refused request added none.
      expect(rows.map((row) => row.name).sort()).toEqual(['Аня', 'Дима'])
    })
  })

  test('without a member session the route answers 401', async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/members',
        headers: { 'x-ohana-member': crypto.randomUUID() },
        payload: { name: 'Дима', role: 'regular' },
      })
      expect(response.statusCode).toBe(401)
    })
  })
})

describe('PATCH /api/v1/members/:memberId (owner changes a role)', () => {
  test('an owner promotes a regular member to owner and back', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const member = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const promoted = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${member.id}`,
        headers: memberHeaders(session),
        payload: { role: 'owner' },
      })
      expect(promoted.statusCode).toBe(200)
      expect(promoted.json().role).toBe('owner')

      const demoted = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${member.id}`,
        headers: memberHeaders(session),
        payload: { role: 'regular' },
      })
      expect(demoted.statusCode).toBe(200)
      expect(demoted.json().role).toBe('regular')
    })
  })

  test('demoting the last active owner is rejected', async () => {
    const space = await harness.createSpace()
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${owner.id}`,
        headers: memberHeaders(session),
        payload: { role: 'regular' },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('last_owner')

      const rows = await harness.db.select().from(memberRows).where(eq(memberRows.id, owner.id))
      expect(rows[0]?.role).toBe('owner')
    })
  })

  test('a regular member is rejected', async () => {
    const space = await harness.createSpace()
    await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    const other = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${other.id}`,
        headers: memberHeaders(session),
        payload: { role: 'owner' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')
    })
  })

  test('an owner cannot change a member of another space', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const owner = await harness.createMember(family.id, { name: 'Аня', role: 'owner' })
    const stranger = await harness.createMember(other.id, { name: 'Пётр', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, family.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${stranger.id}`,
        headers: memberHeaders(session),
        payload: { role: 'owner' },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('member_not_found')

      const rows = await harness.db.select().from(memberRows).where(eq(memberRows.id, stranger.id))
      expect(rows[0]?.role).toBe('regular')
    })
  })
})
