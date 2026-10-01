import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { spaces } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'owner-space-admin-password'

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

describe('GET /api/v1/space (the member reads their space)', () => {
  test('a member reads their own space with its default time zone', async () => {
    const space = await harness.createSpace({ name: 'Наша семья', timezone: 'Asia/Novosibirsk' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/space',
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'Asia/Novosibirsk',
      })
    })
  })

  test('the space always comes from the actor: another space’s zone stays untouched', async () => {
    const family = await harness.createSpace({ name: 'Наша семья', timezone: 'Europe/Moscow' })
    const other = await harness.createSpace({ name: 'Аня и родители', timezone: 'UTC' })
    const member = await harness.createMember(family.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, family.id, member.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { timezone: 'Asia/Novosibirsk' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: family.id,
        name: 'Наша семья',
        timezone: 'Asia/Novosibirsk',
      })

      // The patch moved the actor's own space and nothing else.
      const rows = await harness.db.select().from(spaces)
      const zones = new Map(rows.map((row) => [row.id, row.timezone]))
      expect(zones.get(family.id)).toBe('Asia/Novosibirsk')
      expect(zones.get(other.id)).toBe('UTC')
    })
  })
})

describe('PATCH /api/v1/space (the owner sets the default time zone)', () => {
  test('an owner changes the default time zone', async () => {
    const space = await harness.createSpace({ name: 'Наша семья', timezone: 'UTC' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { timezone: 'Asia/Novosibirsk' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'Asia/Novosibirsk',
      })

      const rows = await harness.db.select().from(spaces).where(eq(spaces.id, space.id))
      expect(rows[0]?.timezone).toBe('Asia/Novosibirsk')
    })
  })

  test('a regular member is rejected and the zone stays', async () => {
    const space = await harness.createSpace({ name: 'Наша семья', timezone: 'UTC' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { timezone: 'Asia/Novosibirsk' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')

      const rows = await harness.db.select().from(spaces).where(eq(spaces.id, space.id))
      expect(rows[0]?.timezone).toBe('UTC')
    })
  })

  test('an unknown time zone is refused', async () => {
    const space = await harness.createSpace({ name: 'Наша семья', timezone: 'UTC' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { timezone: 'Mars/Olympus' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('invalid_timezone')
    })
  })
})
