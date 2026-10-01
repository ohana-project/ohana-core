import type { Tx } from '../../platform/db/index.ts'
import type { SyncContribution, SyncContributor } from '../sync/index.ts'
import { toMemberSpaceDto } from './contracts.ts'
import { getSpaceById } from './repository.ts'

/*
 * The spaces sync contributor (issue #14, ADR-0011, ADR-0014): the space
 * row with its sections map travels as one upsert whenever the row is
 * newer than the cursor, so section visibility reaches offline clients. A
 * visibility change spends a revision on the space row itself and writes
 * no per-row tombstones — the client drops a hidden section's rows when it
 * applies the new map, and resyncs from revision 0 once when a section
 * comes back (architecture.md, "Visibility changes").
 */
export const spacesSyncContributor: SyncContributor = async (
  tx: Tx,
  actor: { spaceId: string },
  since: bigint,
): Promise<SyncContribution> => {
  const space = await getSpaceById(tx, actor.spaceId)
  if (space === undefined || space.revision <= since) {
    return { upserts: [], tombstones: [] }
  }
  return { upserts: [{ entity: 'space', space: toMemberSpaceDto(space) }], tombstones: [] }
}
