import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { revokeIssuedAccessCodesForMemberInTx, revokeMemberSessionsInTx } from '../access/index.ts'
import { deleteMemberSubscriptionsInTx } from '../notifications/index.ts'
import { getSpace, lockSpace, type SpacesDeps } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import { countMembersPerSpaceAcrossInstallation } from './admin-repository.ts'
import { CONTACT_MIN_LENGTH } from './contracts.ts'
import {
  countActiveOwnersInSpace,
  getMemberInSpace,
  insertMember,
  listActiveMembersInSpace,
  listArchivedMemberIdsInSpace,
  listMemberIdsInSpace,
  listMembersInSpace,
  updateMemberArchived,
  updateMemberProfile,
  updateMemberRestored,
  updateMemberRole,
} from './repository.ts'
import type { Member, memberRoles } from './tables.ts'

export interface MembersDeps {
  db: Db
  clock: Clock
}

export type MemberRole = (typeof memberRoles)[number]

/**
 * The wishlist's part of the member lifecycle (issue #23): the members
 * module sits below the wishlist, so the archive, restore, and purge
 * effects arrive through this port, which the composition root wires to
 * the wishlist's public surface (architecture.md, "Composition").
 */
export interface MemberWishlistPort {
  /**
   * Ends the member's reservations, hides the ones held on their own
   * wishes beside the wishes, and collects the tombstones the archiving
   * delivers — one per wish to everyone, one per ended or hidden
   * reservation to every member but the wish's author. Runs inside the
   * caller's transaction, behind the space row lock the caller took.
   */
  archiveInTx(tx: Tx, spaceId: string, memberId: string): Promise<TombstoneInput[]>
  /**
   * Stamps the member's wishes — and the reservations held on them — with
   * the restore's revision, so they ride the delta again.
   */
  restampWishesInTx(
    tx: Tx,
    spaceId: string,
    memberId: string,
    revision: bigint,
    now: Date,
  ): Promise<void>
  /** Deletes the member's gift favorites and collects their member-scoped tombstones. */
  purgeFavoritesInTx(tx: Tx, spaceId: string, memberId: string): Promise<TombstoneInput[]>
}

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
 * The space's active membership (issue #23): the reads that act on the
 * space's living membership — the calendar's reminder recipients, for one —
 * ask for it here, so the archived rule stays with the module that owns
 * the member row.
 */
export async function listActiveMembers(deps: MembersDeps, spaceId: string): Promise<Member[]> {
  await getSpace(deps, spaceId)
  return listActiveMembersInSpace(deps.db, spaceId)
}

/**
 * The space's member ids, read inside a caller's transaction: a section
 * module whose deletion concerns more members than its actor — the
 * wishlist's reservation leaves every member's view except the wish's
 * author's (issue #19) — writes one tombstone per member, and the audience
 * must be read under the same space row lock the deletion runs behind.
 */
export async function listMemberIdsInTx(tx: Tx, spaceId: string): Promise<string[]> {
  return listMemberIdsInSpace(tx, spaceId)
}

/**
 * Moves a member between the owner and regular roles. The space must keep at
 * least one owner (CONTEXT.md: a space is never left without one) — counted
 * among the active members, since an archived member keeps their role but
 * holds no standing while archived (issue #23). The space row lock is taken
 * before the member is read, per the lock-order rule in architecture.md
 * ("Revision bookkeeping"): an unchanged role is answered without spending a
 * revision, and the last-owner count runs serialised against concurrent role
 * changes.
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
    if (member.archivedAt !== null) {
      // An archived member's role is frozen while they are out of the
      // space (issue #23): the restore brings them back with it intact.
      throw new DomainError(
        'member_archived',
        `Member ${memberId} is archived and cannot change role`,
        409,
      )
    }
    if (member.role === role) return member
    let updated: Member | undefined
    await recordChanges(
      tx,
      spaceId,
      {
        writes: async (writeTx, revision) => {
          if (member.role === 'owner') {
            const owners = await countActiveOwnersInSpace(writeTx, spaceId)
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

/**
 * Archives a member (issue #23, ADR-0005): an owner or the instance
 * administrator removes a person from the space. The member can no longer
 * sign in — their sessions are deleted and their unused access codes are
 * revoked in the same transaction — but their published history keeps its
 * attribution, and their wishes leave the space's view (tombstoned through
 * the wishlist port) while staying on the server. Their reservations end.
 * The last active owner cannot be archived: a space is never left without
 * one. The space row lock is taken before the member is read, per the
 * lock-order rule in architecture.md ("Revision bookkeeping").
 */
export async function archiveMember(
  deps: MembersDeps,
  wishlist: MemberWishlistPort,
  spaceId: string,
  memberId: string,
): Promise<Member> {
  const now = deps.clock.now()
  let archived: Member | undefined
  await deps.db.transaction(async (tx) => {
    await lockSpace(tx, spaceId)
    const member = await getMemberInSpace(tx, spaceId, memberId)
    if (member === undefined) {
      throw new DomainError('member_not_found', `Member ${memberId} does not exist`, 404)
    }
    if (member.archivedAt !== null) {
      throw new DomainError(
        'member_already_archived',
        `Member ${memberId} is already archived`,
        409,
      )
    }
    if (member.role === 'owner') {
      const owners = await countActiveOwnersInSpace(tx, spaceId)
      if (owners === 1) {
        throw new DomainError('last_owner', 'The space must keep at least one owner', 409)
      }
    }
    // The wishlist's part runs behind the same lock: the tombstones and the
    // released reservations are decided from a half-done change never.
    const tombstones = await wishlist.archiveInTx(tx, spaceId, memberId)
    await recordChanges(
      tx,
      spaceId,
      {
        writes: async (writeTx, revision) => {
          archived = await updateMemberArchived(writeTx, spaceId, memberId, revision, now)
          // The sign-in credentials go with the archiving, in this
          // transaction — the codes first, then the sessions: a redemption
          // racing the archiving either spends its code before the
          // revocation (its session is then here to be deleted) or finds
          // the code no longer issued and inserts nothing.
          await revokeIssuedAccessCodesForMemberInTx(writeTx, spaceId, memberId, now)
          await revokeMemberSessionsInTx(writeTx, spaceId, memberId)
          // The archived member's devices cannot unsubscribe themselves
          // (their sessions are gone): their push subscriptions go too, so
          // a later restore never reminds a signed-out device.
          await deleteMemberSubscriptionsInTx(writeTx, spaceId, memberId)
        },
        tombstones,
      },
      now,
    )
  })
  if (archived === undefined) throw new Error('Archiving a member produced no row')
  return archived
}

/**
 * The restore inside a caller's transaction (issue #23, ADR-0005): the
 * member's row loses its archiving stamp and their wishes — with the
 * reservations held on them — are re-stamped with the restore's revision,
 * so the sync delta delivers both as upserts and every device shows the
 * member and their wishlist whole. Every session the member may still hold
 * goes with the restore — the new code being issued is the only way back
 * in. The caller — the access module's issuance, through the composition
 * root's port — has already taken the space row lock, refused a purged
 * member, and read the member under the same lock.
 */
export async function restoreArchivedMemberInTx(
  tx: Tx,
  spaceId: string,
  memberId: string,
  now: Date,
  wishlist: MemberWishlistPort,
): Promise<Member> {
  let restored: Member | undefined
  await recordChanges(
    tx,
    spaceId,
    {
      writes: async (writeTx, revision) => {
        restored = await updateMemberRestored(writeTx, spaceId, memberId, revision, now)
        await wishlist.restampWishesInTx(writeTx, spaceId, memberId, revision, now)
        // The sessions go with the restore, and the subscriptions with
        // them: a subscribe request authenticated before the archiving may
        // have written its row after it. The new code being issued is the
        // only way back in, on a fresh device.
        await revokeMemberSessionsInTx(writeTx, spaceId, memberId)
        await deleteMemberSubscriptionsInTx(writeTx, spaceId, memberId)
      },
    },
    now,
  )
  if (restored === undefined) throw new Error('Restoring a member produced no row')
  return restored
}

/**
 * The archived member ids the visibility filters read (issue #23): the
 * wishlist's policy hides an archived author's wishes from the space, and
 * the set comes from the members module's own repository through its
 * public surface.
 */
export function listArchivedMemberIds(executor: Executor, spaceId: string): Promise<string[]> {
  return listArchivedMemberIdsInSpace(executor, spaceId)
}

/** Counts members per space across the installation, for administrative listings. */
export function adminCountMembersBySpace(deps: MembersDeps): Promise<Map<string, number>> {
  return countMembersPerSpaceAcrossInstallation(deps.db)
}
