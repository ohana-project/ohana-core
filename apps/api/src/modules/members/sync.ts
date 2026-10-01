import type { SyncContributor } from '../sync/index.ts'
import { MemberSyncChangeSchema, toMemberProfileDto } from './contracts.ts'
import { listChangedMembersInSpace } from './repository.ts'

/** The members module's entity name in the tombstone table. */
export const MEMBER_SYNC_ENTITY = 'member'

/*
 * The members sync contributor (issue #14): the space's profiles as the
 * members module publishes them, changed after the cursor. The policy is
 * the ordinary read's (GET /members): every member of the requesting
 * member's own space — the spaceId in every filter is the actor's, so
 * another space's rows never leave the server. The tombstones of the
 * member entity are read by the sync service, which applies the audience
 * filter once for every contributor together.
 */
export const membersSyncContributor: SyncContributor<typeof MemberSyncChangeSchema> = {
  changeSchema: MemberSyncChangeSchema,
  entities: [MEMBER_SYNC_ENTITY],
  changesSince: async (tx, actor, since) => {
    const rows = await listChangedMembersInSpace(tx, actor.spaceId, since)
    return {
      upserts: rows.map((member) => ({
        entity: MEMBER_SYNC_ENTITY,
        member: toMemberProfileDto(member),
      })),
    }
  },
}
