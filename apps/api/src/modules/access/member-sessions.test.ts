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
import {
  ACCESS_CODE_TTL_MS,
  describeDevice,
  MEMBER_SESSION_TOUCH_INTERVAL_MS,
  MEMBER_SESSION_TTL_MS,
  memberSessionCookieName,
} from './index.ts'
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

/** The session id of the session that made the request (the `current` row). */
async function currentSessionId(app: TestApp, session: MemberSession): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/me/sessions',
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  const current = (response.json() as Array<{ id: string; current: boolean }>).find(
    (row) => row.current,
  )
  if (current === undefined) throw new Error('The session list marked no row as current')
  return current.id
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

describe('describeDevice', () => {
  test.each([
    [
      'chrome on windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      { browser: 'Chrome', platform: 'Windows' },
    ],
    [
      'edge on windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      { browser: 'Edge', platform: 'Windows' },
    ],
    [
      'safari on iphone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      { browser: 'Safari', platform: 'iPhone' },
    ],
    [
      'chrome on iphone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
      { browser: 'Chrome', platform: 'iPhone' },
    ],
    [
      'firefox on iphone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
      { browser: 'Firefox', platform: 'iPhone' },
    ],
    [
      'the installed home-screen app, which omits the Safari token',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      { browser: '', platform: 'iPhone' },
    ],
    [
      'safari on ipad',
      'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      { browser: 'Safari', platform: 'iPad' },
    ],
    [
      'chrome on android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      { browser: 'Chrome', platform: 'Android' },
    ],
    [
      'firefox on linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
      { browser: 'Firefox', platform: 'Linux' },
    ],
    [
      'safari on macos',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      { browser: 'Safari', platform: 'macOS' },
    ],
  ] as const)('reads %s', (_label, userAgent, expected) => {
    expect(describeDevice(userAgent)).toEqual(expected)
  })

  // iPadOS 13+ Safari sends the desktop Mac agent; server-side such an
  // iPad is indistinguishable from a Mac and reads as macOS.
  test('cannot tell an iPad in desktop-agent mode from a Mac', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ),
    ).toEqual({ browser: 'Safari', platform: 'macOS' })
  })

  test.each([
    ['no header', undefined],
    ['empty header', ''],
    ['a crawler with no browser or platform', 'pytest-httpserver'],
  ] as const)('stores nothing for %s', (_label, userAgent) => {
    expect(describeDevice(userAgent)).toEqual({ browser: '', platform: '' })
  })
})

describe('the device review (ADR-0005)', () => {
  test('redemption records the device description from the user agent', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/access-codes/redeem',
        payload: { code: issued.code },
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      })
      expect(response.statusCode).toBe(200)

      const rows = await harness.db
        .select({ browser: memberSessions.browser, platform: memberSessions.platform })
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows[0]).toEqual({ browser: 'Chrome', platform: 'Windows' })
    })
  })

  test('lists own sessions with device, created, last used, and the current mark', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const phone = await issueCode(app, adminCookie, space.id, member.id)
      const phoneSession = sessionFrom(
        await app.inject({
          method: 'POST',
          url: '/api/v1/access-codes/redeem',
          payload: { code: phone.code },
          headers: {
            'user-agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          },
        }),
      )
      harness.clock.advance(60_000)
      const laptop = await issueCode(app, adminCookie, space.id, member.id)
      const laptopSession = sessionFrom(
        await app.inject({
          method: 'POST',
          url: '/api/v1/access-codes/redeem',
          payload: { code: laptop.code },
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
          },
        }),
      )

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me/sessions',
        headers: memberHeaders(laptopSession),
      })
      expect(response.statusCode).toBe(200)
      const sessions = response.json()
      expect(sessions).toHaveLength(2)
      // Last used first: the laptop signed in a minute after the phone.
      expect(
        sessions.map((row: { browser: string; platform: string }) => [row.browser, row.platform]),
      ).toEqual([
        ['Safari', 'macOS'],
        ['Safari', 'iPhone'],
      ])
      const current = sessions.filter((row: { current: boolean }) => row.current)
      expect(current).toHaveLength(1)
      expect(current[0]).toMatchObject({ browser: 'Safari', platform: 'macOS' })
      for (const row of sessions) {
        expect(row.createdAt).toBeTypeOf('string')
        expect(row.lastUsedAt).toBeTypeOf('string')
        expect(Object.keys(row).sort()).toEqual([
          'browser',
          'createdAt',
          'current',
          'id',
          'lastUsedAt',
          'platform',
        ])
      }
      // The same list seen from the phone marks the phone's row instead.
      const fromPhone = await app.inject({
        method: 'GET',
        url: '/api/v1/me/sessions',
        headers: memberHeaders(phoneSession),
      })
      const phoneRow = fromPhone.json().find((row: { current: boolean }) => row.current)
      expect(phoneRow).toMatchObject({ browser: 'Safari', platform: 'iPhone' })
    })
  })

  test('authentication stamps last used at most once per interval', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))
      const lastUsedAtOf = async () => {
        const rows = await harness.db
          .select({ lastUsedAt: memberSessions.lastUsedAt })
          .from(memberSessions)
          .where(eq(memberSessions.memberId, member.id))
        return rows[0]?.lastUsedAt.getTime() ?? 0
      }
      const created = await lastUsedAtOf()
      expect(created).toBe(harness.clock.now().getTime())

      // Requests inside the interval leave the stamp alone.
      harness.clock.advance(MEMBER_SESSION_TOUCH_INTERVAL_MS / 2)
      const inside = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(session),
      })
      expect(inside.statusCode).toBe(200)
      expect(await lastUsedAtOf()).toBe(created)

      // Past the interval the stamp follows the clock.
      harness.clock.advance(MEMBER_SESSION_TOUCH_INTERVAL_MS)
      const later = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(session),
      })
      expect(later.statusCode).toBe(200)
      expect(await lastUsedAtOf()).toBe(harness.clock.now().getTime())
    })
  })

  test('revokes one of the member’s own sessions and keeps the others', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const first = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, member.id)).code),
      )
      harness.clock.advance(1000)
      const second = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, member.id)).code),
      )
      const secondId = await currentSessionId(app, second)

      // The laptop revokes the phone's session; its own stays.
      const revoke = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/sessions/${secondId}`,
        headers: memberHeaders(first),
      })
      expect(revoke.statusCode).toBe(204)

      const gone = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(second),
      })
      expect(gone.statusCode).toBe(401)
      const alive = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(first),
      })
      expect(alive.statusCode).toBe(200)
    })
  })

  test('revoking the current session clears the cookie and ends it', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const first = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, member.id)).code),
      )
      harness.clock.advance(1000)
      const second = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, space.id, member.id)).code),
      )
      const secondId = await currentSessionId(app, second)

      const revoke = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/sessions/${secondId}`,
        headers: memberHeaders(second),
      })
      expect(revoke.statusCode).toBe(204)
      const raw = revoke.headers['set-cookie']
      const header = Array.isArray(raw) ? raw.join('\n') : (raw ?? '')
      expect(header).toContain('Max-Age=0')

      const gone = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(second),
      })
      expect(gone.statusCode).toBe(401)
      const alive = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(first),
      })
      expect(alive.statusCode).toBe(200)
    })
  })

  test('a foreign or unknown session id answers 404 without touching anything', async () => {
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
      const dimaSessionId = await currentSessionId(app, dimaSession)

      const unknown = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/sessions/01900000-0000-7000-8000-0000000000ff',
        headers: memberHeaders(anyaSession),
      })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json().error.code).toBe('member_session_not_found')

      // Another member's session id is a resource Аня cannot see: 404, and
      // Дима keeps his session.
      const foreign = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/sessions/${dimaSessionId}`,
        headers: memberHeaders(anyaSession),
      })
      expect(foreign.statusCode).toBe(404)
      const dimaAlive = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(dimaSession),
      })
      expect(dimaAlive.statusCode).toBe(200)
    })
  })

  test('an expired session stops authenticating, and the next sign-in sweeps it', async () => {
    const space = await harness.createSpace()
    const member = await harness.createMember(space.id, { name: 'Аня' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const issued = await issueCode(app, adminCookie, space.id, member.id)
      const session = sessionFrom(await redeem(app, issued.code))
      harness.clock.advance(MEMBER_SESSION_TTL_MS + 60_000)

      const gone = await app.inject({
        method: 'GET',
        url: '/api/v1/me/sessions',
        headers: memberHeaders(session),
      })
      expect(gone.statusCode).toBe(401)

      // The next sign-in sweeps expired rows, so the review never fills
      // with dead devices. The administrative session of the arrange step
      // has expired with the same clock, so it signs in again.
      const freshAdminCookie = await signInAdmin(app)
      const next = sessionFrom(
        await redeem(app, (await issueCode(app, freshAdminCookie, space.id, member.id)).code),
      )
      expect(next.memberId).toBe(member.id)
      const rows = await harness.db
        .select({ id: memberSessions.id })
        .from(memberSessions)
        .where(eq(memberSessions.memberId, member.id))
      expect(rows).toHaveLength(1)
    })
  })
})

describe('several members on one device', () => {
  test('sessions in two spaces coexist without granting any cross-space access', async () => {
    const family = await harness.createSpace({ name: 'Наша семья' })
    const dacha = await harness.createSpace({ name: 'Дача' })
    const anya = await harness.createMember(family.id, { name: 'Аня' })
    await harness.createMember(family.id, { name: 'Дима' })
    const pyotr = await harness.createMember(dacha.id, { name: 'Пётр' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anyaSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, family.id, anya.id)).code),
      )
      harness.clock.advance(1000)
      // The same device adds a second sign-in; the first one must not care.
      const pyotrSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, dacha.id, pyotr.id)).code),
      )

      const anyaStill = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(anyaSession),
      })
      expect(anyaStill.statusCode).toBe(200)
      expect(anyaStill.json().space.name).toBe('Наша семья')

      // Member A's name with only member B's cookie is rejected, whichever
      // way the pair points.
      for (const [header, cookie] of [
        [anyaSession.memberId, pyotrSession.cookie],
        [pyotrSession.memberId, anyaSession.cookie],
      ] as const) {
        const rejected = await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { 'x-ohana-member': header, cookie },
        })
        expect(rejected.statusCode).toBe(401)
      }

      // A browser sends every retained cookie; only the one named for the
      // header member decides.
      const bothCookies = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          'x-ohana-member': anyaSession.memberId,
          cookie: `${anyaSession.cookie}; ${pyotrSession.cookie}`,
        },
      })
      expect(bothCookies.statusCode).toBe(200)
      expect(bothCookies.json().space.name).toBe('Наша семья')

      // No cross-space access through the retained sign-ins.
      const profiles = await app.inject({
        method: 'GET',
        url: '/api/v1/members',
        headers: memberHeaders(anyaSession),
      })
      expect(profiles.statusCode).toBe(200)
      expect(JSON.stringify(profiles.json())).not.toContain('Пётр')

      const anyaSessions = await app.inject({
        method: 'GET',
        url: '/api/v1/me/sessions',
        headers: memberHeaders(anyaSession),
      })
      expect(anyaSessions.statusCode).toBe(200)
      expect(anyaSessions.json()).toHaveLength(1)
    })
  })

  test('signing out of one member ends only that session', async () => {
    const family = await harness.createSpace()
    const dacha = await harness.createSpace()
    const anya = await harness.createMember(family.id, { name: 'Аня' })
    const pyotr = await harness.createMember(dacha.id, { name: 'Пётр' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const anyaSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, family.id, anya.id)).code),
      )
      const pyotrSession = sessionFrom(
        await redeem(app, (await issueCode(app, adminCookie, dacha.id, pyotr.id)).code),
      )

      const signOut = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/session',
        headers: memberHeaders(anyaSession),
      })
      expect(signOut.statusCode).toBe(204)

      const anyaGone = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(anyaSession),
      })
      expect(anyaGone.statusCode).toBe(401)
      const pyotrAlive = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: memberHeaders(pyotrSession),
      })
      expect(pyotrAlive.statusCode).toBe(200)
    })
  })
})
