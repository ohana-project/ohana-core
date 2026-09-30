import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import {
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_TTL_MS,
  formatAccessCode,
  generateAccessCode,
  normalizeAccessCode,
} from './service.ts'
import { accessCodes } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'access-codes-admin-password'
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

async function issueCode(
  app: ReturnType<TestHarness['buildTestApp']>,
  cookie: string,
  spaceId: string,
  memberId: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members/${memberId}/access-codes`,
    headers: { cookie, ...MARKER },
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

describe('access code generation', () => {
  test('draws eight symbols from the unambiguous alphabet', () => {
    const seen = new Set<string>()
    for (let attempt = 0; attempt < 500; attempt++) {
      const code = generateAccessCode()
      expect(code).toMatch(new RegExp(`^[${ACCESS_CODE_ALPHABET}]{8}$`))
      seen.add(code)
    }
    // 500 draws out of 32^8 never collide; a repeated code would mean the
    // source is not uniformly random.
    expect(seen.size).toBe(500)
  })

  test('formats as XXXX-XXXX and normalises case, hyphens, and whitespace', () => {
    expect(formatAccessCode('ABCD2345')).toBe('ABCD-2345')
    expect(normalizeAccessCode('abcd-2345')).toBe('ABCD2345')
    expect(normalizeAccessCode(' ABCD2345 ')).toBe('ABCD2345')
    expect(normalizeAccessCode('ABCD2345')).toBe('ABCD2345')
  })

  test('rejects input that is not shaped like a code', () => {
    expect(normalizeAccessCode('short')).toBeUndefined()
    expect(normalizeAccessCode('ABCD23456')).toBeUndefined()
    // 0, 1, I and O never appear in the alphabet, so they cannot be typed.
    expect(normalizeAccessCode('ABCD1O25')).toBeUndefined()
    expect(normalizeAccessCode('')).toBeUndefined()
  })
})

describe('POST /api/v1/spaces/:spaceId/members/:memberId/access-codes', () => {
  test('issues a code, shows the plaintext once, and stores only a hash', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const before = harness.clock.now()
      const body = await issueCode(app, cookie, space.id, member.id)

      expect(body.code).toMatch(new RegExp(`^[${ACCESS_CODE_ALPHABET}]{4}-[${ACCESS_CODE_ALPHABET}]{4}$`))
      expect(body.memberId).toBe(member.id)
      expect(body.status).toBe('issued')
      const expectedExpiry = new Date(before.getTime() + ACCESS_CODE_TTL_MS)
      expect(new Date(body.createdAt).getTime()).toBe(before.getTime())
      expect(new Date(body.expiresAt).getTime()).toBe(expectedExpiry.getTime())

      const rows = await harness.db
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.memberId, member.id))
      expect(rows).toHaveLength(1)
      const stored = rows[0]!
      expect(stored.codeHash).toHaveLength(64)
      // Neither the plaintext nor its hyphenated form is stored anywhere.
      const plain = body.code.replace('-', '')
      expect(stored.codeHash).not.toContain(plain)
      expect(JSON.stringify(stored)).not.toContain(plain)
      expect(stored.issuerAdministratorId).toBeDefined()
      expect(stored.issuerMemberId).toBeNull()
    })
  })

  test('requires administrative authentication and the marker header', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const withoutSession = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members/${member.id}/access-codes`,
        headers: MARKER,
      })
      expect(withoutSession.statusCode).toBe(401)

      const cookie = await signInAndGetCookie(app)
      const withoutMarker = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/members/${member.id}/access-codes`,
        headers: { cookie },
      })
      expect(withoutMarker.statusCode).toBe(403)
      expect(withoutMarker.json().error.code).toBe('missing_admin_header')
      const rows = await harness.db
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.memberId, member.id))
      expect(rows).toHaveLength(0)
    })
  })

  test('answers member_not_found for a member of another space', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const stranger = await harness.createMember(other.id, { name: 'Пётр' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${family.id}/members/${stranger.id}/access-codes`,
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('member_not_found')
    })
  })

  test('issuing a replacement marks older unused codes as replaced', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const first = await issueCode(app, cookie, space.id, member.id)
      harness.clock.advance(1000)
      const second = await issueCode(app, cookie, space.id, member.id)
      expect(first.code).not.toBe(second.code)

      const rows = await harness.db
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.memberId, member.id))
      const statuses = new Map(rows.map((row) => [row.status, row] as const))
      expect(rows).toHaveLength(2)
      expect(statuses.get('replaced')?.statusChangedAt.getTime()).toBe(harness.clock.now().getTime())
      expect(statuses.get('issued')?.codeHash).toBeDefined()
    })
  })

  test('an issued code past its expiry becomes expired, not replaced', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      await issueCode(app, cookie, space.id, member.id)
      // Advancing past a code's day also outlives the administrative
      // session, so the file signs in again before issuing the replacement.
      harness.clock.advance(ACCESS_CODE_TTL_MS + 1000)
      const freshCookie = await signInAndGetCookie(app)
      await issueCode(app, freshCookie, space.id, member.id)

      const rows = await harness.db
        .select({ status: accessCodes.status })
        .from(accessCodes)
        .where(eq(accessCodes.memberId, member.id))
      expect(rows.map((row) => row.status).sort()).toEqual(['expired', 'issued'])
    })
  })
})

describe('GET /api/v1/spaces/:spaceId/access-codes', () => {
  test('lists the space codes newest first without plaintext', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня' })
    const dima = await harness.createMember(space.id, { name: 'Дима' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const first = await issueCode(app, cookie, space.id, anya.id)
      harness.clock.advance(1000)
      const second = await issueCode(app, cookie, space.id, dima.id)

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${space.id}/access-codes`,
        headers: { cookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.map((code: { id: string }) => code.id)).toEqual([second.id, first.id])
      expect(body[0]).toEqual({
        id: second.id,
        memberId: dima.id,
        status: 'issued',
        createdAt: second.createdAt,
        expiresAt: second.expiresAt,
        statusChangedAt: second.statusChangedAt,
      })
      expect(JSON.stringify(body)).not.toContain('code')

      // Only the named space's codes are listed.
      const other = await harness.createSpace()
      const otherResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${other.id}/access-codes`,
        headers: { cookie },
      })
      expect(otherResponse.json()).toEqual([])
    })
  })

  test('reports an issued code past its expiry as expired', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const issued = await issueCode(app, cookie, space.id, member.id)
      harness.clock.advance(ACCESS_CODE_TTL_MS + 1000)
      const freshCookie = await signInAndGetCookie(app)

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${space.id}/access-codes`,
        headers: { cookie: freshCookie },
      })
      expect(response.json()[0].status).toBe('expired')
      expect(response.json()[0].id).toBe(issued.id)
    })
  })

  test('requires administrative authentication', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/spaces/${space.id}/access-codes`,
      })
      expect(response.statusCode).toBe(401)
    })
  })
})

describe('POST /api/v1/spaces/:spaceId/access-codes/:codeId/revoke', () => {
  test('revokes a live code', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const issued = await issueCode(app, cookie, space.id, member.id)
      harness.clock.advance(1000)

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie, ...MARKER },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: issued.id, status: 'revoked' })
      expect(response.json().statusChangedAt).toBe(harness.clock.now().toISOString())

      const rows = await harness.db
        .select({ status: accessCodes.status })
        .from(accessCodes)
        .where(eq(accessCodes.id, issued.id))
      expect(rows[0]?.status).toBe('revoked')
    })
  })

  test('refuses to revoke twice, and answers 404 for an unknown code', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const issued = await issueCode(app, cookie, space.id, member.id)

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie, ...MARKER },
      })
      expect(first.statusCode).toBe(200)

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie, ...MARKER },
      })
      expect(second.statusCode).toBe(409)
      expect(second.json().error.code).toBe('access_code_revoked')

      const unknown = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/00000000-0000-7000-8000-000000000000/revoke`,
        headers: { cookie, ...MARKER },
      })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json().error.code).toBe('access_code_not_found')
    })
  })

  test('answering access_code_expired for an issued-but-expired code', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const issued = await issueCode(app, cookie, space.id, member.id)
      harness.clock.advance(ACCESS_CODE_TTL_MS + 1000)
      const freshCookie = await signInAndGetCookie(app)

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie: freshCookie, ...MARKER },
      })
      expect(response.statusCode).toBe(410)
      expect(response.json().error.code).toBe('access_code_expired')
    })
  })

  test('refuses to revoke a code of another space or a redeemed one', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const member = await harness.createMember(family.id, { name: 'Аня' })
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const issued = await issueCode(app, cookie, family.id, member.id)

      const crossSpace = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${other.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie, ...MARKER },
      })
      expect(crossSpace.statusCode).toBe(404)

      await app.inject({
        method: 'POST',
        url: '/api/v1/access-codes/redeem',
        payload: { code: issued.code },
      })
      const redeemed = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${family.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie, ...MARKER },
      })
      expect(redeemed.statusCode).toBe(409)
      expect(redeemed.json().error.code).toBe('access_code_used')
    })
  })

  test('requires the marker header', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const cookie = await signInAndGetCookie(app)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/00000000-0000-7000-8000-000000000000/revoke`,
        headers: { cookie },
      })
      expect(response.statusCode).toBe(403)
    })
  })
})
