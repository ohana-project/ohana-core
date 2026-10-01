import { afterAll, describe, expect, test } from 'vitest'
import { fixedClock } from '../../platform/clock.ts'
import { createTestHarness, recordingJobSender, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { createDraft, publishDraft, updateEntryText } from './service.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'journal-admin-password'
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

interface EntryDto {
  id: string
  authorId: string
  title?: string
  text: string
  state: 'draft' | 'published'
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

async function createEntry(
  app: TestApp,
  session: MemberSession,
  body: { title?: string; text: string },
): Promise<{ status: number; body: EntryDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/journal/entries',
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

async function editEntry(
  app: TestApp,
  session: MemberSession,
  entryId: string,
  body: { title?: string; text: string },
): Promise<{ status: number; body: EntryDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/journal/entries/${entryId}`,
    headers: memberHeaders(session),
    payload: body,
  })
  return { status: response.statusCode, body: response.json() }
}

async function publishEntry(
  app: TestApp,
  session: MemberSession,
  entryId: string,
): Promise<{ status: number; body: EntryDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/journal/entries/${entryId}/publish`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function getEntry(
  app: TestApp,
  session: MemberSession,
  entryId: string,
): Promise<{ status: number; body: EntryDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/journal/entries/${entryId}`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

interface Feed {
  entries: EntryDto[]
  hasMore: boolean
}

async function getFeed(
  app: TestApp,
  session: MemberSession,
  query: { limit?: number; before?: string; beforeId?: string } = {},
): Promise<{ status: number; body: Feed | { error: { code: string } } }> {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.before !== undefined) params.set('before', query.before)
  if (query.beforeId !== undefined) params.set('beforeId', query.beforeId)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/journal/feed${suffix}`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function getDrafts(
  app: TestApp,
  session: MemberSession,
): Promise<{ status: number; body: EntryDto[] | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/journal/drafts',
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

/** Hides or shows the journal section as the space's owner. */
async function setJournalVisible(
  app: TestApp,
  owner: MemberSession,
  visible: boolean,
): Promise<void> {
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/space',
    headers: memberHeaders(owner),
    payload: { sections: { journal: visible } },
  })
  expect(response.statusCode).toBe(200)
}

/** The space revision the sync endpoint answers, from revision 0. */
async function syncRevision(app: TestApp, session: MemberSession): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/sync?since=0',
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return (response.json() as { revision: string }).revision
}

describe('POST /api/v1/journal/entries (a new entry starts as a draft)', () => {
  test('the author reads their draft; it is in no one else anywhere', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, {
        title: 'Осенний пикник',
        text: 'Собрались за час: бутерброды, термос, плед и Бублик.',
      })
      expect(created.status).toBe(201)
      const draft = created.body as EntryDto
      expect(draft).toMatchObject({
        authorId: anna.memberId,
        title: 'Осенний пикник',
        state: 'draft',
      })
      expect(draft.publishedAt).toBeUndefined()

      // The author reads it back.
      const own = await getEntry(app, anna, draft.id)
      expect(own.status).toBe(200)
      expect((own.body as EntryDto).state).toBe('draft')

      // Another member cannot see or edit it — its existence stays hidden.
      const strangerRead = await getEntry(app, dima, draft.id)
      expect(strangerRead.status).toBe(404)
      expect((strangerRead.body as { error: { code: string } }).error.code).toBe('entry_not_found')

      const strangerEdit = await editEntry(app, dima, draft.id, { text: 'чужой текст' })
      expect(strangerEdit.status).toBe(404)
      expect((strangerEdit.body as { error: { code: string } }).error.code).toBe('entry_not_found')

      // The drafts list answers the author alone.
      const ownDrafts = await getDrafts(app, anna)
      expect(ownDrafts.status).toBe(200)
      expect((ownDrafts.body as EntryDto[]).map((entry) => entry.id)).toEqual([draft.id])

      const strangerDrafts = await getDrafts(app, dima)
      expect(strangerDrafts.status).toBe(200)
      expect(strangerDrafts.body).toEqual([])

      // The shared feed carries no drafts, for anyone.
      for (const session of [anna, dima]) {
        const feed = await getFeed(app, session)
        expect(feed.status).toBe(200)
        expect((feed.body as Feed).entries).toEqual([])
      }
    })
  })

  test('the author edits the draft, and an untitled draft stays valid', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEntry(app, anna, { text: 'Черновик без заголовка' })
      expect(created.status).toBe(201)
      const draft = created.body as EntryDto
      expect(draft.title).toBeUndefined()

      const edited = await editEntry(app, anna, draft.id, {
        title: '  Появилось имя  ',
        text: '  Текст с пробелами по краям  ',
      })
      expect(edited.status).toBe(200)
      // Titles and text are stored trimmed; a blank title is no title.
      expect((edited.body as EntryDto).title).toBe('Появилось имя')
      expect((edited.body as EntryDto).text).toBe('Текст с пробелами по краям')

      const cleared = await editEntry(app, anna, draft.id, { text: 'Текст остался' })
      expect(cleared.status).toBe(200)
      expect((cleared.body as EntryDto).title).toBeUndefined()
    })
  })

  test('a blank title is stored as none, and a whitespace-only text fails validation', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const blankTitle = await createEntry(app, anna, {
        title: '   ',
        text: 'Текст есть',
      })
      expect(blankTitle.status).toBe(201)
      expect((blankTitle.body as EntryDto).title).toBeUndefined()

      // A NUL never reaches PostgreSQL: it refuses the byte, so the
      // contract refuses the payload first.
      for (const text of ['', '   ', 'текст\u0000с нулём']) {
        const refused = await createEntry(app, anna, { text })
        expect(refused.status).toBe(400)
        expect((refused.body as { error: { code: string } }).error.code).toBe('validation_failed')
      }
      const nulTitle = await createEntry(app, anna, {
        title: 'Заголовок\u0000с нулём',
        text: 'Текст есть',
      })
      expect(nulTitle.status).toBe(400)
      expect((nulTitle.body as { error: { code: string } }).error.code).toBe('validation_failed')
    })
  })

  test('the length bounds answer exactly at the edge', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      // The bounds live in the contract, and the web editor mirrors the
      // numbers by hand: an off-by-one on either side would drift silently.
      const longestTitle = await createEntry(app, anna, {
        title: 'З'.repeat(200),
        text: 'Текст есть',
      })
      expect(longestTitle.status).toBe(201)

      const tooLongTitle = await createEntry(app, anna, {
        title: 'З'.repeat(201),
        text: 'Текст есть',
      })
      expect(tooLongTitle.status).toBe(400)
      expect((tooLongTitle.body as { error: { code: string } }).error.code).toBe(
        'validation_failed',
      )

      const longestText = await createEntry(app, anna, { text: 'Т'.repeat(20_000) })
      expect(longestText.status).toBe(201)

      const tooLongText = await createEntry(app, anna, { text: 'Т'.repeat(20_001) })
      expect(tooLongText.status).toBe(400)
      expect((tooLongText.body as { error: { code: string } }).error.code).toBe('validation_failed')

      // The edit contract shares the create schema object, so the bounds
      // ride along; the edit answers at both edges, so the alias being
      // split later cannot tighten a limit unnoticed.
      const created = longestTitle.body as EntryDto
      const longestEdit = await editEntry(app, anna, created.id, {
        title: 'З'.repeat(200),
        text: 'Т'.repeat(20_000),
      })
      expect(longestEdit.status).toBe(200)

      const tooLongEdit = await editEntry(app, anna, created.id, {
        title: 'З'.repeat(201),
        text: 'Текст есть',
      })
      expect(tooLongEdit.status).toBe(400)
      expect((tooLongEdit.body as { error: { code: string } }).error.code).toBe('validation_failed')

      const tooLongTextEdit = await editEntry(app, anna, created.id, {
        title: 'Заголовок',
        text: 'Т'.repeat(20_001),
      })
      expect(tooLongTextEdit.status).toBe(400)
      expect((tooLongTextEdit.body as { error: { code: string } }).error.code).toBe(
        'validation_failed',
      )
    })
  })

  test('a member without a session answers 401', async () => {
    await withApp(async (app) => {
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/journal/entries',
        payload: { text: 'не пройдёт' },
      })
      expect(denied.statusCode).toBe(401)
      expect(denied.json().error.code).toBe('unauthorized')
    })
  })
})

describe('POST /api/v1/journal/entries/:entryId/publish (the one-way transition)', () => {
  test('publishing shares the entry with the space, once', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, {
        title: 'Поход к Чёртову креслу',
        text: 'Дошли. Вид стоит каждого шага.',
      })
      const draft = created.body as EntryDto

      const published = await publishEntry(app, anna, draft.id)
      expect(published.status).toBe(200)
      const shared = published.body as EntryDto
      expect(shared.state).toBe('published')
      expect(shared.publishedAt).toEqual(expect.any(String))
      expect(shared.text).toBe(draft.text)

      // Every member reads it, and the feed carries it with its author.
      for (const session of [anna, dima]) {
        const read = await getEntry(app, session, draft.id)
        expect(read.status).toBe(200)
        expect((read.body as EntryDto).state).toBe('published')

        const feed = await getFeed(app, session)
        expect((feed.body as Feed).entries.map((entry) => entry.id)).toEqual([draft.id])
        expect((feed.body as Feed).entries[0]?.authorId).toBe(anna.memberId)
        expect((feed.body as Feed).hasMore).toBe(false)
      }

      // It has left the drafts list.
      const drafts = await getDrafts(app, anna)
      expect(drafts.body).toEqual([])

      // Publishing again refuses — and the refusal costs no revision: the
      // space the sync answers after the 409 is the one the publish left.
      const revisionAfterPublish = await syncRevision(app, anna)
      const again = await publishEntry(app, anna, draft.id)
      expect(again.status).toBe(409)
      expect((again.body as { error: { code: string } }).error.code).toBe('entry_already_published')
      expect(await syncRevision(app, anna)).toBe(revisionAfterPublish)
    })
  })

  test('a published entry never returns to draft', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const created = await createEntry(app, anna, { text: 'Черновик' })
      const draft = created.body as EntryDto
      expect((await publishEntry(app, anna, draft.id)).status).toBe(200)

      // The edit contract carries no state at all: a client that tries to
      // unpublish fails validation before anything else.
      const unpublish = await app.inject({
        method: 'PUT',
        url: `/api/v1/journal/entries/${draft.id}`,
        headers: memberHeaders(anna),
        payload: { text: 'Текст', state: 'draft' },
      })
      expect(unpublish.statusCode).toBe(400)
      expect(unpublish.json().error.code).toBe('validation_failed')

      // The entry is still published, for everyone.
      const read = await getEntry(app, anna, draft.id)
      expect((read.body as EntryDto).state).toBe('published')
    })
  })

  test('only the author publishes: a stranger and an owner both refuse', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const owner = await memberSession(app, adminCookie, space.id, 'Олег', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, { text: 'Мой черновик' })
      const draft = created.body as EntryDto

      // A stranger cannot even see the draft, so publishing answers 404.
      const stranger = await publishEntry(app, dima, draft.id)
      expect(stranger.status).toBe(404)
      expect((stranger.body as { error: { code: string } }).error.code).toBe('entry_not_found')

      // The author publishes; afterwards the owner may read it but not
      // take over the authoring.
      expect((await publishEntry(app, anna, draft.id)).status).toBe(200)

      const ownerEdit = await editEntry(app, owner, draft.id, { text: 'правка владельца' })
      expect(ownerEdit.status).toBe(403)
      expect((ownerEdit.body as { error: { code: string } }).error.code).toBe('author_required')

      const ownerPublish = await publishEntry(app, owner, draft.id)
      expect(ownerPublish.status).toBe(403)
      expect((ownerPublish.body as { error: { code: string } }).error.code).toBe('author_required')
    })
  })
})

describe('PUT /api/v1/journal/entries/:entryId (only the author edits, in any state)', () => {
  test('the author edits a published entry, and nobody else does', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, { text: 'Черновой текст' })
      const draft = created.body as EntryDto
      expect((await publishEntry(app, anna, draft.id)).status).toBe(200)

      const edited = await editEntry(app, anna, draft.id, {
        title: 'Поход',
        text: 'Исправленный текст',
      })
      expect(edited.status).toBe(200)
      expect(edited.body).toMatchObject({ state: 'published', text: 'Исправленный текст' })
      expect((edited.body as EntryDto).publishedAt).toBeDefined()

      // A regular member sees the entry but cannot write under Аня's name.
      const strangerEdit = await editEntry(app, dima, draft.id, { text: 'чужая правка' })
      expect(strangerEdit.status).toBe(403)
      expect((strangerEdit.body as { error: { code: string } }).error.code).toBe('author_required')
    })
  })

  test('an unknown entry answers 404', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const missing = '01900000-0000-7000-8000-00000000000f'
      const read = await getEntry(app, anna, missing)
      expect(read.status).toBe(404)
      expect((read.body as { error: { code: string } }).error.code).toBe('entry_not_found')
    })
  })
})

describe('GET /api/v1/journal/feed (the paginated shared feed)', () => {
  test('pages walk newest first and stop at the end', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      // Three published entries from two authors, published in a known
      // order; the fixed clock keeps the instants apart.
      const ids: string[] = []
      for (const [author, text] of [
        [anna, 'Первая'],
        [dima, 'Вторая'],
        [anna, 'Третья'],
      ] as const) {
        harness.clock.advance(1_000)
        const created = await createEntry(app, author, { text })
        expect(created.status).toBe(201)
        const published = await publishEntry(app, author, (created.body as EntryDto).id)
        expect(published.status).toBe(200)
        ids.push((published.body as EntryDto).id)
      }

      const firstPage = await getFeed(app, dima, { limit: 2 })
      expect(firstPage.status).toBe(200)
      const page = firstPage.body as Feed
      expect(page.entries.map((entry) => entry.id)).toEqual([ids[2], ids[1]])
      expect(page.hasMore).toBe(true)

      const last = page.entries[page.entries.length - 1]
      if (last === undefined) throw new Error('The page came back empty')
      const secondPage = await getFeed(app, dima, {
        limit: 2,
        before: last.publishedAt,
        beforeId: last.id,
      })
      expect(secondPage.status).toBe(200)
      const finalPage = secondPage.body as Feed
      expect(finalPage.entries.map((entry) => entry.id)).toEqual([ids[0]])
      expect(finalPage.hasMore).toBe(false)

      // A half-named cursor is refused before it can mislead the query.
      const half = await getFeed(app, dima, { before: last.publishedAt })
      expect(half.status).toBe(400)
      expect((half.body as { error: { code: string } }).error.code).toBe('invalid_cursor')

      const otherHalf = await getFeed(app, dima, { beforeId: last.id })
      expect(otherHalf.status).toBe(400)
      expect((otherHalf.body as { error: { code: string } }).error.code).toBe('invalid_cursor')

      // A moment the Date constructor cannot read (ajv's date-time admits
      // a leap second) is refused too, before it can poison the query —
      // and so is a year outside the 0001–9999 span the driver's ISO
      // string round-trips (an offset can push a 9999 name into 10000).
      for (const moment of [
        '2016-12-31T23:59:60Z',
        '0000-01-01T00:00:00Z',
        '9999-12-31T23:59:59-01:00',
      ]) {
        const unreadable = await getFeed(app, dima, { before: moment, beforeId: last.id })
        expect(unreadable.status).toBe(400)
        expect((unreadable.body as { error: { code: string } }).error.code).toBe('invalid_cursor')
      }
    })
  })

  test('entries published in the same instant page once each, by id', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Наша семья' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      // Two entries share one published instant — the clock is not
      // advanced between them — so the page boundary inside that instant
      // is decided by the id tie-break, and the keyset has to cross it
      // without dropping or repeating an entry.
      const ids: string[] = []
      for (const text of ['Первая', 'Вторая'] as const) {
        const created = await createEntry(app, anna, { text })
        expect(created.status).toBe(201)
        const published = await publishEntry(app, anna, (created.body as EntryDto).id)
        expect(published.status).toBe(200)
        ids.push((published.body as EntryDto).id)
      }
      const [one, two] = ids
      if (one === undefined || two === undefined) throw new Error('The entries came back missing')
      const newest = one > two ? one : two
      const oldest = one > two ? two : one

      const firstPage = await getFeed(app, anna, { limit: 1 })
      expect(firstPage.status).toBe(200)
      const page = firstPage.body as Feed
      expect(page.entries.map((entry) => entry.id)).toEqual([newest])
      expect(page.hasMore).toBe(true)

      const last = page.entries[0]
      if (last === undefined) throw new Error('The page came back empty')
      const secondPage = await getFeed(app, anna, {
        limit: 1,
        before: last.publishedAt,
        beforeId: last.id,
      })
      expect(secondPage.status).toBe(200)
      const finalPage = secondPage.body as Feed
      expect(finalPage.entries.map((entry) => entry.id)).toEqual([oldest])
      expect(finalPage.hasMore).toBe(false)
    })
  })

  test('the feed never carries a draft, and another space keeps its feed', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const otherSpace = await harness.createSpace({ name: 'Другое пространство' })
      const stranger = await memberSession(app, adminCookie, otherSpace.id, 'Чужак')
      const foreign = await createEntry(app, stranger, { text: 'Чужая запись' })
      expect((await publishEntry(app, stranger, (foreign.body as EntryDto).id)).status).toBe(200)

      const ownDraft = await createEntry(app, anna, { text: 'Свой черновик' })
      const ownShared = await createEntry(app, anna, { text: 'Своя запись' })
      expect((await publishEntry(app, anna, (ownShared.body as EntryDto).id)).status).toBe(200)

      const feed = await getFeed(app, anna, { limit: 50 })
      const entries = (feed.body as Feed).entries
      expect(entries.map((entry) => entry.id)).toEqual([(ownShared.body as EntryDto).id])
      expect(entries.map((entry) => entry.id)).not.toContain((ownDraft.body as EntryDto).id)
      expect(entries.map((entry) => entry.id)).not.toContain((foreign.body as EntryDto).id)
    })
  })
})

describe('the hidden journal section (ADR-0011)', () => {
  test('reads and writes answer 404 section_hidden while hidden', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace()
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const regular = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, regular, { text: 'береги запись' })
      const entry = created.body as EntryDto
      expect((await publishEntry(app, regular, entry.id)).status).toBe(200)
      const stillDraft = await createEntry(app, regular, { text: 'ждёт публикации' })
      const draftEntry = stillDraft.body as EntryDto

      await setJournalVisible(app, owner, false)

      for (const session of [owner, regular]) {
        const feed = await getFeed(app, session)
        expect(feed.status).toBe(404)
        expect((feed.body as { error: { code: string } }).error.code).toBe('section_hidden')

        const drafts = await getDrafts(app, session)
        expect(drafts.status).toBe(404)

        const read = await getEntry(app, session, entry.id)
        expect(read.status).toBe(404)
      }

      const write = await createEntry(app, regular, { text: 'не должно пройти' })
      expect(write.status).toBe(404)
      expect((write.body as { error: { code: string } }).error.code).toBe('section_hidden')

      // The section gate refuses the other writes the same way, before
      // any handler runs.
      const edit = await editEntry(app, regular, entry.id, { text: 'правка при скрытом' })
      expect(edit.status).toBe(404)
      expect((edit.body as { error: { code: string } }).error.code).toBe('section_hidden')

      const publish = await publishEntry(app, regular, entry.id)
      expect(publish.status).toBe(404)
      expect((publish.body as { error: { code: string } }).error.code).toBe('section_hidden')

      // The in-transaction recheck is what a request that slips past the
      // gate meets: each write use case, called directly, refuses the same
      // way. The test is sequential — it pins that the recheck exists, not
      // the lock ordering that makes it sound.
      const deps = { db: harness.db, clock: fixedClock(), jobs: recordingJobSender() }
      const actor = { memberId: regular.memberId, spaceId: space.id, role: 'regular' as const }
      for (const [name, useCase] of [
        [
          'updateEntryText',
          () => updateEntryText(deps, actor, entry.id, { text: 'правка мимо гейта' }),
        ],
        ['createDraft', () => createDraft(deps, actor, { text: 'новая при скрытом' })],
        ['publishDraft', () => publishDraft(deps, actor, draftEntry.id)],
      ] as const) {
        const refused = await useCase().catch((error: unknown) => error)
        expect(refused, name).toMatchObject({ name: 'DomainError', code: 'section_hidden' })
      }

      // Hiding keeps the data: showing restores the feed as it was.
      await setJournalVisible(app, owner, true)
      const restored = await getFeed(app, regular)
      expect(restored.status).toBe(200)
      expect((restored.body as Feed).entries.map((entry) => entry.id)).toEqual([entry.id])
    })
  })
})
