import type { Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { getSpaceForUpdate } from './repository.ts'

/**
 * Takes the space row lock inside a transaction. A use case that must read
 * before deciding to write starts here: the space lock is the first lock
 * every writer takes, so the revision bookkeeping serialises them and no
 * lock order can invert into a deadlock.
 */
export async function lockSpace(tx: Tx, spaceId: string): Promise<void> {
  const space = await getSpaceForUpdate(tx, spaceId)
  if (space === undefined) {
    throw new DomainError('space_not_found', `Space ${spaceId} does not exist`, 404)
  }
}

export { advanceSpaceRevision, createSpace, getSpace, type SpacesDeps } from './service.ts'
export type { Space } from './tables.ts'
