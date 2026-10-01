import type { Db, Tx } from '../../platform/db/index.ts'
import type { MemberProfileDto } from '../members/index.ts'
import { advanceSpaceRevision, getSpaceInTx, type MemberSpaceDto } from '../spaces/index.ts'
import { type SyncTombstoneEntry, type TombstoneInput, writeTombstones } from './repository.ts'

export interface ChangePlan {
  writes?: (tx: Tx, revision: bigint) => Promise<unknown>
  tombstones?: readonly TombstoneInput[]
}

export async function recordChanges(
  tx: Tx,
  spaceId: string,
  plan: ChangePlan,
  now: Date,
): Promise<bigint> {
  const revision = await advanceSpaceRevision(tx, spaceId, now)
  if (plan.writes !== undefined) {
    await plan.writes(tx, revision)
  }
  await writeTombstones(tx, spaceId, revision, plan.tombstones ?? [], now)
  return revision
}

/*
 * The read side (issue #14, ADR-0014): the sync module merges the
 * contributors and returns { revision, changes, tombstones }. Each module
 * with synchronised data exports a contributor (architecture.md, "Sync
 * contributors"); the section modules mount the same extension point when
 * their data lands.
 */

/** The member a sync response is filtered for; the space is the actor's own. */
export interface SyncActor {
  memberId: string
  spaceId: string
}

/** One upserted row, in the shape the sync response carries. */
export type SyncUpsert =
  | { entity: 'space'; space: MemberSpaceDto }
  | { entity: 'member'; member: MemberProfileDto }

/** What one module contributes for one sync request. */
export interface SyncContribution {
  upserts: readonly SyncUpsert[]
  tombstones: readonly SyncTombstoneEntry[]
}

/**
 * The extension point a synchronised module exports (architecture.md,
 * "Sync contributors"): `changesSince(tx, actor, revision)` delivering the
 * rows and tombstones newer than the cursor, already filtered by the
 * module's policy.
 */
export type SyncContributor = (tx: Tx, actor: SyncActor, since: bigint) => Promise<SyncContribution>

export interface SyncResult {
  revision: string
  changes: SyncUpsert[]
  tombstones: SyncTombstoneEntry[]
}

/**
 * Reads the space revision before the contributors run: a change committing
 * while the response is assembled can then only be delivered early (the next
 * sync repeats it), never skipped behind a newer cursor. Everything runs in
 * one transaction, so a caller sees one consistent picture.
 */
export async function syncSince(
  db: Db,
  actor: SyncActor,
  since: bigint,
  contributors: readonly SyncContributor[],
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const space = await getSpaceInTx(tx, actor.spaceId)
    const changes: SyncUpsert[] = []
    const tombstones: SyncTombstoneEntry[] = []
    for (const contribute of contributors) {
      const contribution = await contribute(tx, actor, since)
      changes.push(...contribution.upserts)
      tombstones.push(...contribution.tombstones)
    }
    return { revision: space.revision.toString(), changes, tombstones }
  })
}
