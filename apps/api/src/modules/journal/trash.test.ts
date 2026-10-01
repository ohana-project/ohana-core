import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions, instanceSettings } from '../admin/tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'trash-admin-password'
const MARKER = { [ADMIN_MARKER_HEADER]: '1' }

/*
 * The administrator and the installation settings are singletons, so each
 * file that relies on them re-establishes them in its arrange step; test
 * files run one at a time (vitest.config.ts) but share one database. With
 * no settings row every read answers the 30-day default (ADR-0007).
 */
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await harness.db.delete(instanceSettings)
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

interface TrashedEntryDto {
  id: string
  authorId: string
  title?: string
  text: string
  previousState: 'draft' | 'published'
  trashedAt: string
  purgeAt: string
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

async function trashEntry(
  app: TestApp,
  session: MemberSession,
  entryId: string,
): Promise<{ status: number; body: TrashedEntryDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/journal/entries/${entryId}/trash`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function restoreEntry(
  app: TestApp,
  session: MemberSession,
  entryId: string,
): Promise<{ status: number; body: EntryDto | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/journal/entries/${entryId}/restore`,
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function getTrash(
  app: TestApp,
  session: MemberSession,
): Promise<{ status: number; body: { entries: TrashedEntryDto[] } | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/journal/trash',
    headers: memberHeaders(session),
  })
  return { status: response.statusCode, body: response.json() }
}

async function getFeed(
  app: TestApp,
  session: MemberSession,
): Promise<{ status: number; body: { entries: EntryDto[] } | { error: { code: string } } }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/journal/feed',
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

/** The sync response's tombstones for the journal entity, since revision 0. */
async function syncTombstones(
  app: TestApp,
  session: MemberSession,
): Promise<Array<Record<string, unknown>>> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/sync?since=0',
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return (response.json() as { tombstones: Array<Record<string, unknown>> }).tombstones.filter(
    (tombstone) => tombstone.entity === 'journal_entry',
  )
}

/** The sync response's journal entry upserts, since revision 0. */
async function syncEntryIds(app: TestApp, session: MemberSession): Promise<string[]> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/sync?since=0',
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  const changes = response.json() as { changes: Array<{ entity: string; entry?: { id: string } }> }
  return changes.changes
    .filter((change) => change.entity === 'journal_entry')
    .map((change) => change.entry?.id)
    .filter((id): id is string => id !== undefined)
}

describe('POST /api/v1/journal/entries/:entryId/trash', () => {
  test('the author trashes their draft; it remembers its state and leaves every view', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Корзина черновиков' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, { title: 'Черновик', text: 'Ещё не готово' })
      expect(created.status).toBe(201)
      const draft = created.body as EntryDto

      const trashed = await trashEntry(app, anna, draft.id)
      expect(trashed.status).toBe(200)
      const row = trashed.body as TrashedEntryDto
      expect(row).toMatchObject({ id: draft.id, previousState: 'draft' })
      // The permanent-deletion date is the removal plus the default
      // retention (30 days, ADR-0007).
      expect(new Date(row.purgeAt).getTime()).toBe(
        new Date(row.trashedAt).getTime() + 30 * 24 * 60 * 60 * 1000,
      )

      // The author's drafts list no longer carries it, and the ordinary
      // read answers 404: the trash view is its only audience.
      expect((await getDrafts(app, anna)).body).toEqual([])
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/journal/entries/${draft.id}`,
        headers: memberHeaders(anna),
      })
      expect(read.statusCode).toBe(404)

      // The author's trash view names it; nobody else sees it at all.
      expect((await getTrash(app, anna)).body).toMatchObject({
        entries: [{ id: draft.id, previousState: 'draft' }],
      })
      expect((await getTrash(app, dima)).body).toEqual({ entries: [] })

      // The sync delivered the removal to the author alone — the trashed
      // draft was theirs alone to lose — and no upsert carries it any more.
      expect(await syncTombstones(app, anna)).toMatchObject([
        { entityId: draft.id, audience: 'member', memberId: anna.memberId },
      ])
      expect(await syncTombstones(app, dima)).toEqual([])
      expect(await syncEntryIds(app, anna)).not.toContain(draft.id)

      // The refused write never schedules a purge; the accepted one does,
      // inside its transaction — pinned here by the recording sender (the
      // same-transaction delivery is the queue integration test's claim).
      expect(harness.jobs.submissions).toHaveLength(1)
      expect(harness.jobs.submissions[0]).toMatchObject({
        name: 'journal-purge-entry',
        data: { spaceId: space.id, entryId: draft.id },
      })
      expect(harness.jobs.submissions[0]?.startAfter).toEqual(new Date(row.purgeAt))
    })
  })

  test('the author trashes a published entry; the whole space is told', async () => {
    await withApp(async (app) => {
      harness.jobs.submissions.length = 0
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Корзина публикаций' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, { title: 'Поход', text: 'Сходили' })
      const draft = created.body as EntryDto
      const published = await publishEntry(app, anna, draft.id)
      expect(published.status).toBe(200)
      const entry = published.body as EntryDto

      const trashed = await trashEntry(app, anna, entry.id)
      expect(trashed.status).toBe(200)
      expect(trashed.body as TrashedEntryDto).toMatchObject({
        id: entry.id,
        previousState: 'published',
      })

      // The feed loses it for everyone.
      expect((await getFeed(app, anna)).body).toEqual({ entries: [], hasMore: false })
      expect((await getFeed(app, dima)).body).toEqual({ entries: [], hasMore: false })

      // The trash view shows it to every member; only its author restores.
      for (const session of [anna, dima]) {
        expect((await getTrash(app, session)).body).toMatchObject({
          entries: [{ id: entry.id, previousState: 'published' }],
        })
      }

      // The tombstone reaches everyone; no upsert carries the row.
      for (const session of [anna, dima]) {
        expect(await syncTombstones(app, session)).toMatchObject([
          { entityId: entry.id, audience: 'all' },
        ])
        expect(await syncEntryIds(app, session)).not.toContain(entry.id)
      }
    })
  })

  test('the owner trashes another member’s published entry; a regular member may not', async () => {
    await withApp(async (app) => {
      harness.jobs.submissions.length = 0
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Модерация' })
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const regular = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, regular, { title: 'Спорное', text: 'Текст' })
      const entry = created.body as EntryDto
      expect((await publishEntry(app, regular, entry.id)).status).toBe(200)

      // A regular member cannot trash another member's published entry.
      const otherCreated = await createEntry(app, owner, { title: 'Владелица', text: 'Текст' })
      const otherEntry = otherCreated.body as EntryDto
      expect((await publishEntry(app, owner, otherEntry.id)).status).toBe(200)
      const denied = await trashEntry(app, regular, otherEntry.id)
      expect(denied.status).toBe(403)
      expect((denied.body as { error: { code: string } }).error.code).toBe('trash_forbidden')
      // The refusal left no purge job behind.
      expect(harness.jobs.submissions).toHaveLength(0)

      // The owner trashes the published entry they did not write.
      const ownerTrashed = await trashEntry(app, owner, entry.id)
      expect(ownerTrashed.status).toBe(200)
      expect(ownerTrashed.body as TrashedEntryDto).toMatchObject({
        id: entry.id,
        previousState: 'published',
        authorId: regular.memberId,
      })
      expect(harness.jobs.submissions).toHaveLength(1)
    })
  })

  test('another member’s draft is invisible to the owner, and trash refuses what it cannot see', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Чужие черновики' })
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const regular = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, regular, { text: 'Личный черновик' })
      const draft = created.body as EntryDto

      // The owner cannot trash (or even see) another member's draft.
      const ownerTrash = await trashEntry(app, owner, draft.id)
      expect(ownerTrash.status).toBe(404)
      expect((ownerTrash.body as { error: { code: string } }).error.code).toBe('entry_not_found')

      // Trashing twice: the second pass finds nothing to trash.
      expect((await trashEntry(app, regular, draft.id)).status).toBe(200)
      const again = await trashEntry(app, regular, draft.id)
      expect(again.status).toBe(404)
      expect((again.body as { error: { code: string } }).error.code).toBe('entry_not_found')

      // A fabricated id answers 404 the same way.
      const missing = await trashEntry(app, regular, '01900000-0000-7000-8000-0000000000ff')
      expect(missing.status).toBe(404)
    })
  })

  test('the trash routes answer 404 section_hidden while the section is hidden', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Скрытый раздел' })
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { journal: false } },
      })
      expect(hide.statusCode).toBe(200)

      const list = await getTrash(app, owner)
      expect(list.status).toBe(404)
      expect((list.body as { error: { code: string } }).error.code).toBe('section_hidden')

      const trash = await trashEntry(app, owner, '01900000-0000-7000-8000-0000000000fe')
      expect(trash.status).toBe(404)
      expect((trash.body as { error: { code: string } }).error.code).toBe('section_hidden')
    })
  })
})

describe('POST /api/v1/journal/entries/:entryId/restore', () => {
  test('restoring returns the entry to its previous state, published moment included', async () => {
    await withApp(async (app) => {
      harness.jobs.submissions.length = 0
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Возвращение' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')

      const created = await createEntry(app, anna, { title: 'Прощание', text: 'Не насовсем' })
      const draft = created.body as EntryDto
      const published = await publishEntry(app, anna, draft.id)
      const entry = published.body as EntryDto

      expect((await trashEntry(app, anna, entry.id)).status).toBe(200)

      const restored = await restoreEntry(app, anna, entry.id)
      expect(restored.status).toBe(200)
      const back = restored.body as EntryDto
      expect(back).toMatchObject({ id: entry.id, state: 'published' })
      // The published moment survived the round trip: the entry is what it was.
      expect(back.publishedAt).toBe(entry.publishedAt)

      // The feed carries it again, the trash view is empty, and the sync's
      // upsert outranks the trash tombstone of the same row.
      expect((await getFeed(app, anna)).body).toMatchObject({ entries: [{ id: entry.id }] })
      expect((await getTrash(app, anna)).body).toEqual({ entries: [] })
      expect(await syncEntryIds(app, anna)).toContain(entry.id)
    })
  })

  test('a restored draft returns to the author alone', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Черновик вернулся' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const dima = await memberSession(app, adminCookie, space.id, 'Дима')

      const created = await createEntry(app, anna, { text: 'Только мой' })
      const draft = created.body as EntryDto

      expect((await trashEntry(app, anna, draft.id)).status).toBe(200)
      expect((await restoreEntry(app, anna, draft.id)).status).toBe(200)

      expect((await getDrafts(app, anna)).body).toMatchObject([{ id: draft.id }])
      expect(await syncEntryIds(app, anna)).toContain(draft.id)
      // The draft never reached the other member, in any state.
      expect(await syncEntryIds(app, dima)).not.toContain(draft.id)
      expect((await getDrafts(app, dima)).body).toEqual([])
    })
  })

  test('the author restores their entry, the owner restores another’s published one, a stranger may not', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Право вернуть' })
      const owner = await memberSession(app, adminCookie, space.id, 'Аня', 'owner')
      const author = await memberSession(app, adminCookie, space.id, 'Дима')
      const stranger = await memberSession(app, adminCookie, space.id, 'Вера')

      // The author restores their own trashed draft.
      const ownDraft = (await createEntry(app, author, { text: 'Свой' })).body as EntryDto
      expect((await trashEntry(app, author, ownDraft.id)).status).toBe(200)
      expect((await restoreEntry(app, author, ownDraft.id)).status).toBe(200)

      // The owner restores another member's published entry.
      const sharedDraft = (await createEntry(app, author, { text: 'Общая' })).body as EntryDto
      expect((await publishEntry(app, author, sharedDraft.id)).status).toBe(200)
      expect((await trashEntry(app, author, sharedDraft.id)).status).toBe(200)
      const ownerRestore = await restoreEntry(app, owner, sharedDraft.id)
      expect(ownerRestore.status).toBe(200)
      expect((ownerRestore.body as EntryDto).state).toBe('published')

      // A stranger sees the trashed published entry in the trash view but
      // cannot restore it; a stranger's trashed draft is invisible at all.
      expect((await trashEntry(app, author, sharedDraft.id)).status).toBe(200)
      expect((await getTrash(app, stranger)).body).toMatchObject({
        entries: [{ id: sharedDraft.id }],
      })
      const denied = await restoreEntry(app, stranger, sharedDraft.id)
      expect(denied.status).toBe(403)
      expect((denied.body as { error: { code: string } }).error.code).toBe('restore_forbidden')

      const secretDraft = (await createEntry(app, author, { text: 'Никому' })).body as EntryDto
      expect((await trashEntry(app, author, secretDraft.id)).status).toBe(200)
      // The stranger's view gained nothing: the trashed draft is the
      // author's alone, and the published entry they saw before is all
      // the trash holds for them.
      expect((await getTrash(app, stranger)).body).toMatchObject({
        entries: [{ id: sharedDraft.id }],
      })
      expect(
        ((await getTrash(app, stranger)).body as { entries: TrashedEntryDto[] }).entries.map(
          (entry) => entry.id,
        ),
      ).not.toContain(secretDraft.id)
      const hidden = await restoreEntry(app, stranger, secretDraft.id)
      expect(hidden.status).toBe(404)
      expect((hidden.body as { error: { code: string } }).error.code).toBe('entry_not_found')

      // Restoring an entry that is not in the trash answers 404.
      const live = (await createEntry(app, author, { text: 'Живая' })).body as EntryDto
      const notTrashed = await restoreEntry(app, author, live.id)
      expect(notTrashed.status).toBe(404)
      expect((notTrashed.body as { error: { code: string } }).error.code).toBe('entry_not_found')
    })
  })
})

describe('the trash retention (GET /api/v1/admin/settings, PUT …)', () => {
  test('the administrator changes the retention, and the trash view computes deletion dates from it', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Сроки' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      // The default answers before anything was ever changed.
      const initial = await app.inject({ method: 'GET', url: '/api/v1/admin/settings' })
      expect(initial.statusCode).toBe(401)

      const settings = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: { cookie: adminCookie },
      })
      expect(settings.statusCode).toBe(200)
      expect(settings.json()).toEqual({ trashRetentionDays: 30 })

      const changed = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings',
        payload: { trashRetentionDays: 7 },
        headers: { cookie: adminCookie, ...MARKER },
      })
      expect(changed.statusCode).toBe(200)
      expect(changed.json()).toEqual({ trashRetentionDays: 7 })

      // The write needs the marker header, like every state-changing
      // administrative request.
      const unmarked = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings',
        payload: { trashRetentionDays: 90 },
        headers: { cookie: adminCookie },
      })
      expect(unmarked.statusCode).toBe(403)
      expect(unmarked.json().error.code).toBe('missing_admin_header')

      const outOfRange = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings',
        payload: { trashRetentionDays: 400 },
        headers: { cookie: adminCookie, ...MARKER },
      })
      expect(outOfRange.statusCode).toBe(400)

      // A trashed entry's deletion date follows the current retention.
      const created = await createEntry(app, anna, { text: 'На семь дней' })
      const entry = created.body as EntryDto
      const trashed = await trashEntry(app, anna, entry.id)
      const row = trashed.body as TrashedEntryDto
      expect(new Date(row.purgeAt).getTime()).toBe(
        new Date(row.trashedAt).getTime() + 7 * 24 * 60 * 60 * 1000,
      )
      expect((await getTrash(app, anna)).body).toMatchObject({
        entries: [{ id: entry.id, purgeAt: row.purgeAt }],
      })
    })
  })

  test('the purge jobs already scheduled are re-dated by the retention of the moment, not the one at trash time', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Пересмотр сроков' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const created = await createEntry(app, anna, { text: 'Сначала на тридцать' })
      const entry = created.body as EntryDto
      expect((await trashEntry(app, anna, entry.id)).status).toBe(200)
      const scheduledAt = harness.jobs.submissions[0]?.startAfter

      // The retention grows: the worker's handlers re-read it before
      // acting, so the early job finds the entry not yet due (the jobs'
      // own tests pin that); the sweep then purges at the right moment.
      const changed = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings',
        payload: { trashRetentionDays: 90 },
        headers: { cookie: adminCookie, ...MARKER },
      })
      expect(changed.statusCode).toBe(200)

      // The trash view immediately shows the recomputed date.
      const row = ((await getTrash(app, anna)).body as { entries: TrashedEntryDto[] })
        .entries[0] as TrashedEntryDto
      expect(new Date(row.purgeAt).getTime()).toBe(
        new Date(row.trashedAt).getTime() + 90 * 24 * 60 * 60 * 1000,
      )
      // The scheduled job keeps the moment it was given.
      expect(scheduledAt).not.toBeUndefined()
    })
  })
})

describe('the trash list order', () => {
  test('rows come newest removal first', async () => {
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const space = await harness.createSpace({ name: 'Порядок' })
      const anna = await memberSession(app, adminCookie, space.id, 'Аня')

      const first = (await createEntry(app, anna, { text: 'Первая' })).body as EntryDto
      const second = (await createEntry(app, anna, { text: 'Вторая' })).body as EntryDto
      expect((await trashEntry(app, anna, first.id)).status).toBe(200)
      // The fixed clock moves by explicit steps; a distinct removal moment
      // keeps the order deterministic.
      harness.clock.advance(1000)
      expect((await trashEntry(app, anna, second.id)).status).toBe(200)

      expect((await getTrash(app, anna)).body).toEqual({
        entries: [
          expect.objectContaining({ id: second.id }),
          expect.objectContaining({ id: first.id }),
        ],
      })
    })
  })
})
