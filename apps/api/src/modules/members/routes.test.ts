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
import { members } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'members-routes-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

/*
 * The administrator is a singleton, so each file that signs in re-establishes
 * it in its arrange step; test files run one at a time (vitest.config.ts).
 */
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await ensureInitialAdministrator(harness, ADMIN_PASSWORD)

async function withApp(body: (app: ReturnType<TestHarness['buildTestApp']>) => Promise<void>) {
  const app = harness.buildTestApp()
  await app.ready()
  try {
    await body(app)
  } finally {
    await app.close()
  }
}

async function signInAndGetCookie(app: ReturnType<TestHarness['buildTestApp']>): Promise<string> {
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

async function spaceRevision(spaceId: string): Promise<bigint> {
  const rows = await harness.db
    .select({ revision: spaces.revision })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
  return rows[0]?.revision ?? -1n
}

describe('POST /api/v1/spaces/:spaceId/members', () => {
  test('requires administrative authentication', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: { name: 'Аня', role: 'owner' },
        headers: MARKER,
      })
      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('unauthorized')
    })
  })

  test('rejects a state-changing request without the marker header', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: { name: 'Аня', role: 'owner' },
        headers: { cookie },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('missing_admin_header')
      const rows = await harness.db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.spaceId, space.id))
      expect(rows).toHaveLength(0)
    })
  })

  test('provisions an owner with profile fields and stamps the space revision', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: {
          name: 'Аня',
          role: 'owner',
          displayName: 'Аня Смирнова',
          email: 'anya@example.com',
          phone: '+7 900 000-00-00',
          interfaceLanguage: 'ru',
        },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body).toEqual({
        id: expect.any(String),
        spaceId: space.id,
        name: 'Аня',
        displayName: 'Аня Смирнова',
        email: 'anya@example.com',
        phone: '+7 900 000-00-00',
        interfaceLanguage: 'ru',
        role: 'owner',
        revision: '1',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
      expect(await spaceRevision(space.id)).toBe(1n)
    })
  })

  test('omits absent profile fields from the response', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: { name: 'Дима', role: 'regular' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body).not.toHaveProperty('displayName')
      expect(body).not.toHaveProperty('email')
      expect(body).not.toHaveProperty('phone')
      expect(body).not.toHaveProperty('interfaceLanguage')
    })
  })

  test('answers space_not_found for an unknown space', async () => {
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces/00000000-0000-7000-8000-000000000000/members',
        payload: { name: 'Аня', role: 'owner' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('space_not_found')
    })
  })

  test('rejects a role outside owner and regular', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: { name: 'Аня', role: 'administrator' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(400)
    })
  })

  test('rejects an interface language outside ru and en', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: { name: 'Аня', role: 'owner', interfaceLanguage: 'fr' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(400)
    })
  })

  test('rejects a whitespace-only name', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members`,
        payload: { name: '   ', role: 'owner' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(400)
    })
  })
})

describe('GET /api/v1/spaces/:spaceId/members', () => {
  test('lists only the named space’s members, first provisioned first', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    await harness.createMember(family.id, { name: 'Аня', role: 'owner' })
    await harness.createMember(other.id, { name: 'Пётр', role: 'owner' })
    await harness.createMember(family.id, { name: 'Дима' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${family.id}/members`,
        headers: { cookie },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().map((member: { name: string }) => member.name)).toEqual([
        'Аня',
        'Дима',
      ])
    })
  })

  test('requires administrative authentication', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${space.id}/members`,
      })
      expect(response.statusCode).toBe(401)
    })
  })

  test('answers space_not_found for an unknown space', async () => {
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/spaces/00000000-0000-7000-8000-000000000000/members',
        headers: { cookie },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('space_not_found')
    })
  })
})

describe('PATCH /api/v1/spaces/:spaceId/members/:memberId', () => {
  test('promotes a regular member to owner and advances the space revision', async () => {
    const space = await harness.createSpace()
    await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const dima = await harness.createMember(space.id, { name: 'Дима' })
    const before = await spaceRevision(space.id)
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}/members/${dima.id}`,
        payload: { role: 'owner' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().role).toBe('owner')
      expect(await spaceRevision(space.id)).toBe(before + 1n)
    })
    const rows = await harness.db
      .select({ role: members.role, revision: members.revision })
      .from(members)
      .where(eq(members.id, dima.id))
    expect(rows[0]?.role).toBe('owner')
    // The promoted row is stamped with the revision it was written at.
    expect(rows[0]?.revision).toBe(before + 1n)
  })

  test('refuses to remove the owner role from the last owner', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}/members/${anya.id}`,
        payload: { role: 'regular' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('last_owner')
    })
    const rows = await harness.db
      .select({ role: members.role })
      .from(members)
      .where(eq(members.id, anya.id))
    expect(rows[0]?.role).toBe('owner')
  })

  test('demotes an owner while another owner remains', async () => {
    const space = await harness.createSpace()
    await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const dima = await harness.createMember(space.id, { name: 'Дима', role: 'owner' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}/members/${dima.id}`,
        payload: { role: 'regular' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().role).toBe('regular')
    })
  })

  test('answers member_not_found for a member of another space', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const stranger = await harness.createMember(other.id, { name: 'Пётр', role: 'owner' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${family.id}/members/${stranger.id}`,
        payload: { role: 'regular' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('member_not_found')
    })
  })

  test('requires administrative authentication', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}/members/${member.id}`,
        payload: { role: 'regular' },
        headers: MARKER,
      })
      expect(response.statusCode).toBe(401)
    })
  })
})
