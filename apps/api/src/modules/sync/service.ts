import type { Tx } from '../../platform/db/index.ts'
import { advanceSpaceRevision } from '../spaces/index.ts'
import { type TombstoneInput, writeTombstones } from './repository.ts'

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
