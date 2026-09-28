import type { Executor } from '../../platform/db/index.ts'
import { incrementSpaceRevision } from '../spaces/index.ts'
import { type TombstoneInput, writeTombstones } from './repository.ts'

export interface ChangePlan {
  writes?: (revision: bigint) => Promise<unknown>
  tombstones?: readonly TombstoneInput[]
}

export async function recordChanges(
  executor: Executor,
  spaceId: string,
  plan: ChangePlan,
  now: Date,
): Promise<bigint> {
  const revision = await incrementSpaceRevision(executor, spaceId, now)
  if (plan.writes !== undefined) {
    await plan.writes(revision)
  }
  await writeTombstones(executor, spaceId, revision, plan.tombstones ?? [], now)
  return revision
}
