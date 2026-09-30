import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
  resetAdminPassword,
} from './index.ts'
import { administrators, adminSessions } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const INITIAL_PASSWORD = 'first-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

/** Wipes bootstrap state so every test starts without an administrator. */
async function wipeAdministrators(): Promise<void> {
  await harness.db.delete(adminSessions)
  await harness.db.delete(administrators)
}

/** Bootstraps a known administrator, isolated from the other tests. */
async function freshAdmin(password: string = INITIAL_PASSWORD): Promise<void> {
  await wipeAdministrators()
  expect(await ensureInitialAdministrator(harness, password)).toBe('created')
}

function sessionTokenOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((candidate) => candidate.name === ADMIN_SESSION_COOKIE)
  if (cookie === undefined) throw new Error('The response set no administrative session cookie')
  return cookie.value
}

async function signIn(app: ReturnType<TestHarness['buildTestApp']>, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    payload: { password },
    headers: MARKER,
  })
}

async function signedInCookie(password: string = INITIAL_PASSWORD): Promise<string> {
  const app = harness.buildTestApp()
  await app.ready()
  try {
    const response = await signIn(app, password)
    expect(response.statusCode).toBe(204)
    return sessionTokenOf(response)
  } finally {
    await app.close()
  }
}

describe('first-administrator bootstrap', () => {
  test('creates the first administrator from deployment configuration', async () => {
    await wipeAdministrators()
    await expect(ensureInitialAdministrator(harness, INITIAL_PASSWORD)).resolves.toBe('created')
  })

  test('never overwrites an existing administrator from configuration', async () => {
    await wipeAdministrators()
    await expect(ensureInitialAdministrator(harness, INITIAL_PASSWORD)).resolves.toBe('created')
    await expect(ensureInitialAdministrator(harness, 'a-completely-new-password')).resolves.toBe(
      'exists',
    )
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const stale = await signIn(app, 'a-completely-new-password')
      expect(stale.statusCode).toBe(401)
      const original = await signIn(app, INITIAL_PASSWORD)
      expect(original.statusCode).toBe(204)
    } finally {
      await app.close()
    }
  })

  test('reports unconfigured when no administrator exists and no password is set', async () => {
    await wipeAdministrators()
    await expect(ensureInitialAdministrator(harness, undefined)).resolves.toBe('unconfigured')
    await expect(ensureInitialAdministrator(harness, INITIAL_PASSWORD)).resolves.toBe('created')
  })
})

describe('POST /api/v1/admin/session', () => {
  test('rejects a wrong password', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await signIn(app, 'totally-wrong-password')
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: { code: 'invalid_credentials', message: expect.any(String) },
      })
      expect(response.cookies).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  test('signs in with the bootstrap password and sets an HttpOnly cookie', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await signIn(app, INITIAL_PASSWORD)
      expect(response.statusCode).toBe(204)
      const cookie = response.cookies.find((candidate) => candidate.name === ADMIN_SESSION_COOKIE)
      expect(cookie).toBeDefined()
      expect(cookie?.httpOnly).toBe(true)
      expect(cookie?.secure).toBe(true)
      expect(cookie?.sameSite?.toLowerCase()).toBe('lax')
      expect(cookie?.path).toBe('/api/v1/admin')
    } finally {
      await app.close()
    }
  })

  test('rejects a state-changing administrative request without the marker header', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        payload: { password: INITIAL_PASSWORD },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('missing_admin_header')
      expect(response.cookies).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})

describe('administrative routes require an administrative session', () => {
  test('GET /api/v1/admin/session without a session is unauthorized', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/admin/session' })
      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('unauthorized')
    } finally {
      await app.close()
    }
  })

  test('POST /api/v1/admin/password without a session is unauthorized', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/password',
        payload: { currentPassword: INITIAL_PASSWORD, newPassword: 'a-fresh-password' },
        headers: MARKER,
      })
      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('unauthorized')
    } finally {
      await app.close()
    }
  })

  test('an unknown or unrelated cookie is unauthorized', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/session',
        cookies: { [ADMIN_SESSION_COOKIE]: 'not-a-real-session-token' },
      })
      expect(response.statusCode).toBe(401)
      const foreign = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/session',
        cookies: { ohana_member_session: 'some-other-session' },
      })
      expect(foreign.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('administrative session lifecycle', () => {
  test('the cookie grants access, sign-out ends it, and an expired session is unauthorized', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const first = await signIn(app, INITIAL_PASSWORD)
      const firstToken = sessionTokenOf(first)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/admin/session',
            cookies: { [ADMIN_SESSION_COOKIE]: firstToken },
          })
        ).statusCode,
      ).toBe(204)

      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/api/v1/admin/session',
            cookies: { [ADMIN_SESSION_COOKIE]: firstToken },
            headers: MARKER,
          })
        ).statusCode,
      ).toBe(204)

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/admin/session',
            cookies: { [ADMIN_SESSION_COOKIE]: firstToken },
          })
        ).statusCode,
      ).toBe(401)

      const second = await signIn(app, INITIAL_PASSWORD)
      const secondToken = sessionTokenOf(second)
      harness.clock.advance(24 * 60 * 60 * 1000 + 1)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/admin/session',
            cookies: { [ADMIN_SESSION_COOKIE]: secondToken },
          })
        ).statusCode,
      ).toBe(401)
    } finally {
      await app.close()
    }
  })

  test('sign-out clears the cookie in the response', async () => {
    await freshAdmin()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const signedIn = await signIn(app, INITIAL_PASSWORD)
      const signedOut = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/session',
        cookies: { [ADMIN_SESSION_COOKIE]: sessionTokenOf(signedIn) },
        headers: MARKER,
      })
      expect(signedOut.statusCode).toBe(204)
      expect(signedOut.headers['set-cookie'] as string).toContain(`${ADMIN_SESSION_COOKIE}=;`)
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/admin/password', () => {
  test('changes the password, after which the old one no longer works', async () => {
    await freshAdmin()
    const token = await signedInCookie()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const changed = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/password',
        payload: { currentPassword: INITIAL_PASSWORD, newPassword: 'a-considerably-new-password' },
        cookies: { [ADMIN_SESSION_COOKIE]: token },
        headers: MARKER,
      })
      expect(changed.statusCode).toBe(204)

      const oldPassword = await signIn(app, INITIAL_PASSWORD)
      expect(oldPassword.statusCode).toBe(401)
      const newPassword = await signIn(app, 'a-considerably-new-password')
      expect(newPassword.statusCode).toBe(204)
    } finally {
      await app.close()
    }
  })

  test('rejects a wrong current password', async () => {
    await freshAdmin()
    const token = await signedInCookie()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const changed = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/password',
        payload: {
          currentPassword: 'not-the-current-one',
          newPassword: 'a-considerably-new-password',
        },
        cookies: { [ADMIN_SESSION_COOKIE]: token },
        headers: MARKER,
      })
      expect(changed.statusCode).toBe(401)
      expect(changed.json().error.code).toBe('invalid_credentials')
    } finally {
      await app.close()
    }
  })

  test('rejects a password below the minimum length', async () => {
    await freshAdmin()
    const token = await signedInCookie()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const changed = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/password',
        payload: { currentPassword: INITIAL_PASSWORD, newPassword: 'short' },
        cookies: { [ADMIN_SESSION_COOKIE]: token },
        headers: MARKER,
      })
      expect(changed.statusCode).toBe(400)
      expect(changed.json().error.code).toBe('validation_failed')
    } finally {
      await app.close()
    }
  })
})

describe('administrative area over the spaces module', () => {
  test('a signed-in administrator creates a space', async () => {
    await freshAdmin()
    const token = await signedInCookie()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/spaces',
        payload: { name: 'Smith family' },
        cookies: { [ADMIN_SESSION_COOKIE]: token },
        headers: MARKER,
      })
      expect(created.statusCode).toBe(201)
      expect(created.json().name).toBe('Smith family')
    } finally {
      await app.close()
    }
  })
})

describe('resetting the administrative password from the server', () => {
  test('sets a new password and revokes existing sessions', async () => {
    await freshAdmin()
    const token = await signedInCookie()
    const app = harness.buildTestApp()
    await app.ready()
    try {
      await resetAdminPassword(harness, 'a-reset-emergency-password')

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/admin/session',
            cookies: { [ADMIN_SESSION_COOKIE]: token },
          })
        ).statusCode,
      ).toBe(401)

      const stale = await signIn(app, INITIAL_PASSWORD)
      expect(stale.statusCode).toBe(401)
      const fresh = await signIn(app, 'a-reset-emergency-password')
      expect(fresh.statusCode).toBe(204)
    } finally {
      await app.close()
    }
  })

  test('creates the administrator when bootstrap never ran', async () => {
    await wipeAdministrators()
    await resetAdminPassword(harness, 'a-first-recovery-password')
    const app = harness.buildTestApp()
    await app.ready()
    try {
      const response = await signIn(app, 'a-first-recovery-password')
      expect(response.statusCode).toBe(204)
    } finally {
      await app.close()
    }
  })
})
