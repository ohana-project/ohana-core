import { Readable } from 'node:stream'
import { buffer as readWholeStream } from 'node:stream/consumers'
import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import type { ObjectStorage } from '../../platform/storage/index.ts'
import { recordChanges } from '../sync/index.ts'
import { generateDerivatives } from './derivatives.ts'
import { imageObjectKey } from './keys.ts'
import { getImageInSpace, updateImageState } from './repository.ts'
import type { EntryImage } from './tables.ts'

/*
 * The media worker handlers (issue #17, ADR-0009): the derivatives of one
 * uploaded photo. The handler is safe to repeat — a second run finds the
 * photo ready and answers without writing — and it reports failure twice:
 * the queue retry decides whether the environment fixes itself, and the
 * row's `failed` state tells the screens the photo will not arrive, so the
 * feed never spins forever over an undecodable upload.
 */

/** The queue name of the derivatives job a finished upload schedules. */
export const MEDIA_DERIVATIVES_JOB = 'media-derivatives'

/** The queues this module's use cases send to — the api process ensures them. */
export const MEDIA_SENT_QUEUES = [MEDIA_DERIVATIVES_JOB] as const

export interface MediaDerivativesJobData {
  spaceId: string
  imageId: string
}

export interface MediaJobsDeps {
  db: Db
  storage: ObjectStorage
  clock: Clock
}

/**
 * Generates both derivatives of one photo and marks it ready with the
 * space's next revision — the entry DTO embeds the photo, so the revision
 * bump is what tells every device the preview exists. The original's bytes
 * are read once and never rewritten; a photo the decoder refuses is marked
 * failed and the error rethrown for the queue's retry.
 */
export async function generateEntryImageDerivatives(
  deps: MediaJobsDeps,
  data: MediaDerivativesJobData,
): Promise<void> {
  const image = await getImageInSpace(deps.db, data.spaceId, data.imageId)
  if (image === undefined || image.state === 'ready') return

  // The original is bounded by the upload limit the row recorded, so
  // reading it whole is bounded by configuration, not by trust.
  const original = await readWholeStream(
    await deps.storage.get(imageObjectKey(data.spaceId, data.imageId, 'original')),
  )
  try {
    const derivatives = await generateDerivatives(original)
    for (const derivative of derivatives) {
      await deps.storage.put(
        imageObjectKey(data.spaceId, data.imageId, derivative.variant),
        Readable.from(derivative.bytes),
        { contentType: 'image/webp' },
      )
    }
    // The row records the feed derivative's size: the screens lay the
    // photo strip out with it before the bytes arrive.
    const feed = derivatives[0]
    if (feed === undefined) throw new Error('Generating derivatives produced no feed variant')
    await finalize(deps, data, 'ready', { width: feed.width, height: feed.height })
  } catch (cause) {
    await finalize(deps, data, 'failed')
    throw cause
  }
}

/**
 * The state write, inside the space's transaction and revision. Skips
 * silently when the photo is gone (its entry was purged mid-flight) or
 * already sits in the requested state — at-least-once delivery must not
 * churn the space's revision.
 */
async function finalize(
  deps: MediaJobsDeps,
  data: MediaDerivativesJobData,
  state: EntryImage['state'],
  size?: { width: number; height: number },
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    const image = await getImageInSpace(tx, data.spaceId, data.imageId)
    if (image === undefined || image.state === state) return
    await recordChanges(
      tx,
      data.spaceId,
      {
        writes: async (writeTx, revision) => {
          await updateImageState(
            writeTx,
            data.spaceId,
            data.imageId,
            { state, ...size },
            revision,
            now,
          )
        },
      },
      now,
    )
  })
}
