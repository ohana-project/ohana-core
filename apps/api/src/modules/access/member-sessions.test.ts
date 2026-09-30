import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { members as memberRows } from '../members/tables.ts'
import { ACCESS_CODE_TTL_MS, MEMBER_SESSION_TTL_MS, memberSessionCookieName } from './index.ts'
import { accessCodes, memberSessions } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'member-sessions-admin-password'

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

async function redeem(app: TestApp, code: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/access-codes/redeem',
    payload: { code },
  })
}

interface MemberSession {
  memberId: string
  cookie: string
}

function sessionFrom(response: Awaited<ReturnType<typeof redeem>>): MemberSession {
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

describe('POST /api/v1/access-codes/redeem', () => {
  test('signs the member in with a cookie named for them', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)

      const response = await redeem(app, issued.code.toLowerCase().replace('-', ''))
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        member: { id: member.id, name: 'Аня', role: 'regular' },
        space: { id: space.id, name: 'Наша семья' },
        needsOnboarding: true,
      })
      const session = sessionFrom(response)
      expect(session.memberId).toBe(member.id)

      const rows = await harness.db
        .select()
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.expiresAt.getTime()).toBe(
        harness.clock.now().getTime() + MEMBER_SESSION_TTL_MS,
      )
    })
  })

  test('sets a Secure, HttpOnly, SameSite cookie scoped to /api', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)

      const response = await redeem(app, issued.code)
      const raw = response.headers['set-cookie']
      const header = Array.isArray(raw) ? raw.join('\n') : (raw ?? '')
      expect(header).toContain(`${memberSessionCookieName(member.id)}=`)
      expect(header).toContain('Path=/api')
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Secure')
      expect(header).toContain('SameSite=Lax')
    })
  })

  test('accepts any letter case, with or without the hyphen', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      for (const form of ['lower', 'hyphen', 'spaced'] as const) {
        const issued = await issueCode(app, adminCookie, space.id, member.id)
        harness.clock.advance(1000)
        const typed =
          form === 'lower'
            ? issued.code.toLowerCase()
            : form === 'hyphen'
              ? issued.code
              : ` ${issued.code.slice(0, 4)}-${issued.code.slice(4)} `
        const response = await redeem(app, typed)
        expect(response.statusCode).toBe(200)
      }
    })
  })

  test.each([
    ['wrong', 'ZZZZ-ZZZZ', 'access_code_invalid', 401],
    ['malformed', 'abc', 'access_code_invalid', 401],
    ['never-issued-shape', 'AAAA2O25', 'access_code_invalid', 401],
  ] as const)('rejects a %s code', async (_label, code, expectedCode, expectedStatus) => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const response = await redeem(app, code)
      expect(response.statusCode).toBe(expectedStatus)
      expect(response.json().error.code).toBe(expectedCode)
      expect(() => sessionFrom(response)).toThrow()
      const rows = await harness.db
        .select()
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(0)
    })
  })

  test('rejects an expired code and materialises its status', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      harness.clock.advance(ACCESS_CODE_TTL_MS + 60_000)

      const response = await redeem(app, issued.code)
      expect(response.statusCode).toBe(410)
      expect(response.json().error.code).toBe('access_code_expired')

      const rows = await harness.db
        .select({ status: accessCodes.status })
        .from(accessCodes)
        .where(eq(accessCodes.id, issued.id))
      expect(rows[0]?.status).toBe('expired')
    })
  })

  test('a code redeems exactly once', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)

      const first = await redeem(app, issued.code)
      expect(first.statusCode).toBe(200)
      const second = await redeem(app, issued.code)
      expect(second.statusCode).toBe(409)
      expect(second.json().error.code).toBe('access_code_used')
      expect(() => sessionFrom(second)).toThrow()

      const rows = await harness.db
        .select()
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(1)
    })
  })

  test('a replaced code is refused and the replacement works', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const first = await issueCode(app, adminCookie, space.id, member.id)
      harness.clock.advance(1000)
      const second = await issueCode(app, adminCookie, space.id, member.id)

      const stale = await redeem(app, first.code)
      expect(stale.statusCode).toBe(409)
      expect(stale.json().error.code).toBe('access_code_replaced')

      const fresh = await redeem(app, second.code)
      expect(fresh.statusCode).toBe(200)
    })
  })

  test('of two concurrent redemptions exactly one wins', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)

      const [first, second] = await Promise.all([
        redeem(app, issued.code),
        redeem(app, issued.code),
      ])
      const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 409])
      const refused = first.statusCode === 409 ? first : second
      expect(refused.json().error.code).toBe('access_code_used')

      const rows = await harness.db
        .select()
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(1)
    })
  })

  test('a revoked code is refused', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const revoke = await app.inject({
        method: 'POST',
        url: `/api/v1/spaces/${space.id}/access-codes/${issued.id}/revoke`,
        headers: { cookie: adminCookie, [ADMIN_MARKER_HEADER]: '1' },
      })
      expect(revoke.statusCode).toBe(200)

      const response = await redeem(app, issued.code)
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('access_code_revoked')
    })
  })
})

describe('member session guard', () => {
  test('accepts the member header with that member’s own cookie', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        member: {
          id: member.id,
          name: 'Аня',
          role: 'regular',
          createdAt: expect.any(String),
        },
        space: { id: space.id, name: space.name },
        needsOnboarding: true,
      })
    })
  })

  test('refuses requests without the header, the cookie, or with the wrong pair', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня' })
    const dima = await harness.createMember(space.id, { name: 'Дима' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anyaCode = await issueCode(app, adminCookie, space.id, anya.id)
      const dimaCode = await issueCode(app, adminCookie, space.id, dima.id)
      const anyaSession = sessionFrom(await redeem(app, anyaCode.code))
      const dimaSession = sessionFrom(await redeem(app, dimaCode.code))

      const withoutHeader = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { cookie: anyaSession.cookie },
      })
      expect(withoutHeader.statusCode).toBe(401)

      const withoutCookie = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { 'x-ohana-member': anyaSession.memberId },
      })
      expect(withoutCookie.statusCode).toBe(401)

      const strangerCookie = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { 'x-ohana-member': dimaSession.memberId, cookie: anyaSession.cookie },
      })
      expect(strangerCookie.statusCode).toBe(401)

      // An administrative session never authorises a member route.
      const adminSessionOnMemberRoute = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { 'x-ohana-member': anyaSession.memberId, cookie: adminCookie },
      })
      expect(adminSessionOnMemberRoute.statusCode).toBe(401)
    })
  })

  test('a member cookie never authorises an administrative route', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/session',
        headers: { cookie: session.cookie },
      })
      expect(response.statusCode).toBe(401)
    })
  })

  test('replacing a code does not end existing sessions, and new sign-ins add sessions', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const first = await issueCode(app, adminCookie, space.id, member.id)
      const firstSession = sessionFrom(await redeem(app, first.code))
      harness.clock.advance(1000)

      // The replacement invalidates the unused code, not the live session.
      const second = await issueCode(app, adminCookie, space.id, member.id)
      const stillActive = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(firstSession),
      })
      expect(stillActive.statusCode).toBe(200)

      // A second redemption adds a second independent session.
      const secondSession = sessionFrom(await redeem(app, second.code))
      const rows = await harness.db
        .select()
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(2)
      for (const candidate of [firstSession, secondSession]) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: memberHeaders(candidate),
        })
        expect(response.statusCode).toBe(200)
      }
    })
  })
})

describe('onboarding and profiles', () => {
  test('onboarding writes the optional profile and stamps the member onboarded', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/me/onboarding',
        payload: {
          displayName: 'Аня Смирнова',
          email: ' anya@example.com ',
          phone: '+7 900 000-00-00',
          interfaceLanguage: 'ru',
        },
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(200)
      const me = response.json()
      expect(me.needsOnboarding).toBe(false)
      expect(me.member).toMatchObject({
        displayName: 'Аня Смирнова',
        email: 'anya@example.com',
        phone: '+7 900 000-00-00',
        interfaceLanguage: 'ru',
      })

      const stored = await harness.db
        .select({ onboardedAt: memberRows.onboardedAt })
        .from(memberRows)
        .where(eq(memberRows.id, member.id))
      expect(stored[0]?.onboardedAt).toEqual(harness.clock.now())

      // The next sign-in skips onboarding.
      const next = await issueCode(app, adminCookie, space.id, member.id)
      const again = await redeem(app, next.code)
      expect(again.statusCode).toBe(200)
      expect(again.json().needsOnboarding).toBe(false)
    })
  })

  test('rejects a too-short contact without storing anything', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/me/onboarding',
        payload: { email: ' a ' },
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('validation_failed')

      const stored = await harness.db
        .select({ onboardedAt: memberRows.onboardedAt, displayName: memberRows.displayName })
        .from(memberRows)
        .where(eq(memberRows.id, member.id))
      expect(stored[0]).toMatchObject({ onboardedAt: null, displayName: null })
    })
  })

  test('a member sees their space’s profiles and never another space’s', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const anya = await harness.createMember(family.id, { name: 'Аня' })
    await harness.createMember(family.id, { name: 'Дима' })
    await harness.createMember(other.id, { name: 'Пётр' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, family.id, anya.id)
      const session = sessionFrom(await redeem(app, issued.code))

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/members',
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(200)
      const names = response.json().map((profile: { name: string }) => profile.name)
      expect(names).toEqual(['Аня', 'Дима'])
      expect(JSON.stringify(response.json())).not.toContain('Пётр')
    })
  })

  test('sign-out with a mismatched cookie deletes nothing', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня' })
    const dima = await harness.createMember(space.id, { name: 'Дима' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anyaSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, anya.id)).code),
      )
      const dimaSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, dima.id)).code),
      )

      // The cookie is looked up under the header member's name, so Дима's
      // cookie is not even read when the request names Аня — both sessions
      // survive the mismatched request.
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/session',
        headers: { 'x-ohana-member': anyaSession.memberId, cookie: dimaSession.cookie },
      })
      expect(response.statusCode).toBe(204)
      for (const session of [anyaSession, dimaSession]) {
        const alive = await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: memberHeaders(session),
        })
        expect(alive.statusCode).toBe(200)
      }
    })
  })

  test('sign-out refuses to spend another member’s token under a foreign cookie name', async () => {
    const space = await harness.createSpace()
    const anya = await harness.createMember(space.id, { name: 'Аня' })
    const dima = await harness.createMember(space.id, { name: 'Дима' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anyaSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, anya.id)).code),
      )
      const dimaSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, dima.id)).code),
      )

      // Дима's token disguised as Аня's cookie: the delete is scoped to the
      // named member, so the token deletes nothing — not even its own
      // session, which belongs to Дима.
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/session',
        headers: {
          'x-ohana-member': anyaSession.memberId,
          cookie: `${memberSessionCookieName(anyaSession.memberId)}=${dimaSession.cookie.split('=')[1]}`,
        },
      })
      expect(response.statusCode).toBe(204)
      for (const session of [anyaSession, dimaSession]) {
        const alive = await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: memberHeaders(session),
        })
        expect(alive.statusCode).toBe(200)
      }
    })
  })

  test('sign-out deletes the session and clears the cookie', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/session',
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(204)
      const raw = response.headers['set-cookie']
      const header = Array.isArray(raw) ? raw.join('\n') : (raw ?? '')
      expect(header).toContain('Max-Age=0')

      const after = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(session),
      })
      expect(after.statusCode).toBe(401)
      const rows = await harness.db
        .select()
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(0)
    })
  })
})
