import { Readable } from 'node:stream'
import { buffer as readWholeStream } from 'node:stream/consumers'
import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import type { QueueSetup } from '../../platform/jobs/index.ts'
import type { ObjectStorage } from '../../platform/storage/index.ts'
import { lockSpace } from '../spaces/index.ts'
import { recordChanges } from '../sync/index.ts'
import { generateDerivatives } from './derivatives.ts'
import { deleteImageObjects, imageObjectKey } from './keys.ts'
import { getImageInSpace, updateImageState } from './repository.ts'
import type { EntryTouch } from './service.ts'
import type { EntryImage } from './tables.ts'

/*
 * The media worker handlers (issue #17, ADR-0009): the derivatives of one
 * uploaded photo, and the deferred cleanup of a removed photo's objects.
 * Both check current state before acting — delivery is at-least-once — and
 * the derivatives handler reports failure twice: the queue retry decides
 * whether the environment fixes itself, and the row's `failed` state tells
 * the screens the photo will not arrive, so the feed never spins forever
 * over an undecodable upload. The delete handler has no state to check —
 * deleting is idempotent.
 */

/** The queue name of the derivatives job a finished upload schedules. */
export const MEDIA_DERIVATIVES_JOB = 'media-derivatives'

/** The queue name of the idempotent storage cleanup a removal or a purge schedules. */
export const MEDIA_DELETE_JOB = 'media-delete-objects'

/**
 * The queues this module's use cases send to — the api process ensures
 * the same set, with the same creation options. Retries are the point of
 * the delete job (it exists to survive a storage hiccup), and the
 * derivatives job's transient failures deserve the same patience; every
 * handler also checks current state before acting, so a repeated delivery
 * writes nothing twice.
 */
export const MEDIA_QUEUE_SETUPS: QueueSetup[] = [
  { name: MEDIA_DERIVATIVES_JOB, options: { retryLimit: 5, retryDelay: 30, retryBackoff: true } },
  { name: MEDIA_DELETE_JOB, options: { retryLimit: 10, retryDelay: 30, retryBackoff: true } },
]

export interface MediaDerivativesJobData {
  spaceId: string
  imageId: string
}

export interface MediaDeleteJobData {
  spaceId: string
  imageIds: readonly string[]
}

export interface MediaJobsDeps {
  db: Db
  storage: ObjectStorage
  clock: Clock
  /** The entry stamp that carries a photo's state change through the sync. */
  touchEntry: EntryTouch
}

/**
 * Generates both derivatives of one photo and marks it ready with the
 * space's next revision — the entry DTO embeds the photo, so the entry
 * stamp inside the same transaction is what tells every device the preview
 * exists. The original's bytes are read once and never rewritten; a photo
 * the decoder refuses is marked failed and the error rethrown for the
 * queue's retry.
 */
export async function generateEntryImageDerivatives(
  deps: MediaJobsDeps,
  data: MediaDerivativesJobData,
): Promise<void> {
  const image = await getImageInSpace(deps.db, data.spaceId, data.imageId)
  if (image === undefined) {
    // The row is gone before this run started: a removal or purge raced
    // the queue, and its delete job cannot have seen the derivatives a
    // killed earlier run may have left. Cleaning up here is that run's
    // last chance, and the retry arrives at the same answer.
    await deleteImageObjects(deps.storage, data.spaceId, data.imageId)
    return
  }
  if (image.state === 'ready') return

  try {
    // The original is bounded by the upload limit the row recorded, so
    // reading it whole is bounded by configuration, not by trust. Inside
    // the try: a missing original is this photo's failure to report.
    const original = await readWholeStream(
      await deps.storage.get(imageObjectKey(data.spaceId, data.imageId, 'original')),
    )
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
    const gone = await finalize(deps, data, 'ready', { width: feed.width, height: feed.height })
    // The entry was purged — or its photo removed — while the derivatives
    // were in flight: the bytes just written are cleaned up here, where the
    // delete job that raced them cannot have seen them.
    if (gone) {
      // The last chance: the removal's delete job ran before these bytes
      // existed. Throwing is what brings the retry back here.
      await deleteImageObjects(deps.storage, data.spaceId, data.imageId)
    }
  } catch (cause) {
    // The same race on the failure path: a feed derivative may exist while
    // the row does not.
    const gone = await finalize(deps, data, 'failed')
    if (gone) {
      await deleteImageObjects(deps.storage, data.spaceId, data.imageId)
    }
    throw cause
  }
}

/**
 * The state write, inside the space's transaction: the space row lock
 * comes first, the row is re-read under it, and the stamp on the entry
 * carries the new state to every device. Answers whether the photo is gone
 * (purged or removed mid-flight); skips silently when it already sits in
 * the requested state — at-least-once delivery must not churn the space's
 * revision.
 */
async function finalize(
  deps: MediaJobsDeps,
  data: MediaDerivativesJobData,
  state: EntryImage['state'],
  size?: { width: number; height: number },
): Promise<boolean> {
  const now = deps.clock.now()
  return deps.db.transaction(async (tx) => {
    await lockSpace(tx, data.spaceId)
    const image = await getImageInSpace(tx, data.spaceId, data.imageId)
    if (image === undefined) return true
    if (image.state === state) return false
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
          await deps.touchEntry(writeTx, data.spaceId, image.entryId, revision)
        },
      },
      now,
    )
    return false
  })
}

/**
 * The deferred cleanup of removed photos' storage objects (issue #17). The
 * rows are already gone when it runs — the removal and the purge schedule
 * it inside their own transactions — so this is the whole cleanup: an
 * idempotent sweep over the keys, retried under the queue's explicit
 * limits until storage takes every delete.
 */
export async function deleteEntryImageObjects(
  deps: { storage: ObjectStorage },
  data: MediaDeleteJobData,
): Promise<void> {
  for (const imageId of data.imageIds) {
    await deleteImageObjects(deps.storage, data.spaceId, imageId)
  }
}
