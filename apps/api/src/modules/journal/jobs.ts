import type { Clock } from '../../platform/clock.ts'
import type { Db, Tx } from '../../platform/db/index.ts'
import type { JobSender } from '../../platform/jobs/index.ts'
import { readTrashRetentionDays } from '../admin/index.ts'
import { imagesOfEntries, MEDIA_DELETE_JOB, type MediaDeleteJobData } from '../media/index.ts'
import { lockSpace } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import { JOURNAL_ENTRY_SYNC_ENTITY } from './contracts.ts'
import { purgeAtFor, trashedAtOf } from './policy.ts'
import {
  deleteDraftEntriesInSpace,
  deleteTrashedEntriesInSpace,
  listDraftsOfAuthor,
  getEntryInSpace,
  listPurgeableEntriesInSpace,
  listSpacesWithPurgeableEntriesAcrossSpaces,
} from './repository.ts'
import type { JournalEntry } from './tables.ts'

/*
 * The journal's worker handlers (issue #16, ADR-0009): the permanent purge
 * of trashed entries once their retention has run out. Two handlers cover
 * one rule — the per-entry job the trash use case schedules inside its own
 * transaction, and the recurring sweep that catches whatever the per-entry
 * jobs miss (a retention that grew, a worker that was down when a job came
 * due). Both check the current state before acting — delivery is
 * at-least-once, and both are safe to repeat: a second run finds the entry
 * already gone and answers without writing. The deletion, its tombstones,
 * and the space's revision bump share one transaction, exactly like a
 * write that arrives over HTTP. The entry's photos (issue #17) are part of
 * the purge: their rows cascade away with the entry's, and the removal of
 * their storage objects is scheduled inside the same transaction as an
 * idempotent job — a storage hiccup costs retries, never leaked bytes.
 */

/** The queue name of the per-entry purge job the trash use case schedules. */
export const JOURNAL_PURGE_JOB = 'journal-purge-entry'

/** The queue name of the recurring sweep. */
export const JOURNAL_PURGE_SWEEP_JOB = 'journal-purge-sweep'

/** The sweep runs hourly; the per-entry jobs make one entry's purge prompt. */
export const JOURNAL_PURGE_SWEEP_CRON = '0 * * * *'

/**
 * The queues this module's use cases send to — the list the api process
 * ensures exist, so the first trash never meets a queue the worker has
 * not created (architecture.md, "Background jobs"). The worker ensures
 * its own full set, including the sweep's queue.
 */
export const JOURNAL_SENT_QUEUES = [JOURNAL_PURGE_JOB] as const

export interface JournalPurgeJobData {
  spaceId: string
  entryId: string
}

export interface JournalJobsDeps {
  db: Db
  clock: Clock
  /** The jobs port: the purge schedules the objects' cleanup inside its transaction. */
  jobs: JobSender
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The tombstone a purge delivers, to the same audience the trash did: the
 * entry left every view already; this tells the devices it is gone for
 * good and is never coming back.
 */
function purgeTombstone(entry: JournalEntry): TombstoneInput {
  return entry.trashedFromState === 'published'
    ? { entity: JOURNAL_ENTRY_SYNC_ENTITY, entityId: entry.id, audience: { kind: 'all' } }
    : {
        entity: JOURNAL_ENTRY_SYNC_ENTITY,
        entityId: entry.id,
        audience: { kind: 'member', memberId: entry.authorMemberId },
      }
}

/**
 * Purges one trashed entry in its space's one transaction: the space row
 * lock comes first, the entry is re-read under it, and the delete carries
 * the tombstones and the revision bump. An entry that is not trashed any
 * more (a restore won the race) or is not due yet (the retention grew
 * since the job was scheduled) answers without writing — the sweep
 * re-checks when the recomputed date arrives.
 */
export async function purgeTrashedEntry(
  deps: JournalJobsDeps,
  data: JournalPurgeJobData,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await lockSpace(tx, data.spaceId)
    const entry = await getEntryInSpace(tx, data.spaceId, data.entryId)
    if (entry === undefined || entry.state !== 'trashed') return
    const retentionDays = await readTrashRetentionDays(tx)
    if (purgeAtFor(trashedAtOf(entry), retentionDays) > now) return
    const grouped = await imagesOfEntries(tx, data.spaceId, [entry.id])
    const imageIds = (grouped.get(entry.id) ?? []).map((image) => image.id)
    await recordChanges(
      tx,
      data.spaceId,
      {
        writes: async (writeTx) => {
          await deleteTrashedEntriesInSpace(writeTx, data.spaceId, [entry.id])
        },
        tombstones: [purgeTombstone(entry)],
      },
      now,
    )
    if (imageIds.length > 0) {
      // The objects' cleanup rides the same transaction: a storage hiccup
      // costs the idempotent job its retries, never leaked bytes.
      const job: MediaDeleteJobData = { spaceId: data.spaceId, imageIds }
      await deps.jobs.sendInTx(tx, { name: MEDIA_DELETE_JOB, data: job })
    }
  })
}

/**
 * The recurring sweep: every space whose trashed entries are due, one
 * transaction per space. The cross-space read only discovers the spaces to
 * visit; each purge re-reads its rows under the space row lock, so the
 * decision to delete is never made from a half-done change.
 */
export async function purgeDueTrashedEntries(deps: JournalJobsDeps): Promise<void> {
  const now = deps.clock.now()
  const retentionDays = await readTrashRetentionDays(deps.db)
  const spaceIds = await listSpacesWithPurgeableEntriesAcrossSpaces(
    deps.db,
    purgeCutoff(now, retentionDays),
  )
  // One space's failure must not stop the others: each purge is its own
  // transaction, and the sweep still fails at the end, so the queue
  // retries it and the healthy spaces are not purged twice.
  const failures: Array<{ spaceId: string; cause: unknown }> = []
  for (const spaceId of spaceIds) {
    try {
      await deps.db.transaction(async (tx) => {
        await lockSpace(tx, spaceId)
        // The retention is read again under the lock, so a change that
        // committed since the sweep began is honoured per space.
        const currentRetentionDays = await readTrashRetentionDays(tx)
        const entries = await listPurgeableEntriesInSpace(
          tx,
          spaceId,
          purgeCutoff(now, currentRetentionDays),
        )
        if (entries.length === 0) return
        const grouped = await imagesOfEntries(
          tx,
          spaceId,
          entries.map((entry) => entry.id),
        )
        const imageIds = [...grouped.values()].flat().map((image) => image.id)
        await recordChanges(
          tx,
          spaceId,
          {
            writes: async (writeTx) => {
              await deleteTrashedEntriesInSpace(
                writeTx,
                spaceId,
                entries.map((entry) => entry.id),
              )
            },
            tombstones: entries.map(purgeTombstone),
          },
          now,
        )
        if (imageIds.length > 0) {
          // The photos' objects go the way the per-entry purge sends them:
          // the idempotent cleanup job, inside this same transaction.
          const job: MediaDeleteJobData = { spaceId, imageIds }
          await deps.jobs.sendInTx(tx, { name: MEDIA_DELETE_JOB, data: job })
        }
      })
    } catch (cause) {
      failures.push({ spaceId, cause })
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.cause),
      `Purging ${failures.length} space(s) failed: ${failures.map((f) => f.spaceId).join(', ')}`,
    )
  }
}

/** The moment a trashed entry must have been trashed before to be due now. */
function purgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS)
}

/*
 * The member lifecycle's part (issue #23): the members module sits below
 * the journal, so its private-state purge reaches this through the
 * composition root's port. It runs inside the caller's transaction, behind
 * the space row lock the caller has taken, and reports what it removed —
 * the drafts' tombstones come back for the caller's recordChanges, the
 * images' storage keys go with the queued cleanup job like the trash
 * purge's do.
 */

/**
 * The member's private-state purge, journal side: their drafts — visible
 * to nobody but them, and they can no longer sign in — are deleted whole,
 * photos included. The published entries and the trash stay; the trash's
 * own sweep answers for the trashed rows. The tombstones name the member:
 * a draft was only ever theirs, so the delta that would apply them is the
 * member's alone.
 */
export async function purgeDraftsOfMemberInTx(
  tx: Tx,
  spaceId: string,
  memberId: string,
): Promise<{ imageIds: string[]; tombstones: TombstoneInput[] }> {
  const drafts = await listDraftsOfAuthor(tx, spaceId, memberId)
  if (drafts.length === 0) return { imageIds: [], tombstones: [] }
  const grouped = await imagesOfEntries(tx, spaceId, drafts.map((draft) => draft.id))
  const imageIds = [...grouped.values()].flat().map((image) => image.id)
  await deleteDraftEntriesInSpace(
    tx,
    spaceId,
    drafts.map((draft) => draft.id),
  )
  return {
    imageIds,
    tombstones: drafts.map((draft): TombstoneInput => ({
      entity: JOURNAL_ENTRY_SYNC_ENTITY,
      entityId: draft.id,
      audience: { kind: 'member', memberId },
    })),
  }
}
