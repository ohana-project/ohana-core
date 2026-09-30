import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { DomainError } from '../../platform/errors.ts'
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

const ADMIN_PASSWORD = 'spaces-routes-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

/*
 * The administrator is a singleton, so each file that signs in re-establishes
 * it in its arrange step; test files run one at a time (vitest.config.ts).
 */
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await ensureInitialAdministrator(harness, ADMIN_PASSWORD)

/** Signs in and returns the administrative session cookie for later requests. */
async function signedInCookie(app: ReturnType<TestHarness['buildTestApp']>): Promise<string> {
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

describe('POST /api/v1/spaces', () => {
  test('requires administrative authentication', async () => {
    // A unique name: the suite's other files create their own spaces too.
    const name = `Smith family ${randomUUID()}`
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: { code: 'unauthorized', message: expect.any(String) },
      })
      const created = await harness.db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.name, name))
      expect(created).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  test('rejects before the payload is parsed', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: '{not json',
        headers: { 'content-type': 'application/json' },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('unauthorized')
    } finally {
      await app.close()
    }
  })
})

describe('error handling', () => {
  test('returns 404 with a machine-readable code for unknown routes', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/nope' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: { code: 'not_found', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })

  test('maps domain errors to their status and stable code', async () => {
    const app = harness.buildTestApp()
    app.post('/api/v1/boom', async () => {
      throw new DomainError('space_not_found', 'No such space', 404)
    })
    await app.ready()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/boom' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: { code: 'space_not_found', message: 'No such space' },
      })
    } finally {
      await app.close()
    }
  })

  test('reports malformed JSON as a client error with a stable code', async () => {
    const app = harness.buildTestApp()
    app.post('/echo', async (request) => request.body)
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        payload: '{not json',
        headers: { 'content-type': 'application/json' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({
        error: { code: 'invalid_json', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })

  test('reports oversized payloads as a client error with a stable code', async () => {
    const app = harness.buildTestApp()
    app.post('/echo', async (request) => request.body)
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        payload: JSON.stringify({ blob: 'x'.repeat(1_200_000) }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.statusCode).toBe(413)
      expect(response.json()).toEqual({
        error: { code: 'payload_too_large', message: expect.any(String) },
      })
    } finally {
      await app.close()
    }
  })
})

describe('administrative space management', () => {
  test('creates a space with an explicit time zone', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Наша семья', timezone: 'Europe/Moscow' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body).toEqual({
        id: expect.any(String),
        name: 'Наша семья',
        timezone: 'Europe/Moscow',
        revision: '0',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
      const rows = await harness.db.select().from(spaces).where(eq(spaces.id, body.id))
      expect(rows[0]?.timezone).toBe('Europe/Moscow')
      expect(rows[0]?.revision).toBe(0n)
    } finally {
      await app.close()
    }
  })

  test('defaults the time zone to UTC', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Дача' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json().timezone).toBe('UTC')
    } finally {
      await app.close()
    }
  })

  test('rejects a time zone Intl does not know', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Наша семья', timezone: 'Mars/Olympus' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('invalid_timezone')
    } finally {
      await app.close()
    }
  })

  test('lists spaces with member counts', async () => {
    const family = await harness.createSpace({ name: 'Список: семья' })
    const dacha = await harness.createSpace({ name: 'Список: дача' })
    await harness.createMember(family.id, { name: 'Аня' })
    await harness.createMember(family.id, { name: 'Дима' })
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/spaces',
        headers: { cookie },
      })
      expect(response.statusCode).toBe(200)
      const listed = response
        .json()
        .filter((space: { id: string }) => space.id === family.id || space.id === dacha.id)
      expect(listed).toHaveLength(2)
      const byName = new Map(
        listed.map((space: { name: string; memberCount: number }) => [
          space.name,
          space.memberCount,
        ]),
      )
      expect(byName.get('Список: семья')).toBe(2)
      expect(byName.get('Список: дача')).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('requires authentication for the listing', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/spaces' })
      expect(response.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  test('returns one space by id and 404 for an unknown one', async () => {
    const space = await harness.createSpace({ name: 'Одиночное чтение' })
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const found = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${space.id}`,
        headers: { cookie },
      })
      expect(found.statusCode).toBe(200)
      expect(found.json()).toMatchObject({ id: space.id, name: 'Одиночное чтение' })

      const missing = await app.inject({
        method: 'GET',
        url: '/api/v1/spaces/00000000-0000-7000-8000-000000000000',
        headers: { cookie },
      })
      expect(missing.statusCode).toBe(404)
      expect(missing.json().error.code).toBe('space_not_found')
    } finally {
      await app.close()
    }
  })

  test('renames a space and advances its revision in the same change', async () => {
    const space = await harness.createSpace({ name: 'Старое имя' })
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}`,
        payload: { name: 'Новое имя' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.name).toBe('Новое имя')
      expect(body.revision).toBe('1')
      const rows = await harness.db.select().from(spaces).where(eq(spaces.id, space.id))
      expect(rows[0]?.name).toBe('Новое имя')
      expect(rows[0]?.revision).toBe(1n)
    } finally {
      await app.close()
    }
  })

  test('changes the default time zone and advances the revision', async () => {
    const space = await harness.createSpace({ name: 'Пояс' })
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}`,
        payload: { timezone: 'Asia/Novosibirsk' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ timezone: 'Asia/Novosibirsk', revision: '1' })
    } finally {
      await app.close()
    }
  })

  test('rejects an unknown time zone on rename', async () => {
    const space = await harness.createSpace({ name: 'Пояс' })
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const cookie = await signedInCookie(app)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/spaces/${space.id}`,
        payload: { timezone: 'Not/AZone' },
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('invalid_timezone')
    } finally {
      await app.close()
    }
  })

  test('answers 401 and creates nothing without a session', async () => {
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/spaces/00000000-0000-7000-8000-000000000000',
        payload: { name: 'Новое имя' },
        headers: MARKER,
      })
      expect(response.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})
