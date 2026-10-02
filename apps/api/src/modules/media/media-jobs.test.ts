import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { instanceSettings } from '../admin/tables.ts'
import { createDraft, touchEntryRevision } from '../journal/service.ts'
import { FEED_MAX_EDGE, FULL_MAX_EDGE } from './derivatives.ts'
import { generateEntryImageDerivatives, MEDIA_DELETE_JOB, MEDIA_DERIVATIVES_JOB } from './jobs.ts'
import { imageObjectKey } from './keys.ts'
import { getImageInSpace } from './repository.ts'
import { deleteEntryImage, uploadEntryImage } from './service.ts'
import type { EntryImage } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

// The installation settings are a singleton other test files may have
// changed (the files share one database).
await harness.db.delete(instanceSettings)

/*
 * The derivatives worker (issue #17): every uploaded photo ends as two
 * metadata-free WebP derivatives while the original stays byte-for-byte
 * (ADR-0008). HEIC — the iPhone case — decodes through the worker image's
 * `heif-dec`, so its test needs that decoder on the machine; the release
 * smoke runs the same decode inside the shipped image on amd64 and arm64.
 * The handler runs twice, because queue delivery is at-least-once
 * (ADR-0009): the second run must answer without writing.
 */

/** The committed HEIC fixture: a 480×360 photo in the iPhone's format. */
const HEIC_BYTES = await readFile(
  fileURLToPath(new URL('../../testing/fixtures/sample.heic', import.meta.url)),
)

/** A JPEG that carries what an iPhone photo carries: EXIF with a GPS fix. */
async function photoWithExif(): Promise<Buffer> {
  return sharp({
    create: { width: 1600, height: 1000, channels: 3, background: { r: 30, g: 90, b: 140 } },
  })
    .jpeg()
    .withMetadata({
      // The GPS block is what an iPhone photo carries and what must never
      // reach the derivatives; sharp's type names only the IFDs, the
      // runtime writes the GPS IFD all the same.
      exif: {
        IFD0: { Copyright: 'ohana-test' },
        GPS: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 45/1 0/1' },
      } as unknown as import('sharp').Exif,
    })
    .toBuffer()
}

const allowAll = async () => {}

/**
 * The arrange step stays at the seams: a draft through the journal
 * service, the photo through the media service — the same calls the
 * routes and the api process make.
 */
async function entryWithPhoto(
  spaceId: string,
  memberId: string,
  bytes: Buffer,
  contentType = 'image/jpeg',
): Promise<{ entryId: string; image: EntryImage }> {
  const draft = await createDraft(
    { db: harness.db, clock: harness.clock, jobs: harness.jobs },
    { memberId, spaceId, role: 'regular' },
    { text: 'с фотографией' },
  )
  const image = await uploadEntryImage(
    {
      db: harness.db,
      storage: harness.storage,
      clock: harness.clock,
      jobs: harness.jobs,
      touchEntry: touchEntryRevision,
    },
    { spaceId, memberId, role: 'regular' },
    draft.id,
    { stream: Readable.from(bytes), contentType },
    { authorize: allowAll, authorizeInTx: allowAll, maxBytes: 26_214_400 },
  )
  return { entryId: draft.id, image }
}

function jobDeps() {
  return {
    db: harness.db,
    clock: harness.clock,
    storage: harness.storage,
    touchEntry: touchEntryRevision,
  }
}

function serviceDeps() {
  return { db: harness.db, storage: harness.storage, clock: harness.clock, jobs: harness.jobs }
}

async function draftId(spaceId: string, memberId: string): Promise<string> {
  const draft = await createDraft(
    { db: harness.db, clock: harness.clock, jobs: harness.jobs },
    { memberId, spaceId, role: 'regular' },
    { text: 'с фотографией' },
  )
  return draft.id
}

async function generateFor(spaceId: string, imageId: string): Promise<void> {
  await generateEntryImageDerivatives(jobDeps(), { spaceId, imageId })
}

async function rowOf(spaceId: string, imageId: string): Promise<EntryImage | undefined> {
  return getImageInSpace(harness.db, spaceId, imageId)
}

async function storedVariant(
  spaceId: string,
  imageId: string,
  variant: 'feed' | 'full' | 'original',
): Promise<Buffer> {
  const stream = await harness.storage.get(imageObjectKey(spaceId, imageId, variant))
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

describe('generateEntryImageDerivatives', () => {
  test('a JPEG with EXIF and GPS becomes two metadata-free WebP derivatives', async () => {
    const space = await harness.createSpace({ name: 'Без координат' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const original = await photoWithExif()
    // Sanity: the fixture really carries the metadata that must not leak.
    expect((await sharp(original).metadata()).exif).toBeDefined()

    const entry = await entryWithPhoto(space.id, member.id, original)
    await generateFor(space.id, entry.image.id)

    const feedBytes = await storedVariant(space.id, entry.image.id, 'feed')
    const fullBytes = await storedVariant(space.id, entry.image.id, 'full')
    const feed = await sharp(feedBytes).metadata()
    const full = await sharp(fullBytes).metadata()

    for (const [bytes, meta] of [
      [feedBytes, feed],
      [fullBytes, full],
    ] as const) {
      expect(meta.format).toBe('webp')
      // No EXIF block survives: sharp's metadata carries none, and the
      // bytes hold no marker for another parser to find.
      expect(meta.exif).toBeUndefined()
      expect(bytes.toString('latin1')).not.toContain('Exif')
      expect(bytes.toString('latin1')).not.toContain('ohana-test')
    }
    expect(feed.width).toBeLessThanOrEqual(FEED_MAX_EDGE)
    expect(full.width).toBeLessThanOrEqual(FULL_MAX_EDGE)
    expect(full.width).toBeGreaterThan(feed.width ?? 0)

    // The row is ready and names the feed size the screens lay out with.
    const row = await rowOf(space.id, entry.image.id)
    expect(row?.state).toBe('ready')
    expect(row?.width).toBe(feed.width)
    expect(row?.height).toBe(feed.height)

    // The original is untouched: byte-for-byte (ADR-0008).
    expect(await storedVariant(space.id, entry.image.id, 'original')).toEqual(original)

    // The derivatives job was scheduled inside the upload's transaction.
    expect(harness.jobs.submissions.map((submission) => submission.name)).toContain(
      MEDIA_DERIVATIVES_JOB,
    )
  })

  test('HEIC input produces derivatives through the worker image decoder', async () => {
    const space = await harness.createSpace({ name: 'Айфон' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const entry = await entryWithPhoto(space.id, member.id, HEIC_BYTES, 'image/heic')

    await generateFor(space.id, entry.image.id)

    const feed = await sharp(await storedVariant(space.id, entry.image.id, 'feed')).metadata()
    expect(feed.format).toBe('webp')
    expect(feed.width).toBeLessThanOrEqual(FEED_MAX_EDGE)
    expect((await rowOf(space.id, entry.image.id))?.state).toBe('ready')
  })

  test('the original keeps its recorded hash through processing', async () => {
    const space = await harness.createSpace({ name: 'Неизменный' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const original = await photoWithExif()
    const entry = await entryWithPhoto(space.id, member.id, original)
    const hashBefore = entry.image.originalSha256

    await generateFor(space.id, entry.image.id)

    const row = await rowOf(space.id, entry.image.id)
    expect(row?.originalSha256).toBe(hashBefore)
    expect(await storedVariant(space.id, entry.image.id, 'original')).toEqual(original)
  })

  test('an undecodable photo is marked failed; the repeat run writes nothing new', async () => {
    const space = await harness.createSpace({ name: 'Битая' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const entry = await entryWithPhoto(
      space.id,
      member.id,
      Buffer.from('это не изображение'),
      'image/jpeg',
    )
    const revisionBefore = entry.image.revision

    await expect(generateFor(space.id, entry.image.id)).rejects.toThrow()
    expect((await rowOf(space.id, entry.image.id))?.state).toBe('failed')
    const failedRevision = (await rowOf(space.id, entry.image.id))?.revision
    expect(failedRevision).toBeGreaterThan(revisionBefore)

    // The at-least-once repeat tries again and fails again — but the
    // failure write is not repeated, so the revision stands still.
    await expect(generateFor(space.id, entry.image.id)).rejects.toThrow()
    expect((await rowOf(space.id, entry.image.id))?.revision).toBe(failedRevision)
  })

  test('a photo removed mid-flight has its fresh derivatives cleaned up', async () => {
    const space = await harness.createSpace({ name: 'Мимо' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const entry = await entryWithPhoto(space.id, member.id, await photoWithExif())

    // The removal happens while the job runs, staged where the handler
    // cannot miss it: the landing of the feed derivative performs the
    // author's removal through the real service. The handler's first read
    // still saw the row; the state write under the lock does not.
    const racingDeps = {
      ...jobDeps(),
      storage: {
        ...harness.storage,
        put: async (
          key: string,
          body: Parameters<typeof harness.storage.put>[1],
          options: Parameters<typeof harness.storage.put>[2],
        ): Promise<void> => {
          await harness.storage.put(key, body, options)
          if (key.endsWith('/feed')) {
            await deleteEntryImage(
              {
                db: harness.db,
                storage: harness.storage,
                clock: harness.clock,
                jobs: harness.jobs,
                touchEntry: touchEntryRevision,
              },
              { spaceId: space.id, memberId: member.id, role: 'regular' },
              entry.entryId,
              entry.image.id,
              { authorizeInTx: allowAll },
            )
          }
        },
      },
    }

    await generateEntryImageDerivatives(racingDeps, {
      spaceId: space.id,
      imageId: entry.image.id,
    })

    // Nothing readable is left under the photo's keys: the removal's own
    // delete job and the handler's post-lock cleanup both ran.
    expect(await harness.storage.list(`spaces/${space.id}/journal/`)).toEqual([])
  })

  test('a machine with no HEIC decoder fails the decode as one loud failure', async () => {
    const { heicDecodeToPng, HeicDecodeError } = await import('./heic.ts')
    vi.stubEnv('PATH', '')
    try {
      await expect(heicDecodeToPng(HEIC_BYTES)).rejects.toBeInstanceOf(HeicDecodeError)
      await expect(heicDecodeToPng(HEIC_BYTES)).rejects.toThrow('no HEIC decoder is installed')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('a refused upload whose cleanup delete also fails queues the cleanup job', async () => {
    const space = await harness.createSpace({ name: 'Двойной отказ' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const refusingDelete = {
      ...harness.storage,
      delete: async (): Promise<void> => {
        throw new Error('storage refuses the delete too')
      },
    }
    const submissionsBefore = harness.jobs.submissions.length
    await expect(
      uploadEntryImage(
        { ...serviceDeps(), storage: refusingDelete, touchEntry: touchEntryRevision },
        { spaceId: space.id, memberId: member.id, role: 'regular' },
        await draftId(space.id, member.id),
        { stream: Readable.from(Buffer.alloc(0)), contentType: 'image/jpeg' },
        { authorize: allowAll, authorizeInTx: allowAll, maxBytes: 26_214_400 },
      ),
    ).rejects.toMatchObject({ code: 'image_required' })

    const cleanups = harness.jobs.submissions
      .slice(submissionsBefore)
      .filter((submission) => submission.name === MEDIA_DELETE_JOB)
    expect(cleanups).toHaveLength(1)
    const cleanup = cleanups[0]
    if (cleanup === undefined) throw new Error('no cleanup job was queued')
    expect((cleanup.data as { imageIds: string[] }).imageIds).toHaveLength(1)
  })

  test('a refused upload leaves nothing in storage: an empty file, and a refusal mid-transaction', async () => {
    const space = await harness.createSpace({ name: 'Пусто' })
    const member = await harness.createMember(space.id, { name: 'Аня' })

    // An empty file answers 400 before the row is made, and its bytes —
    // already streamed into storage — are taken back.
    await expect(
      uploadEntryImage(
        { ...serviceDeps(), touchEntry: touchEntryRevision },
        { spaceId: space.id, memberId: member.id, role: 'regular' },
        await draftId(space.id, member.id),
        { stream: Readable.from(Buffer.alloc(0)), contentType: 'image/jpeg' },
        { authorize: allowAll, authorizeInTx: allowAll, maxBytes: 26_214_400 },
      ),
    ).rejects.toMatchObject({ code: 'image_required' })
    expect(await harness.storage.list(`spaces/${space.id}/journal/`)).toEqual([])

    // A transaction that refuses — the author lost the entry between the
    // pre-flight and the commit — takes the stored bytes with it.
    await expect(
      uploadEntryImage(
        { ...serviceDeps(), touchEntry: touchEntryRevision },
        { spaceId: space.id, memberId: member.id, role: 'regular' },
        await draftId(space.id, member.id),
        { stream: Readable.from(Buffer.from('настоящие байты')), contentType: 'image/jpeg' },
        {
          authorize: allowAll,
          authorizeInTx: async () => {
            throw new Error('the entry was trashed mid-upload')
          },
          maxBytes: 26_214_400,
        },
      ),
    ).rejects.toThrow('the entry was trashed mid-upload')
    expect(await harness.storage.list(`spaces/${space.id}/journal/`)).toEqual([])
  })

  test('a photo that is gone, or already ready, answers without writing', async () => {
    // No such photo: the handler answers, nothing throws.
    await expect(
      generateEntryImageDerivatives(jobDeps(), {
        spaceId: '00000000-0000-7000-8000-00000000dead',
        imageId: '00000000-0000-7000-8000-000000000000',
      }),
    ).resolves.toBeUndefined()

    const space = await harness.createSpace({ name: 'Уже готово' })
    const member = await harness.createMember(space.id, { name: 'Аня' })
    const entry = await entryWithPhoto(space.id, member.id, await photoWithExif())
    await generateFor(space.id, entry.image.id)
    const revision = (await rowOf(space.id, entry.image.id))?.revision

    await generateFor(space.id, entry.image.id)
    expect((await rowOf(space.id, entry.image.id))?.revision).toBe(revision)
  })
})
