import type { TSchema } from '@sinclair/typebox'
import type { Db, Tx } from '../../platform/db/index.ts'
import { advanceSpaceRevision, getSpaceInTx } from '../spaces/index.ts'
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
 * their data land, without touching the sync module — the composition root
 * wires the contributors, and the response contract is composed from the
 * wired list.
 */

/** The member a sync response is filtered for; the space is the actor's own. */
export interface SyncActor {
  memberId: string
  spaceId: string
}

/**
 * What one module contributes for one sync request. The upserts are
 * wire-ready change objects, each satisfying the contributor's own change
 * schema; within one response an upsert of a row always outranks a
 * tombstone of the same row — the contributor's rows are what exists now,
 * so the client applies tombstones first and upserts second.
 */
export interface SyncContribution {
  upserts: readonly unknown[]
  tombstones: readonly SyncTombstoneEntry[]
}

/**
 * The extension point a synchronised module exports (architecture.md,
 * "Sync contributors"): `changesSince(tx, actor, revision)` delivering the
 * rows and tombstones newer than the cursor, already filtered by the
 * module's policy — plus the wire schema of its changes, which the sync
 * route composes into the response contract, and the tombstone entities it
 * is responsible for.
 */
export interface SyncContributor {
  /** The wire schema every upsert of this contributor satisfies. */
  changeSchema: TSchema
  /** The entity names whose tombstones this contributor delivers. */
  entities: readonly string[]
  changesSince(tx: Tx, actor: SyncActor, since: bigint): Promise<SyncContribution>
}

export interface SyncResult {
  revision: string
  changes: unknown[]
  tombstones: SyncTombstoneEntry[]
}

/**
 * Reads the space revision before the contributors run: under READ
 * COMMITTED a change committing while the response is assembled can then
 * only be delivered early (the next sync repeats it), never skipped behind
 * a newer cursor. Each statement sees its own snapshot, so the guarantee
 * is exactly this ordering — no stronger.
 */
export async function syncSince(
  db: Db,
  actor: SyncActor,
  since: bigint,
  contributors: readonly SyncContributor[],
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const space = await getSpaceInTx(tx, actor.spaceId)
    const changes: unknown[] = []
    const tombstones: SyncTombstoneEntry[] = []
    for (const contributor of contributors) {
      const contribution = await contributor.changesSince(tx, actor, since)
      changes.push(...contribution.upserts)
      tombstones.push(...contribution.tombstones)
    }
    return { revision: space.revision.toString(), changes, tombstones }
  })
}
