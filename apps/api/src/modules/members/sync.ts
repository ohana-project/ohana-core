import type { Tx } from '../../platform/db/index.ts'
import { readTombstonesSince, type SyncContribution, type SyncContributor } from '../sync/index.ts'
import { MemberSyncChangeSchema, toMemberProfileDto } from './contracts.ts'
import { listChangedMembersInSpace } from './repository.ts'

/** The members module's entity name in the tombstone table. */
export const MEMBER_SYNC_ENTITY = 'member'

/*
 * The members sync contributor (issue #14): the space's profiles as the
 * members module publishes them, changed after the cursor. The policy is
 * the ordinary read's (GET /members): every member of the requesting
 * member's own space — the spaceId in every filter is the actor's, so
 * another space's rows and tombstones never leave the server.
 */
export const membersSyncContributor: SyncContributor = {
  changeSchema: MemberSyncChangeSchema,
  entities: [MEMBER_SYNC_ENTITY],
  changesSince: async (
    tx: Tx,
    actor: { memberId: string; spaceId: string },
    since: bigint,
  ): Promise<SyncContribution> => {
    const rows = await listChangedMembersInSpace(tx, actor.spaceId, since)
    const tombstones = await readTombstonesSince(tx, actor.spaceId, actor.memberId, since, [
      MEMBER_SYNC_ENTITY,
    ])
    return {
      upserts: rows.map((member) => ({
        entity: MEMBER_SYNC_ENTITY,
        member: toMemberProfileDto(member),
      })),
      tombstones,
    }
  },
}
