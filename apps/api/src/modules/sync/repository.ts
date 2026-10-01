import { and, asc, eq, gt, inArray, or } from 'drizzle-orm'
import type { Tx } from '../../platform/db/index.ts'
import { syncTombstones } from './tables.ts'

export type TombstoneAudience = { kind: 'all' } | { kind: 'member'; memberId: string }

export interface TombstoneInput {
  entity: string
  entityId: string
  audience: TombstoneAudience
}

/** One delivered deletion, in the wire shape the sync response carries. */
export interface SyncTombstoneEntry {
  entity: string
  entityId: string
  audience: 'all' | 'member'
  memberId?: string
}

export async function writeTombstones(
  tx: Tx,
  spaceId: string,
  revision: bigint,
  tombstones: readonly TombstoneInput[],
  now: Date,
): Promise<void> {
  if (tombstones.length === 0) return
  await tx.insert(syncTombstones).values(
    tombstones.map((tombstone) => ({
      spaceId,
      revision,
      entity: tombstone.entity,
      entityId: tombstone.entityId,
      audience: tombstone.audience.kind === 'all' ? 'all' : 'member',
      memberId: tombstone.audience.kind === 'member' ? tombstone.audience.memberId : null,
      createdAt: now,
    })),
  )
}

/**
 * The tombstones of the named entities that happened in the space after
 * `since` and concern the requesting member: audience `all` reaches
 * everyone, a member-scoped one only that member. Contributors call it for
 * their own entities (architecture.md, "Sync contributors") — the shared
 * table keeps one tombstone shape, the audience filter lives here once.
 */
export async function readTombstonesSince(
  tx: Tx,
  spaceId: string,
  memberId: string,
  since: bigint,
  entities: readonly string[],
): Promise<SyncTombstoneEntry[]> {
  if (entities.length === 0) return []
  const rows = await tx
    .select({
      entity: syncTombstones.entity,
      entityId: syncTombstones.entityId,
      audience: syncTombstones.audience,
      memberId: syncTombstones.memberId,
    })
    .from(syncTombstones)
    .where(
      and(
        eq(syncTombstones.spaceId, spaceId),
        gt(syncTombstones.revision, since),
        inArray(syncTombstones.entity, [...entities]),
        or(
          eq(syncTombstones.audience, 'all'),
          and(eq(syncTombstones.audience, 'member'), eq(syncTombstones.memberId, memberId)),
        ),
      ),
    )
    .orderBy(asc(syncTombstones.revision), asc(syncTombstones.id))
  return rows.map((row) => ({
    entity: row.entity,
    entityId: row.entityId,
    audience: row.audience as 'all' | 'member',
    memberId: row.memberId ?? undefined,
  }))
}
