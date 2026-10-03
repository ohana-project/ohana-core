import type { Clock } from '../../platform/clock.ts'
import type { Db, Tx } from '../../platform/db/index.ts'
import type { JobSender } from '../../platform/jobs/index.ts'
import { readTrashRetentionDays } from '../admin/index.ts'
import { MEDIA_DELETE_JOB, type MediaDeleteJobData } from '../media/index.ts'
import { deleteMemberSubscriptionsInTx } from '../notifications/index.ts'
import { lockSpace } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import {
  getMemberInSpace,
  listMembersDueForPrivateStatePurgeAcrossSpaces,
  markMemberPrivateStatePurged,
} from './repository.ts'
import type { MemberWishlistPort } from './service.ts'

/*
 * The members module's worker handler (issue #23, ADR-0009): the recurring
 * private-state purge. An archived member's drafts and gift favorites are
 * purged once their retention has run out; after that, restoration is no
 * longer offered (ADR-0005). Like the trash purge, one recurring sweep
 * covers the rule — it re-checks every space's due members under the space
 * row lock, so a retention that grew and a worker that was down when a
 * round was due both resolve without loss, and the handler is safe to
 * repeat: the stamp it writes makes the second run answer without writing.
 */

/** The queue name of the private-state purge sweep. */
export const MEMBER_PURGE_SWEEP_JOB = 'member-purge-sweep'

/** The sweep runs daily at 04:00 UTC; the purge is not time-critical to
 *  the hour, and the retention is counted in days (ADR-0007). */
export const MEMBER_PURGE_SWEEP_CRON = '0 4 * * *'

export const MEMBER_PURGE_QUEUES = [{ name: MEMBER_PURGE_SWEEP_JOB }] as const

/**
 * The journal's part of the purge (issue #23): the members module sits
 * below the journal, so the drafts' deletion arrives through this port,
 * wired by the composition root to the journal's public surface.
 */
export interface MemberPurgeJournalPort {
  purgeDraftsInTx(
    tx: Tx,
    spaceId: string,
    memberId: string,
  ): Promise<{ imageIds: string[]; tombstones: TombstoneInput[] }>
}

export interface MemberPurgeJobsDeps {
  db: Db
  clock: Clock
  /** The jobs port: the purge schedules the drafts' photos' cleanup inside its transaction. */
  jobs: JobSender
  /** The wishlist's part: the member's gift favorites, deleted through the port. */
  wishlist: MemberWishlistPort
  /** The journal's part: the member's drafts, deleted through the port. */
  journal: MemberPurgeJournalPort
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The moment an archived member's private state is due: the archiving plus the retention. */
function purgeAtFor(archivedAt: Date, retentionDays: number): Date {
  return new Date(archivedAt.getTime() + retentionDays * DAY_MS)
}

/**
 * Purges the private state of every member whose retention has run out:
 * one transaction per member, like the trash sweep's one per space. The
 * cross-space read only discovers the members to visit; each purge re-reads
 * its member under the space row lock, re-reads the retention there, and
 * skips anything that a restore or a retention change has overtaken.
 */
export async function purgeDuePrivateState(deps: MemberPurgeJobsDeps): Promise<void> {
  const now = deps.clock.now()
  const retentionDays = await readTrashRetentionDays(deps.db)
  const due = await listMembersDueForPrivateStatePurgeAcrossSpaces(
    deps.db,
    purgeCutoff(now, retentionDays),
  )
  // One member's failure must not stop the others: each purge is its own
  // transaction, and the sweep still fails at the end, so the queue retries
  // it and the healthy members are not purged twice.
  const failures: Array<{ spaceId: string; memberId: string; cause: unknown }> = []
  for (const dueMember of due) {
    try {
      await deps.db.transaction(async (tx) => {
        await lockSpace(tx, dueMember.spaceId)
        const member = await getMemberInSpace(tx, dueMember.spaceId, dueMember.id)
        // The member row is gone, restored, or already purged: nothing to do.
        if (member === undefined || member.archivedAt === null) return
        if (member.privateStatePurgedAt !== null) return
        // The retention is read again under the lock, so a settings change
        // that committed since the sweep began is honoured per member.
        const retention = await readTrashRetentionDays(tx)
        if (purgeAtFor(member.archivedAt, retention) > now) return

        // The ports delete and report: the tombstones come back so the
        // caller's recordChanges writes them with the revision it computes.
        const favoriteTombstones = await deps.wishlist.purgeFavoritesInTx(
          tx,
          member.spaceId,
          member.id,
        )
        const drafts = await deps.journal.purgeDraftsInTx(tx, member.spaceId, member.id)
        await recordChanges(
          tx,
          member.spaceId,
          {
            writes: async (writeTx, revision) => {
              await markMemberPrivateStatePurged(writeTx, member.spaceId, member.id, revision, now)
              // A subscribe request that raced the archiving may have left
              // its row behind; the purge is the member's end, so the row
              // goes too — no endpoint counts a member who cannot return.
              await deleteMemberSubscriptionsInTx(writeTx, member.spaceId, member.id)
              if (drafts.imageIds.length > 0) {
                // The photos' objects go the way the trash purge sends
                // them: the idempotent cleanup job, inside this same
                // transaction — a storage hiccup costs retries, never
                // leaked bytes.
                const job: MediaDeleteJobData = {
                  spaceId: member.spaceId,
                  imageIds: drafts.imageIds,
                }
                await deps.jobs.sendInTx(writeTx, { name: MEDIA_DELETE_JOB, data: job })
              }
            },
            tombstones: [...favoriteTombstones, ...drafts.tombstones],
          },
          now,
        )
      })
    } catch (cause) {
      failures.push({ spaceId: dueMember.spaceId, memberId: dueMember.id, cause })
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.cause),
      `Purging ${failures.length} member(s) failed: ${failures
        .map((failure) => failure.memberId)
        .join(', ')}`,
    )
  }
}

/** The moment an archiving must have happened before to be due now. */
function purgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS)
}
