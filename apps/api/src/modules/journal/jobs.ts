import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { readTrashRetentionDays } from '../admin/index.ts'
import { lockSpace } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import { JOURNAL_ENTRY_SYNC_ENTITY } from './contracts.ts'
import { purgeAtFor, trashedAtOf } from './policy.ts'
import {
  deleteTrashedEntriesInSpace,
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
 * write that arrives over HTTP.
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
