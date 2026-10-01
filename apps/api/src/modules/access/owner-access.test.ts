import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { ACCESS_CODE_ALPHABET } from './index.ts'
import { accessCodes, memberSessions } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'owner-access-admin-password'

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

async function issueCodeAsAdmin(app: TestApp, cookie: string, spaceId: string, memberId: string) {
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

/**
 * Signs in the space's owner and one regular member, returning both
 * sessions: the pairs of members every access rule below is tested with.
 */
async function arrangeOwnerAndRegular(app: TestApp, spaceId: string, adminCookie: string) {
  const owner = await harness.createMember(spaceId, { name: 'Аня', role: 'owner' })
  const regular = await harness.createMember(spaceId, { name: 'Дима', role: 'regular' })
  const ownerSession = await signInMember(
    app,
    (await issueCodeAsAdmin(app, adminCookie, spaceId, owner.id)).code,
  )
  const regularSession = await signInMember(
    app,
    (await issueCodeAsAdmin(app, adminCookie, spaceId, regular.id)).code,
  )
  return { owner, regular, ownerSession, regularSession }
}

describe('POST /api/v1/members/:memberId/access-code (owner issues a code)', () => {
  test('an owner issues a code, shown once, stored only as a hash', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { owner, regular, ownerSession } = await arrangeOwnerAndRegular(
        app,
        space.id,
        adminCookie,
      )

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.code).toMatch(
        new RegExp(`^[${ACCESS_CODE_ALPHABET}]{4}-[${ACCESS_CODE_ALPHABET}]{4}$`),
      )
      expect(body.memberId).toBe(regular.id)
      expect(body.status).toBe('issued')

      // The arrange step already redeemed one code for the regular member;
      // the owner's issue adds the one live code.
      const rows = await harness.db
        .select()
        .from(accessCodes)
        .where(and(eq(accessCodes.memberId, regular.id), eq(accessCodes.status, 'issued')))
      expect(rows).toHaveLength(1)
      const stored = rows[0]
      if (stored === undefined) throw new Error('The issued code row is missing')
      // The owner issued it, not the administrator (ADR-0005).
      expect(stored.issuerMemberId).toBe(owner.id)
      expect(stored.issuerAdministratorId).toBeNull()
      const plain = body.code.replace('-', '')
      expect(JSON.stringify(stored)).not.toContain(plain)
    })
  })

  test('issuing replaces the member’s older unused code', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, ownerSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(first.statusCode).toBe(201)

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(second.statusCode).toBe(201)
      expect(second.json().code).not.toBe(first.json().code)

      // The arrange step's code is already redeemed; of the owner's two
      // issues, the first is replaced and only the second stays live.
      const rows = await harness.db
        .select()
        .from(accessCodes)
        .where(
          and(
            eq(accessCodes.memberId, regular.id),
            eq(accessCodes.issuerMemberId, ownerSession.memberId),
          ),
        )
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.status).sort()).toEqual(['issued', 'replaced'])
    })
  })

  test('a regular member is rejected', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, regularSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(regularSession),
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')
    })
  })

  test('an owner cannot issue for a member of another space', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { ownerSession } = await arrangeOwnerAndRegular(app, family.id, adminCookie)
      const stranger = await harness.createMember(other.id, { name: 'Пётр', role: 'regular' })

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${stranger.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('member_not_found')

      const rows = await harness.db
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.memberId, stranger.id))
      expect(rows).toHaveLength(0)
    })
  })
})

describe('GET /api/v1/members/:memberId/access-code (owner reads the code status)', () => {
  test('the current code carries its derived status', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, ownerSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      const issued = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(issued.statusCode).toBe(200)
      expect(issued.json().status).toBe('issued')

      await signInMember(app, created.json().code)
      const redeemed = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(redeemed.statusCode).toBe(200)
      expect(redeemed.json().status).toBe('redeemed')
    })
  })

  test('a member with no codes answers access_code_not_found', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { ownerSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)
      // A provisioned member who has never been issued a code.
      const newcomer = await harness.createMember(space.id, { name: 'Люда', role: 'regular' })

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${newcomer.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('access_code_not_found')
    })
  })
})

describe('DELETE /api/v1/members/:memberId/access-code (owner revokes the live code)', () => {
  test('revoking the outstanding code invalidates it for redemption', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, ownerSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      const issued = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      const revoked = await app.inject({
        method: 'DELETE',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(revoked.statusCode).toBe(200)
      expect(revoked.json().status).toBe('revoked')
      expect(revoked.json().id).toBe(issued.json().id)

      const spent = await app.inject({
        method: 'POST',
        url: '/api/v1/access-codes/redeem',
        payload: { code: issued.json().code },
      })
      expect(spent.statusCode).toBe(409)
      expect(spent.json().error.code).toBe('access_code_revoked')
    })
  })

  test('a member without a live code answers access_code_not_found', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, ownerSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('access_code_not_found')
    })
  })
})

describe('GET /api/v1/members/:memberId/sessions (owner reviews devices)', () => {
  test('an owner sees the member’s live sessions', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, ownerSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      // A second device for the regular member.
      const secondCode = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      await signInMember(app, secondCode.json().code)

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${regular.id}/sessions`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(200)
      const rows = response.json()
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        id: expect.any(String),
        browser: expect.any(String),
        platform: expect.any(String),
        createdAt: expect.any(String),
        lastUsedAt: expect.any(String),
      })
    })
  })

  test('a regular member is rejected', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { regular, regularSession } = await arrangeOwnerAndRegular(app, space.id, adminCookie)

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${regular.id}/sessions`,
        headers: memberHeaders(regularSession),
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')
    })
  })
})

describe('DELETE /api/v1/members/:memberId/sessions (owner disconnects devices)', () => {
  test('every session of the member dies and other members keep theirs', async () => {
    const space = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { owner, regular, ownerSession, regularSession } = await arrangeOwnerAndRegular(
        app,
        space.id,
        adminCookie,
      )

      // A second device for the regular member.
      const secondCode = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${regular.id}/access-code`,
        headers: memberHeaders(ownerSession),
      })
      const secondDevice = await signInMember(app, secondCode.json().code)

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/members/${regular.id}/sessions`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(204)

      // Both of the regular member's sessions are gone.
      for (const device of [regularSession, secondDevice]) {
        const probe = await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: memberHeaders(device),
        })
        expect(probe.statusCode).toBe(401)
      }
      // The owner's own session survives.
      const ownerProbe = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(ownerSession),
      })
      expect(ownerProbe.statusCode).toBe(200)

      const remaining = await harness.db
        .select()
        .from(memberSessions)
        .where(and(eq(memberSessions.spaceId, space.id), eq(memberSessions.memberId, owner.id)))
      expect(remaining.length).toBeGreaterThan(0)
    })
  })

  test('disconnecting does not touch another space’s member', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const { ownerSession } = await arrangeOwnerAndRegular(app, family.id, adminCookie)
      const strangerCode = await issueCodeAsAdmin(
        app,
        adminCookie,
        other.id,
        (await harness.createMember(other.id, { name: 'Пётр', role: 'regular' })).id,
      )
      const stranger = await signInMember(app, strangerCode.code)

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/members/${stranger.memberId}/sessions`,
        headers: memberHeaders(ownerSession),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('member_not_found')

      const probe = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(stranger),
      })
      expect(probe.statusCode).toBe(200)
    })
  })
})
