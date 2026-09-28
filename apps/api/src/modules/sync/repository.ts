import type { Executor } from '../../platform/db/index.ts'
import { syncTombstones } from './tables.ts'

export type TombstoneAudience = { kind: 'all' } | { kind: 'member'; memberId: string }

export interface TombstoneInput {
  entity: string
  entityId: string
  audience: TombstoneAudience
}

export async function writeTombstones(
  executor: Executor,
  spaceId: string,
  revision: bigint,
  tombstones: readonly TombstoneInput[],
  now: Date,
): Promise<void> {
  if (tombstones.length === 0) return
  await executor.insert(syncTombstones).values(
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
