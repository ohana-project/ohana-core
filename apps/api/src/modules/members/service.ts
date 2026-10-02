import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { getSpace, lockSpace, type SpacesDeps } from '../spaces/index.ts'
import { recordChanges } from '../sync/index.ts'
import { countMembersPerSpaceAcrossInstallation } from './admin-repository.ts'
import { CONTACT_MIN_LENGTH } from './contracts.ts'
import {
  countOwnersInSpace,
  getMemberInSpace,
  insertMember,
  listMembersInSpace,
  updateMemberProfile,
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

/**
 * Provisions a member in the named space; the change advances the space revision.
 */
export async function provisionMember(
  deps: MembersDeps,
  spaceId: string,
  input: MemberInput,
): Promise<Member> {
  const contacts = assertContacts(input.email, input.phone)
  let created: Member | undefined
  await deps.db.transaction(async (tx) =>
    recordChanges(
      tx,
      spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertMember(writeTx, spaceId, {
            name: input.name.trim(),
            role: input.role,
            // The schema already guarantees a non-space character, so the
            // fallback only guards callers outside HTTP.
            displayName: input.displayName?.trim() || undefined,
            email: contacts.email,
            phone: contacts.phone,
            interfaceLanguage: input.interfaceLanguage,
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

/**
 * The contract validates the raw values; this check applies to the trimmed
 * ones the service actually stores, so ' a ' cannot slip under the minimum.
 */
function assertContacts(
  email: string | undefined,
  phone: string | undefined,
): { email: string | undefined; phone: string | undefined } {
  const trimmedEmail = email?.trim() || undefined
  const trimmedPhone = phone?.trim() || undefined
  for (const [field, value] of [
    ['email', trimmedEmail],
    ['phone', trimmedPhone],
  ] as const) {
    // Code points, matching how the contract's JSON Schema minimum counts.
    if (value !== undefined && [...value].length < CONTACT_MIN_LENGTH) {
      throw new DomainError(
        'validation_failed',
        `The trimmed ${field} is shorter than ${CONTACT_MIN_LENGTH} characters`,
        400,
      )
    }
  }
  return { email: trimmedEmail, phone: trimmedPhone }
}

/**
 * Completes onboarding (ADR-0005): writes the whole optional profile —
 * display name, informational contacts, interface language — and stamps
 * the member onboarded, in one revisioned change. Absent fields clear, so
 * resubmitting the form is always safe.
 */
export async function completeOnboarding(
  deps: MembersDeps,
  actor: { memberId: string; spaceId: string },
  input: {
    displayName?: string
    email?: string
    phone?: string
    interfaceLanguage?: 'ru' | 'en'
  },
): Promise<Member> {
  const contacts = assertContacts(input.email, input.phone)
  let updated: Member | undefined
  await deps.db.transaction(async (tx) =>
    recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          updated = await updateMemberProfile(
            writeTx,
            actor.spaceId,
            actor.memberId,
            {
              displayName: input.displayName?.trim() || null,
              email: contacts.email ?? null,
              phone: contacts.phone ?? null,
              interfaceLanguage: input.interfaceLanguage ?? null,
              onboardedAt: deps.clock.now(),
            },
            revision,
            deps.clock.now(),
          )
        },
      },
      deps.clock.now(),
    ),
  )
  if (updated === undefined) throw new Error('Completing onboarding produced no row')
  return updated
}

/**
 * The read the access module consumes through its composition-root-wired
 * port; the access module sits below members and never imports them.
 */
export function findMemberInSpace(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<Member | undefined> {
  return getMemberInSpace(executor, spaceId, memberId)
}

/** The signed-in member together with their space, for the member shell. */
export async function describeMember(
  deps: MembersDeps & SpacesDeps,
  actor: { memberId: string; spaceId: string },
): Promise<{ member: Member; spaceName: string }> {
  const member = await getMemberInSpace(deps.db, actor.spaceId, actor.memberId)
  if (member === undefined) {
    throw new DomainError('member_not_found', `Member ${actor.memberId} does not exist`, 404)
  }
  const space = await getSpace(deps, actor.spaceId)
  return { member, spaceName: space.name }
}

export async function listMembers(deps: MembersDeps, spaceId: string): Promise<Member[]> {
  // Members of an unknown space answer 404 like every other route that
  // names a space, instead of an empty list.
  await getSpace(deps, spaceId)
  return listMembersInSpace(deps.db, spaceId)
}

/**
 * The members of the space, read inside a caller's transaction: a section
 * module whose deletion concerns more members than its actor — the
 * wishlist's reservation leaves every member's view except the wish's
 * author's (issue #19) — writes one tombstone per member, and the audience
 * must be read under the same space row lock the deletion runs behind.
 */
export async function listMembersInTx(tx: Tx, spaceId: string): Promise<Member[]> {
  return listMembersInSpace(tx, spaceId)
}

/**
 * Moves a member between the owner and regular roles. The space must keep at
 * least one owner (CONTEXT.md: a space is never left without one). The
 * space row lock is taken before the member is read, per the lock-order
 * rule in architecture.md ("Revision bookkeeping"): an unchanged role is
 * answered without spending a revision, and the last-owner count runs
 * serialised against concurrent role changes.
 */
export async function changeMemberRole(
  deps: MembersDeps,
  spaceId: string,
  memberId: string,
  role: MemberRole,
): Promise<Member> {
  return deps.db.transaction(async (tx) => {
    await lockSpace(tx, spaceId)
    const member = await getMemberInSpace(tx, spaceId, memberId)
    if (member === undefined) {
      throw new DomainError('member_not_found', `Member ${memberId} does not exist`, 404)
    }
    if (member.role === role) return member
    let updated: Member | undefined
    await recordChanges(
      tx,
      spaceId,
      {
        writes: async (writeTx, revision) => {
          if (member.role === 'owner') {
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
    )
    if (updated === undefined) throw new Error('Changing a member role produced no row')
    return updated
  })
}

/** Counts members per space across the installation, for administrative listings. */
export function adminCountMembersBySpace(deps: MembersDeps): Promise<Map<string, number>> {
  return countMembersPerSpaceAcrossInstallation(deps.db)
}
