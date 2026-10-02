import { createHash } from 'node:crypto'
import { type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { uuidv7 } from '../../platform/db/uuid.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import type { JobSender } from '../../platform/jobs/index.ts'
import {
  ObjectNotFoundError,
  type ObjectStorage,
  StorageError,
  type StoredObject,
} from '../../platform/storage/index.ts'
import { recordChanges } from '../sync/index.ts'
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGES_PER_ENTRY } from './contracts.ts'
import {
  MEDIA_DELETE_JOB,
  MEDIA_DERIVATIVES_JOB,
  type MediaDeleteJobData,
  type MediaDerivativesJobData,
} from './jobs.ts'
import { type ImageVariant, imageObjectKey } from './keys.ts'
import {
  countImagesOfEntry,
  deleteImage,
  getImageInSpace,
  insertImage,
  listImagesForEntries,
} from './repository.ts'
import type { EntryImage } from './tables.ts'

/*
 * The media service (issue #17): the life of a journal photo — the upload
 * that streams through the API into storage, the authorised reads that
 * stream it back out, the removal, and the derivatives the worker owes.
 *
 * The photos belong to journal entries, so the permission rules are the
 * journal's (policy.ts): who may attach or remove a photo is decided by
 * the module that owns entries. This module never imports upward — the
 * composition root wires the two checks in as functions, exactly like the
 * spaces module's member counter, so the dependency graph stays acyclic.
 */

export interface MediaDeps {
  db: Db
  storage: ObjectStorage
  clock: Clock
  /** The jobs port: a finished upload schedules its derivatives inside the same transaction. */
  jobs: JobSender
  /**
   * The port that re-delivers the photo's entry (issue #17): photos ride
   * the entry's DTO, and the sync delta filters on the entry row — so every
   * photo change stamps the entry with the transaction's revision. The
   * journal owns the entry table; the composition root wires it in, like
   * the access rules.
   */
  touchEntry: EntryTouch
}

/**
 * Stamps the entry row with the transaction's revision — the write that
 * carries a photo change through the sync. Only the revision moves: a
 * photo is not a text edit, and the entry's updatedAt stays.
 */
export type EntryTouch = (
  tx: Tx,
  spaceId: string,
  entryId: string,
  revision: bigint,
) => Promise<void>

/** The member a media use case runs for; the space always comes from the actor. */
export interface MediaActor {
  memberId: string
  spaceId: string
  role: 'owner' | 'regular'
}

/**
 * The port the journal fills: whether this actor may serve this entry's
 * photos (reads) or change them (attach, remove). The edit rule comes in
 * two flavours because the upload checks twice — a lock-free pre-flight
 * on the pool before a byte is read, and the space-locked recheck inside
 * its transaction. Receives the executor so the check runs on the caller's
 * connection.
 */
export type ImageAccessRule = (
  executor: Executor,
  actor: MediaActor,
  entryId: string,
) => Promise<void>

export type ImageAccessTxRule = (tx: Tx, actor: MediaActor, entryId: string) => Promise<void>

export interface IncomingImage {
  stream: Readable
  /** The content type the upload declared for itself. */
  contentType: string
}

export interface StoredImage {
  stream: Readable
  contentType: string
  size: number
}

/**
 * A stream that counts and hashes the bytes it passes through, refusing
 * anything past the configured limit. The measure settles when the input
 * ends — and rejects when the stream errors or is closed early, so the
 * caller never waits on a vanished upload.
 */
function measureStream(maxBytes: number): {
  stream: Transform
  measured: Promise<{ bytes: number; sha256: string }>
} {
  const hash = createHash('sha256')
  let bytes = 0
  let settled = false
  let resolveMeasured!: (measure: { bytes: number; sha256: string }) => void
  let rejectMeasured!: (cause: unknown) => void
  const measured = new Promise<{ bytes: number; sha256: string }>((resolve, reject) => {
    resolveMeasured = (measure) => {
      settled = true
      resolve(measure)
    }
    rejectMeasured = (cause) => {
      settled = true
      reject(cause)
    }
  })
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        callback(
          new DomainError(
            'image_too_large',
            `The photo exceeds the ${maxBytes}-byte upload limit`,
            413,
          ),
        )
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      resolveMeasured({ bytes, sha256: hash.digest('hex') })
      callback()
    },
  })
  stream.on('error', (cause) => {
    if (!settled) rejectMeasured(cause)
  })
  stream.on('close', () => {
    if (!settled) rejectMeasured(new Error('The upload stream closed before it was stored'))
  })
  return { stream, measured }
}

/**
 * Attaches one photo to an entry (issue #17). The permission check runs
 * before a byte is read; the original then streams into storage — hashed
 * and counted on the way, refused past the limit — and only when it is
 * durably stored does the transaction run: the authorship check again
 * under the space row lock, the per-entry cap, the row, and the
 * derivatives job, all inside it. The original's bytes are never parsed,
 * resized, or stripped — they are stored exactly as they arrived
 * (ADR-0008); the content type is only named, from a fixed raster
 * whitelist (an SVG served same-origin could carry scripts).
 */
export async function uploadEntryImage(
  deps: MediaDeps,
  actor: MediaActor,
  entryId: string,
  upload: IncomingImage,
  options: { authorize: ImageAccessRule; authorizeInTx: ImageAccessTxRule; maxBytes: number },
): Promise<EntryImage> {
  // The pre-flight: a stranger learns nothing about the entry (404) and no
  // byte of theirs is read; a full entry is refused before a byte of the
  // thirteenth photo is stored. The transaction below re-checks both under
  // the space row lock, so a change racing the upload is still honoured.
  await options.authorize(deps.db, actor, entryId)
  if ((await countImagesOfEntry(deps.db, actor.spaceId, entryId)) >= MAX_IMAGES_PER_ENTRY) {
    throw new DomainError(
      'image_limit_reached',
      `An entry carries at most ${MAX_IMAGES_PER_ENTRY} photos`,
      409,
    )
  }
  if (!(ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(upload.contentType)) {
    throw new DomainError(
      'unsupported_image_type',
      `The photo must be one of: ${ALLOWED_IMAGE_CONTENT_TYPES.join(', ')}`,
      415,
    )
  }

  // The id exists before the row: the object key names it, and the upload
  // must be streamed under its final name — no rename, no second write.
  const imageId = uuidv7()
  const { stream, measured } = measureStream(options.maxBytes)
  // The bytes flow parser → counter → storage. The pipe itself has no
  // story once the other two promises have spoken, so its rejection is
  // silenced — whichever of them fails first names the real cause.
  const pumped = pipeline(upload.stream, stream)
  void pumped.catch(() => {})
  measured.catch(() => {})
  let stored = false
  try {
    await deps.storage.put(imageObjectKey(actor.spaceId, imageId, 'original'), stream, {
      contentType: upload.contentType,
    })
    stored = true
    const { bytes, sha256 } = await measured
    if (bytes === 0) {
      // An empty upload would only die on the row's own check, a 500; it
      // is a client mistake, and says so.
      throw new DomainError('image_required', 'The upload carried no bytes', 400)
    }
    const now = deps.clock.now()
    const created = await deps.db.transaction(async (tx) => {
      await options.authorizeInTx(tx, actor, entryId)
      const count = await countImagesOfEntry(tx, actor.spaceId, entryId)
      if (count >= MAX_IMAGES_PER_ENTRY) {
        throw new DomainError(
          'image_limit_reached',
          `An entry carries at most ${MAX_IMAGES_PER_ENTRY} photos`,
          409,
        )
      }
      let row: EntryImage | undefined
      await recordChanges(
        tx,
        actor.spaceId,
        {
          writes: async (writeTx, revision) => {
            row = await insertImage(writeTx, actor.spaceId, {
              id: imageId,
              entryId,
              uploaderMemberId: actor.memberId,
              originalBytes: bytes,
              originalSha256: sha256,
              originalContentType: upload.contentType,
              revision,
              now,
            })
            // The entry carries the photo: its stamp is what delivers the
            // longer list to every device through the sync.
            await deps.touchEntry(writeTx, actor.spaceId, entryId, revision)
          },
        },
        now,
      )
      const job: MediaDerivativesJobData = { spaceId: actor.spaceId, imageId }
      await deps.jobs.sendInTx(tx, { name: MEDIA_DERIVATIVES_JOB, data: job })
      return row
    })
    if (created === undefined) throw new Error('Uploading an image produced no row')
    return created
  } catch (error) {
    // The limiter's refusal can arrive wrapped in the storage adapter's
    // error — the stream failed, so `put` reported it. Unwrap it, so the
    // answer stays the 413 the limit means.
    if (error instanceof StorageError && error.cause instanceof DomainError) {
      throw error.cause
    }
    // A refused upload — the cap, a racing trash, a hidden section, an
    // empty file — must not leave its bytes behind. The delete runs now;
    // if storage refuses even that, the queued cleanup repairs it.
    if (stored) {
      try {
        await deps.storage.delete(imageObjectKey(actor.spaceId, imageId, 'original'))
      } catch {
        await deps.db
          .transaction(async (tx) => {
            const job: MediaDeleteJobData = { spaceId: actor.spaceId, imageIds: [imageId] }
            await deps.jobs.sendInTx(tx, { name: MEDIA_DELETE_JOB, data: job })
          })
          .catch(() => {})
      }
    }
    throw error
  } finally {
    // Ended streams ignore this; an aborted upload leaves nothing half-read.
    upload.stream.destroy()
    stream.destroy()
  }
}

/**
 * One photo's bytes, streamed from storage through an authorised route.
 * A photo of another space — or an id that names no photo here — answers
 * 404 before the entry rule even runs, so nothing about other spaces is
 * revealed. A derivative of a photo the worker has not finished is 404
 * `image_not_ready`: the feed shows the state the DTO carried.
 */
export async function readEntryImage(
  deps: MediaDeps,
  actor: MediaActor,
  entryId: string,
  imageId: string,
  variant: ImageVariant,
  options: { authorize: ImageAccessRule },
): Promise<StoredImage> {
  const image = await getImageInSpace(deps.db, actor.spaceId, imageId)
  if (image === undefined || image.entryId !== entryId) {
    throw notFound('image_not_found', `Image ${imageId} does not exist`)
  }
  await options.authorize(deps.db, actor, entryId)

  let stored: StoredObject | null
  let stream: Readable
  try {
    if (variant === 'original') {
      stored = await deps.storage.head(imageObjectKey(actor.spaceId, imageId, 'original'))
      stream = await deps.storage.get(imageObjectKey(actor.spaceId, imageId, 'original'))
    } else {
      if (image.state !== 'ready') {
        throw notFound('image_not_ready', `Image ${imageId} has no derivatives yet`)
      }
      stored = await deps.storage.head(imageObjectKey(actor.spaceId, imageId, variant))
      stream = await deps.storage.get(imageObjectKey(actor.spaceId, imageId, variant))
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw notFound('image_not_found', `Image ${imageId} does not exist`)
    }
    throw error
  }
  if (stored === null) {
    throw notFound('image_not_found', `Image ${imageId} does not exist`)
  }
  return {
    stream,
    size: stored.size,
    contentType: variant === 'original' ? image.originalContentType : 'image/webp',
  }
}

/**
 * The author's removal of one photo (issue #17): the row goes in the
 * entry's transaction — the revision bump carries the shorter list to
 * every device — and the storage objects go afterwards, idempotently. A
 * crash between the two leaves unreachable objects, never a broken photo:
 * no route reaches an object whose row is gone.
 */
export async function deleteEntryImage(
  deps: MediaDeps,
  actor: MediaActor,
  entryId: string,
  imageId: string,
  options: { authorizeInTx: ImageAccessTxRule },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await options.authorizeInTx(tx, actor, entryId)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const deleted = await deleteImage(writeTx, actor.spaceId, entryId, imageId)
          if (deleted === undefined) {
            throw notFound('image_not_found', `Image ${imageId} does not exist`)
          }
          // The shorter list travels the way every photo change does: on
          // the entry's stamp.
          await deps.touchEntry(writeTx, actor.spaceId, entryId, revision)
        },
      },
      deps.clock.now(),
    )
    // The objects' cleanup rides the transaction as an idempotent job: the
    // removal is already committed, and a storage hiccup must not turn it
    // into an error the client sees — nor leave the bytes behind.
    const job: MediaDeleteJobData = { spaceId: actor.spaceId, imageIds: [imageId] }
    await deps.jobs.sendInTx(tx, { name: MEDIA_DELETE_JOB, data: job })
  })
}

/**
 * The photos of several entries, grouped for the entry DTO — the one
 * lookup the journal's reads and sync contributor use, so a feed page
 * costs a single query however many entries it carries.
 */
export async function imagesOfEntries(
  executor: Executor,
  spaceId: string,
  entryIds: readonly string[],
): Promise<Map<string, EntryImage[]>> {
  const rows = await listImagesForEntries(executor, spaceId, entryIds)
  const grouped = new Map<string, EntryImage[]>()
  for (const row of rows) {
    const group = grouped.get(row.entryId)
    if (group === undefined) grouped.set(row.entryId, [row])
    else group.push(row)
  }
  return grouped
}
