import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'journal-sync-admin-password'
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

interface MemberSession {
  memberId: string
  cookie: string
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

function memberHeaders(session: MemberSession) {
  return { 'x-ohana-member': session.memberId, cookie: session.cookie }
}

interface SyncEntry {
  id: string
  authorId: string
  text: string
  state: 'draft' | 'published'
  publishedAt?: string
}

interface SyncResponse {
  revision: string
  changes: Array<{ entity: string; entry?: SyncEntry }>
  tombstones: Array<Record<string, unknown>>
}

async function sync(app: TestApp, session: MemberSession, since: string): Promise<SyncResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/sync?since=${since}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return response.json()
}

function entryChanges(result: SyncResponse): SyncEntry[] {
  return result.changes
    .filter((change) => change.entity === 'journal_entry')
    .map((change) => change.entry as SyncEntry)
}

async function createEntry(
  app: TestApp,
  session: MemberSession,
  body: { title?: string; text: string },
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/journal/entries',
    headers: memberHeaders(session),
    payload: body,
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

async function publishEntry(app: TestApp, session: MemberSession, entryId: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/journal/entries/${entryId}/publish`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
}

async function editEntry(
  app: TestApp,
  session: MemberSession,
  entryId: string,
  body: { text: string },
): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/journal/entries/${entryId}`,
    headers: memberHeaders(session),
    payload: body,
  })
  expect(response.statusCode).toBe(200)
}

describe('the journal sync contributor (issues #14 and #15)', () => {
  test('a draft reaches only its author; a published entry reaches everyone', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const draft = await createEntry(app, anna, { title: 'Черновик', text: 'Только мой' })

      // From revision 0: Аня's sync carries her draft, Дима's carries no
      // journal entries at all.
      const forAnna = await sync(app, anna, '0')
      const annaEntries = entryChanges(forAnna)
      expect(annaEntries.map((entry) => entry.id)).toEqual([draft.id])
      expect(annaEntries[0]).toMatchObject({ state: 'draft', authorId: anna.memberId })

      const forDima = await sync(app, dima, '0')
      expect(entryChanges(forDima)).toEqual([])

      const cursor = forDima.revision

      // Publishing shares it: the delta carries the published shape to both.
      await publishEntry(app, anna, draft.id)

      const deltaAnna = await sync(app, anna, cursor)
      const deltaDima = await sync(app, dima, cursor)
      for (const delta of [deltaAnna, deltaDima]) {
        const entries = entryChanges(delta)
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ id: draft.id, state: 'published' })
        expect(entries[0]?.publishedAt).toEqual(expect.any(String))
      }

      // A second draft after the cursor again stays the author's alone.
      const second = await createEntry(app, anna, { text: 'Второй черновик' })
      const laterDima = await sync(app, dima, deltaDima.revision)
      expect(entryChanges(laterDima).map((entry) => entry.id)).toEqual([])
      const laterAnna = await sync(app, anna, deltaAnna.revision)
      expect(entryChanges(laterAnna).map((entry) => entry.id)).toEqual([second.id])
    })
  })

  test('an edit of a published entry travels to every member', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const entry = await createEntry(app, anna, { text: 'Первоначальный текст' })
      await publishEntry(app, anna, entry.id)
      const seen = await sync(app, dima, '0')
      const cursor = seen.revision

      await editEntry(app, anna, entry.id, { text: 'Исправленный текст' })

      const delta = await sync(app, dima, cursor)
      const entries = entryChanges(delta)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ id: entry.id, text: 'Исправленный текст' })
    })
  })

  test('entries of another space never appear', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      const foreign = await createEntry(app, stranger, { text: 'Чужая запись' })
      await publishEntry(app, stranger, foreign.id)

      const result = await sync(app, anna, '0')
      expect(entryChanges(result)).toEqual([])
    })
  })

  test('a hidden journal contributes nothing, and a re-shown one resyncs from 0', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const entry = await createEntry(app, dima, { text: 'До скрытия' })
      await publishEntry(app, dima, entry.id)
      const before = await sync(app, dima, '0')
      expect(entryChanges(before)).toHaveLength(1)

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { journal: false } },
      })
      expect(hide.statusCode).toBe(200)

      // From the pre-hide cursor the delta carries the new sections map and
      // no journal rows: the client drops the section's rows when it applies
      // the map (ADR-0011, ADR-0014).
      const delta = await sync(app, dima, before.revision)
      expect(entryChanges(delta)).toEqual([])
      const spaceChange = delta.changes.find((change) => change.entity === 'space')
      expect(spaceChange).toMatchObject({
        space: { sections: { journal: false, calendar: true, wishlist: true } },
      })

      const show = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { journal: true } },
      })
      expect(show.statusCode).toBe(200)

      // The client that saw the re-show discards its cursor and syncs from
      // revision 0 once: the section's full data comes back.
      const resync = await sync(app, dima, '0')
      const entries = entryChanges(resync)
      expect(entries.map((row) => row.id)).toEqual([entry.id])
      expect(entries[0]).toMatchObject({ state: 'published' })
    })
  })
})
