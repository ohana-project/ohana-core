import type { Clock } from '../../platform/clock.ts'
import type { Db, Tx } from '../../platform/db/index.ts'
import { incrementSpaceRevision, insertSpace, type NewSpace } from './repository.ts'
import type { Space } from './tables.ts'

export interface SpacesDeps {
  db: Db
  clock: Clock
}

export async function createSpace(deps: SpacesDeps, data: Omit<NewSpace, 'now'>): Promise<Space> {
  return deps.db.transaction((tx) => insertSpace(tx, { ...data, now: deps.clock.now() }))
}

export async function advanceSpaceRevision(tx: Tx, spaceId: string, now: Date): Promise<bigint> {
  return incrementSpaceRevision(tx, spaceId, now)
}
