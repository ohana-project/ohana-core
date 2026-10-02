import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions, instanceSettings } from '../admin/tables.ts'
import { touchEntryRevision } from '../journal/service.ts'
import type { EntryImageDto } from './contracts.ts'
import {
  deleteEntryImageObjects,
  generateEntryImageDerivatives,
  MEDIA_DELETE_JOB,
  type MediaDeleteJobData,
} from './jobs.ts'
import { IMAGE_OBJECT_KIND, imageObjectKey } from './keys.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

// The installation settings are a singleton other test files may have
// changed (the files share one database); the administrator likewise.
await harness.db.delete(instanceSettings)
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await ensureInitialAdministrator(harness, 'media-admin-password')

type TestApp = ReturnType<TestHarness['buildTestApp']>

const ADMIN_MARKERS = { [ADMIN_MARKER_HEADER]: '1' }

/*
 * The photo routes over HTTP (issue #17): the upload streams through the
 * API behind the entry's own permission rules, the original comes back
 * byte-for-byte, and a stranger — of the space or of the entry — is told
 * nothing. The derivatives' worker side is media-jobs.test.ts's subject;
 * this file pins the authorisation, the limits, and the wire shapes.
 */

const JPEG_BYTES = Buffer.from(
  'JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoK',
  'base64',
)

/** A real image for the tests whose worker has to decode the original. */
const REAL_JPEG = await sharp({
  create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 140, b: 60 } },
})
  .jpeg()
  .toBuffer()

async function withApp(body: (app: TestApp) => Promise<void>) {
  const app = harness.buildTestApp()
  await app.ready()
  try {
    await body(app)
  } finally {
    await app.close()
  }
}

interface MemberSession {
  memberId: string
  cookie: string
}

function memberHeaders(session: MemberSession) {
  return { 'x-ohana-member': session.memberId, cookie: session.cookie }
}

/**
 * Provisions a member through the administrative surface and signs them in
 * through a redeemed access code — the same flow a real client runs.
 */
async function provisionAndSignIn(
  app: TestApp,
  spaceId: string,
  name: string,
  role: 'owner' | 'regular' = 'regular',
): Promise<MemberSession> {
  const adminSignIn = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    payload: { password: 'media-admin-password' },
    headers: ADMIN_MARKERS,
  })
  expect(adminSignIn.statusCode).toBe(204)
  const adminCookie = adminSignIn.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE)
  if (adminCookie === undefined) throw new Error('Administrative sign-in set no cookie')
  const adminHeaders = { cookie: `${ADMIN_SESSION_COOKIE}=${adminCookie.value}`, ...ADMIN_MARKERS }

  const provision = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members`,
    payload: { name, role },
    headers: adminHeaders,
  })
  expect(provision.statusCode).toBe(201)
  const member = provision.json() as { id: string }

  const issue = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members/${member.id}/access-codes`,
    headers: adminHeaders,
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

/** Builds a one-file multipart body the way a browser would. */
function multipartBody(
  bytes: Buffer,
  contentType: string,
  filename = 'photo.jpg',
): {
  payload: Buffer
  contentType: string
} {
  const boundary = '----ohana-test-boundary'
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

interface EntryDto {
  id: string
  authorId: string
  title?: string
  text: string
  state: 'draft' | 'published'
  images: Array<{ id: string; state: 'processing' | 'ready' | 'failed'; width?: number }>
  createdAt: string
  updatedAt: string
}

async function createEntry(app: TestApp, session: MemberSession, text: string): Promise<EntryDto> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/journal/entries',
    headers: memberHeaders(session),
    payload: { text },
  })
  expect(response.statusCode).toBe(201)
  return response.json() as EntryDto
}

async function getEntry(app: TestApp, session: MemberSession, entryId: string): Promise<EntryDto> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/journal/entries/${entryId}`,
    headers: memberHeaders(session),
  })
  expect(response.statusCode).toBe(200)
  return response.json() as EntryDto
}

async function uploadImage(
  app: TestApp,
  session: MemberSession,
  entryId: string,
  bytes: Buffer = JPEG_BYTES,
  contentType = 'image/jpeg',
  overrides: Partial<{ url: string }> = {},
): Promise<{ status: number; body: unknown }> {
  const body = multipartBody(bytes, contentType)
  const response = await app.inject({
    method: 'POST',
    url: overrides.url ?? `/api/v1/journal/entries/${entryId}/images`,
    headers: { ...memberHeaders(session), 'content-type': body.contentType },
    payload: body.payload,
  })
  return { status: response.statusCode, body: response.json() }
}

describe('photo uploads', () => {
  test('an author attaches a photo; the original is stored byte-for-byte with its hash', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Поход' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'Вышли в семь')

      const upload = await uploadImage(app, author, entry.id)
      expect(upload.status).toBe(201)
      const image = upload.body as EntryImageDto
      expect(image.state).toBe('processing')

      // The entry now carries the photo, and names no URL.
      const shown = await getEntry(app, author, entry.id)
      expect(shown.images).toHaveLength(1)
      expect(shown.images[0]?.id).toBe(image.id)
      expect(JSON.stringify(shown)).not.toContain('spaces/')

      // The original comes back exactly as it arrived: the same bytes, the
      // same declared type.
      const original = await app.inject({
        method: 'GET',
        url: `/api/v1/journal/entries/${entry.id}/images/${image.id}/variants/original`,
        headers: memberHeaders(author),
      })
      expect(original.statusCode).toBe(200)
      expect(original.headers['content-type']).toBe('image/jpeg')
      expect(original.rawPayload).toEqual(JPEG_BYTES)
      expect(createHash('sha256').update(original.rawPayload).digest('hex')).toBe(
        createHash('sha256').update(JPEG_BYTES).digest('hex'),
      )
    })
  })

  test('an entry carries several photos, oldest first', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Несколько' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'Три кадра')

      const first = (await uploadImage(app, author, entry.id)).body as EntryImageDto
      harness.clock.advance(10)
      const second = (await uploadImage(app, author, entry.id)).body as EntryImageDto
      harness.clock.advance(10)
      const third = (await uploadImage(app, author, entry.id)).body as EntryImageDto

      const shown = await getEntry(app, author, entry.id)
      expect(shown.images.map((image) => image.id)).toEqual([first.id, second.id, third.id])
    })
  })

  test('only the author attaches photos: a stranger on a draft is 404, on a published entry 403', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Чужое' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const stranger = await provisionAndSignIn(app, space.id, 'Дима')

      const draft = await createEntry(app, author, 'черновик')
      expect((await uploadImage(app, stranger, draft.id)).status).toBe(404)

      const shared = await createEntry(app, author, 'общая')
      await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${shared.id}/publish`,
        headers: memberHeaders(author),
      })
      const attempt = await uploadImage(app, stranger, shared.id)
      expect(attempt.status).toBe(403)
      expect(attempt.body).toMatchObject({ error: { code: 'author_required' } })

      // And nothing was stored: the refusal came before a byte was read.
      const keys = await harness.storage.list(`spaces/${space.id}/${IMAGE_OBJECT_KIND}/`)
      expect(keys).toEqual([])
    })
  })

  test('a hidden journal section refuses photos; another space names nothing', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Скрытый раздел' })
      const owner = await provisionAndSignIn(app, space.id, 'Аня', 'owner')
      const other = await harness.createSpace({ name: 'Другое пространство' })
      const outsider = await provisionAndSignIn(app, other.id, 'Миша')

      const entry = await createEntry(app, owner, 'до скрытия')

      // Hide the section; the gate answers before the handler runs.
      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { journal: false } },
      })
      expect(hide.statusCode).toBe(200)
      const hidden = await uploadImage(app, owner, entry.id)
      expect(hidden.status).toBe(404)
      expect(hidden.body).toMatchObject({ error: { code: 'section_hidden' } })

      // Another space's entry id names nothing here — nothing of Miша's
      // upload reaches this space's storage.
      const attempt = await uploadImage(app, outsider, entry.id)
      expect(attempt.status).toBe(404)
      const keys = await harness.storage.list(`spaces/${space.id}/${IMAGE_OBJECT_KIND}/`)
      expect(keys).toEqual([])
    })
  })

  test('the upload limit refuses an oversized photo with 413', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Лимит' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'большая фотография')

      const limited = harness.buildTestApp({ mediaMaxUploadBytes: 1024 })
      await limited.ready()
      try {
        const response = await uploadImage(limited, author, entry.id, Buffer.alloc(4096, 7))
        expect(response.status).toBe(413)
        expect(response.body).toMatchObject({ error: { code: 'image_too_large' } })
        // The row was never created and nothing was stored.
        const shown = await getEntry(app, author, entry.id)
        expect(shown.images).toEqual([])
        const keys = await harness.storage.list(`spaces/${space.id}/${IMAGE_OBJECT_KIND}/`)
        expect(keys).toEqual([])
      } finally {
        await limited.close()
      }
    })
  })

  test('a declared non-image type is refused; so is a body without a file', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Тип' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'не фотография')

      const wrongType = await uploadImage(app, author, entry.id, Buffer.from('текст'), 'text/plain')
      expect(wrongType.status).toBe(415)
      expect(wrongType.body).toMatchObject({ error: { code: 'unsupported_image_type' } })

      const empty = await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${entry.id}/images`,
        headers: memberHeaders(author),
        payload: {},
      })
      // The multipart parser's own refusal of a body that is not one.
      expect(empty.statusCode).toBe(406)
    })
  })

  test('an entry carries at most twelve photos', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Двенадцать' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'полная плёнка')

      for (let index = 0; index < 12; index += 1) {
        harness.clock.advance(10)
        expect((await uploadImage(app, author, entry.id)).status).toBe(201)
      }
      const thirteenth = await uploadImage(app, author, entry.id)
      expect(thirteenth.status).toBe(409)
      expect(thirteenth.body).toMatchObject({ error: { code: 'image_limit_reached' } })

      // The refused upload never reached storage: twelve originals, no more.
      const keys = await harness.storage.list(`spaces/${space.id}/${IMAGE_OBJECT_KIND}/`)
      expect(keys).toHaveLength(12)
    })
  })

  test('an unsigned request is refused', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Гость' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'закрытая дверь')
      const body = multipartBody(JPEG_BYTES, 'image/jpeg')
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${entry.id}/images`,
        headers: { 'content-type': body.contentType },
        payload: body.payload,
      })
      expect(response.statusCode).toBe(401)
    })
  })
})

describe('photo access', () => {
  test("a draft's photos are its author's alone until the entry is published", async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Черновик на замке' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const stranger = await provisionAndSignIn(app, space.id, 'Дима')
      const entry = await createEntry(app, author, 'пока тайна')
      const image = (await uploadImage(app, author, entry.id)).body as EntryImageDto

      const url = `/api/v1/journal/entries/${entry.id}/images/${image.id}/variants/original`
      expect(
        (await app.inject({ method: 'GET', url, headers: memberHeaders(stranger) })).statusCode,
      ).toBe(404)
      expect(
        (await app.inject({ method: 'GET', url, headers: memberHeaders(author) })).statusCode,
      ).toBe(200)

      await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${entry.id}/publish`,
        headers: memberHeaders(author),
      })
      expect(
        (await app.inject({ method: 'GET', url, headers: memberHeaders(stranger) })).statusCode,
      ).toBe(200)
    })
  })

  test('a photo of another space is not found, whatever the id', async () => {
    await withApp(async (app) => {
      const first = await harness.createSpace({ name: 'Первое' })
      const second = await harness.createSpace({ name: 'Второе' })
      const anna = await provisionAndSignIn(app, first.id, 'Аня')
      const misha = await provisionAndSignIn(app, second.id, 'Миша')

      const entry = await createEntry(app, anna, 'моё')
      const image = (await uploadImage(app, anna, entry.id)).body as EntryImageDto

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/journal/entries/${entry.id}/images/${image.id}/variants/feed`,
        headers: memberHeaders(misha),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'image_not_found' } })
    })
  })

  test('a derivative that the worker has not made yet is 404 image_not_ready', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Ещё не готово' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'обрабатывается')
      const image = (await uploadImage(app, author, entry.id)).body as EntryImageDto

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/journal/entries/${entry.id}/images/${image.id}/variants/feed`,
        headers: memberHeaders(author),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'image_not_ready' } })
    })
  })
})

describe('photo removal', () => {
  test('the author removes a photo; the storage objects go with it', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Убрать' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const entry = await createEntry(app, author, 'лишний кадр')
      const image = (await uploadImage(app, author, entry.id)).body as EntryImageDto

      const removal = await app.inject({
        method: 'DELETE',
        url: `/api/v1/journal/entries/${entry.id}/images/${image.id}`,
        headers: memberHeaders(author),
      })
      expect(removal.statusCode).toBe(204)

      const shown = await getEntry(app, author, entry.id)
      expect(shown.images).toEqual([])
      // The objects' cleanup rode the transaction as an idempotent job;
      // the worker runs it, so the test does the same.
      const cleanups = harness.jobs.submissions.filter(
        (submission) => submission.name === MEDIA_DELETE_JOB,
      )
      expect(cleanups).toHaveLength(1)
      const cleanup = cleanups[0]
      if (cleanup === undefined) throw new Error('no cleanup job was queued')
      expect((cleanup.data as { imageIds: string[] }).imageIds).toEqual([image.id])
      for (const submission of cleanups) {
        await deleteEntryImageObjects(harness, submission.data as MediaDeleteJobData)
      }
      expect(await harness.storage.list(`spaces/${space.id}/${IMAGE_OBJECT_KIND}/`)).toEqual([])
    })
  })

  test('only the author removes: a stranger on a draft 404, another member on a published entry 403', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Не трогать' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const stranger = await provisionAndSignIn(app, space.id, 'Дима')

      const draft = await createEntry(app, author, 'черновик')
      const draftImage = (await uploadImage(app, author, draft.id)).body as EntryImageDto
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/v1/journal/entries/${draft.id}/images/${draftImage.id}`,
            headers: memberHeaders(stranger),
          })
        ).statusCode,
      ).toBe(404)

      const shared = await createEntry(app, author, 'общая')
      await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${shared.id}/publish`,
        headers: memberHeaders(author),
      })
      const sharedImage = (await uploadImage(app, author, shared.id)).body as EntryImageDto
      const attempt = await app.inject({
        method: 'DELETE',
        url: `/api/v1/journal/entries/${shared.id}/images/${sharedImage.id}`,
        headers: memberHeaders(stranger),
      })
      expect(attempt.statusCode).toBe(403)
      expect(attempt.json()).toMatchObject({ error: { code: 'author_required' } })
    })
  })
})

describe('photo changes travel the sync (issue #17)', () => {
  test('another member’s delta carries the entry on upload, on ready, and on removal', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Синхронно' })
      const author = await provisionAndSignIn(app, space.id, 'Аня')
      const reader = await provisionAndSignIn(app, space.id, 'Дима')
      const entry = await createEntry(app, author, 'общая запись')
      await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${entry.id}/publish`,
        headers: memberHeaders(author),
      })

      // The reader's cursor: everything up to now.
      const before = await app.inject({
        method: 'GET',
        url: '/api/v1/sync?since=0',
        headers: memberHeaders(reader),
      })
      const revisionBefore = (before.json() as { revision: string }).revision

      const image = (await uploadImage(app, author, entry.id, REAL_JPEG)).body as EntryImageDto
      const afterUpload = await app.inject({
        method: 'GET',
        url: `/api/v1/sync?since=${revisionBefore}`,
        headers: memberHeaders(reader),
      })
      const uploaded = (
        afterUpload.json() as {
          changes: Array<{ entity: string; entry?: { id: string; images: EntryImageDto[] } }>
        }
      ).changes.filter(
        (change) => change.entity === 'journal_entry' && change.entry?.id === entry.id,
      )
      expect(uploaded).toHaveLength(1)
      expect(uploaded[0]?.entry?.images.map((row) => row.id)).toEqual([image.id])

      // The worker's processing → ready transition re-delivers the entry —
      // through the real handler, whose entry stamp is the delivery.
      await generateEntryImageDerivatives(jobDepsFor(), { spaceId: space.id, imageId: image.id })
      const revisionAfterUpload = (afterUpload.json() as { revision: string }).revision
      const afterReady = await app.inject({
        method: 'GET',
        url: `/api/v1/sync?since=${revisionAfterUpload}`,
        headers: memberHeaders(reader),
      })
      const readyChanges = (
        afterReady.json() as {
          changes: Array<{ entity: string; entry?: { id: string; images: EntryImageDto[] } }>
        }
      ).changes.filter(
        (change) => change.entity === 'journal_entry' && change.entry?.id === entry.id,
      )
      expect(readyChanges).toHaveLength(1)
      expect(readyChanges[0]?.entry?.images[0]?.state).toBe('ready')

      // The removal re-delivers the shorter list.
      const removal = await app.inject({
        method: 'DELETE',
        url: `/api/v1/journal/entries/${entry.id}/images/${image.id}`,
        headers: memberHeaders(author),
      })
      expect(removal.statusCode).toBe(204)
      const revisionAfterReady = (afterReady.json() as { revision: string }).revision
      const afterRemoval = await app.inject({
        method: 'GET',
        url: `/api/v1/sync?since=${revisionAfterReady}`,
        headers: memberHeaders(reader),
      })
      const removed = (
        afterRemoval.json() as {
          changes: Array<{ entity: string; entry?: { id: string; images: EntryImageDto[] } }>
        }
      ).changes.filter(
        (change) => change.entity === 'journal_entry' && change.entry?.id === entry.id,
      )
      expect(removed).toHaveLength(1)
      expect(removed[0]?.entry?.images).toEqual([])
    })
  })

  test('a ready derivative is served with the hardening headers; a hidden section refuses', async () => {
    await withApp(async (app) => {
      const space = await harness.createSpace({ name: 'Готово' })
      const owner = await provisionAndSignIn(app, space.id, 'Аня', 'owner')
      const entry = await createEntry(app, owner, 'опубликованная')
      await app.inject({
        method: 'POST',
        url: `/api/v1/journal/entries/${entry.id}/publish`,
        headers: memberHeaders(owner),
      })
      const image = (await uploadImage(app, owner, entry.id, REAL_JPEG)).body as EntryImageDto

      // The worker's part, done by hand: the row turns ready and the
      // derivative sits in storage.
      await harness.storage.put(
        imageObjectKey(space.id, image.id, 'feed'),
        Readable.from(Buffer.from('webp-bytes')),
      )
      await generateEntryImageDerivatives(jobDepsFor(), { spaceId: space.id, imageId: image.id })

      const url = `/api/v1/journal/entries/${entry.id}/images/${image.id}/variants/feed`
      const served = await app.inject({ method: 'GET', url, headers: memberHeaders(owner) })
      expect(served.statusCode).toBe(200)
      expect(served.headers['content-type']).toBe('image/webp')
      expect(served.headers['x-content-type-options']).toBe('nosniff')
      expect(served.headers['cache-control']).toBe('private, no-store')

      const original = await app.inject({
        method: 'GET',
        url: `/api/v1/journal/entries/${entry.id}/images/${image.id}/variants/original`,
        headers: memberHeaders(owner),
      })
      expect(original.headers['cache-control']).toBe('private, no-store')

      // A hidden journal answers before the handler runs.
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(owner),
        payload: { sections: { journal: false } },
      })
      const hidden = await app.inject({ method: 'GET', url, headers: memberHeaders(owner) })
      expect(hidden.statusCode).toBe(404)
      expect(hidden.json()).toMatchObject({ error: { code: 'section_hidden' } })
    })
  })
})

function jobDepsFor() {
  return {
    db: harness.db,
    clock: harness.clock,
    storage: harness.storage,
    touchEntry: touchEntryRevision,
  }
}
