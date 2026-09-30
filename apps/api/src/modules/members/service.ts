import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { getSpace } from '../spaces/index.ts'
import { recordChanges } from '../sync/index.ts'
import { adminCountMembersBySpace } from './admin-repository.ts'
import {
  countOwnersInSpace,
  getMemberInSpace,
  insertMember,
  listMembersInSpace,
  updateMemberRole,
} from './repository.ts'
import type { Member, memberRoles } from './tables.ts'

export interface MembersDeps {
  db: Db
  clock: Clock
}

export type MemberRole = (typeof memberRoles)[number]

export interface MemberInput {
  name: string
  role: MemberRole
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
}

/** Provisions a member in the named space; the change advances the space revision. */
export async function provisionMember(
  deps: MembersDeps,
  spaceId: string,
  input: MemberInput,
): Promise<Member> {
  let created: Member | undefined
  await deps.db.transaction(async (tx) =>
    recordChanges(
      tx,
      spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertMember(writeTx, spaceId, {
            ...input,
            revision,
            now: deps.clock.now(),
          })
        },
      },
      deps.clock.now(),
    ),
  )
  if (created === undefined) throw new Error('Provisioning a member produced no row')
  return created
}

export async function listMembers(deps: MembersDeps, spaceId: string): Promise<Member[]> {
  // Members of an unknown space answer 404 like every other route that
  // names a space, instead of an empty list.
  await getSpace(deps, spaceId)
  return listMembersInSpace(deps.db, spaceId)
}

/**
 * Moves a member between the owner and regular roles. The space must keep at
 * least one owner (CONTEXT.md: a space is never left without one). The check
 * runs inside the writes callback, after the revision bump has taken the
 * space row lock, so concurrent role changes cannot slip past it.
 */
export async function changeMemberRole(
  deps: MembersDeps,
  spaceId: string,
  memberId: string,
  role: MemberRole,
): Promise<Member> {
  let updated: Member | undefined
  await deps.db.transaction(async (tx) =>
    recordChanges(
      tx,
      spaceId,
      {
        writes: async (writeTx, revision) => {
          const member = await getMemberInSpace(writeTx, spaceId, memberId)
          if (member === undefined) {
            throw new DomainError('member_not_found', `Member ${memberId} does not exist`, 404)
          }
          if (member.role !== role && member.role === 'owner') {
            const owners = await countOwnersInSpace(writeTx, spaceId)
            if (owners === 1) {
              throw new DomainError('last_owner', 'The space must keep at least one owner', 409)
            }
          }
          updated = await updateMemberRole(
            writeTx,
            spaceId,
            memberId,
            role,
            revision,
            deps.clock.now(),
          )
        },
      },
      deps.clock.now(),
    ),
  )
  if (updated === undefined) throw new Error('Changing a member role produced no row')
  return updated
}

/** Counts members per space across the installation, for administrative listings. */
export function countMembersBySpace(deps: MembersDeps): Promise<Map<string, number>> {
  return adminCountMembersBySpace(deps.db)
}
