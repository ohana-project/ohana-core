import { and, asc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { notFound } from '../../platform/errors.ts'
import { type interfaceLanguages, type Member, type memberRoles, members } from './tables.ts'

export interface NewMember {
  name: string
  role: (typeof memberRoles)[number]
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
  revision: bigint
  now: Date
}

/**
 * Every query on this space-owned table takes the space as its required
 * first argument (architecture, "Space scoping"): there is no unscoped
 * member access on the normal path.
 */
export async function insertMember(tx: Tx, spaceId: string, data: NewMember): Promise<Member> {
  const inserted = await tx
    .insert(members)
    .values({
      spaceId,
      name: data.name,
      role: data.role,
      displayName: data.displayName,
      email: data.email,
      phone: data.phone,
      interfaceLanguage: data.interfaceLanguage,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a member returned no row')
  return row
}

export async function listMembersInSpace(executor: Executor, spaceId: string): Promise<Member[]> {
  return executor
    .select()
    .from(members)
    .where(eq(members.spaceId, spaceId))
    .orderBy(asc(members.createdAt), asc(members.id))
}

/** The space's member ids, nothing else: callers that name the audience of
 *  per-member tombstones need no profile columns. */
export async function listMemberIdsInSpace(executor: Executor, spaceId: string): Promise<string[]> {
  const rows = await executor
    .select({ id: members.id })
    .from(members)
    .where(eq(members.spaceId, spaceId))
  return rows.map((row) => row.id)
}

/** The rows changed after `since` — the delta the sync contributor delivers. */
export async function listChangedMembersInSpace(
  tx: Tx,
  spaceId: string,
  since: bigint,
): Promise<Member[]> {
  return tx
    .select()
    .from(members)
    .where(and(eq(members.spaceId, spaceId), gt(members.revision, since)))
    .orderBy(asc(members.createdAt), asc(members.id))
}

export async function getMemberInSpace(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<Member | undefined> {
  const rows = await executor
    .select()
    .from(members)
    .where(and(eq(members.spaceId, spaceId), eq(members.id, memberId)))
    .limit(1)
  return rows[0]
}

/**
 * The active owners (issue #23): an archived member keeps their role — the
 * restore returns them with everything intact — but holds no standing in
 * the space while archived, so the last-owner checks count the rows that
 * are not archived.
 */
export async function countActiveOwnersInSpace(
  executor: Executor,
  spaceId: string,
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(members)
    .where(and(eq(members.spaceId, spaceId), eq(members.role, 'owner'), isNull(members.archivedAt)))
  return rows[0]?.count ?? 0
}

/**
 * The archived members whose private-state retention has run out (issue
 * #23) — the purge sweep's discovery query. It names no space: it only
 * discovers the members to visit, like the journal's purge sweep (the
 * *AcrossSpaces precedent, architecture.md, "Space scoping"); each purge
 * re-reads its member under the space row lock.
 */
export async function listMembersDueForPrivateStatePurgeAcrossSpaces(
  executor: Executor,
  cutoff: Date,
): Promise<Member[]> {
  return executor
    .select()
    .from(members)
    .where(
      and(
        isNotNull(members.archivedAt),
        isNull(members.privateStatePurgedAt),
        lte(members.archivedAt, cutoff),
      ),
    )
    .orderBy(asc(members.archivedAt), asc(members.id))
}

/** The space's archived member ids — the audience the wishlist's policy hides wishes from. */
export async function listArchivedMemberIdsInSpace(
  executor: Executor,
  spaceId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.spaceId, spaceId), isNotNull(members.archivedAt)))
  return rows.map((row) => row.id)
}

export async function updateMemberRole(
  tx: Tx,
  spaceId: string,
  memberId: string,
  role: (typeof memberRoles)[number],
  revision: bigint,
  now: Date,
): Promise<Member> {
  const updated = await tx
    .update(members)
    .set({ role, revision, updatedAt: now })
    .where(and(eq(members.spaceId, spaceId), eq(members.id, memberId)))
    .returning()
  const row = updated[0]
  if (!row) {
    throw notFound('member_not_found', `Member ${memberId} does not exist in space ${spaceId}`)
  }
  return row
}

export interface MemberProfileChanges {
  displayName: string | null
  email: string | null
  phone: string | null
  interfaceLanguage: (typeof interfaceLanguages)[number] | null
  onboardedAt: Date
}

/** Onboarding writes the whole optional profile in one stroke (ADR-0005). */
export async function updateMemberProfile(
  tx: Tx,
  spaceId: string,
  memberId: string,
  changes: MemberProfileChanges,
  revision: bigint,
  now: Date,
): Promise<Member> {
  const updated = await tx
    .update(members)
    .set({
      displayName: changes.displayName,
      email: changes.email,
      phone: changes.phone,
      interfaceLanguage: changes.interfaceLanguage,
      onboardedAt: changes.onboardedAt,
      revision,
      updatedAt: now,
    })
    .where(and(eq(members.spaceId, spaceId), eq(members.id, memberId)))
    .returning()
  const row = updated[0]
  if (!row) {
    throw notFound('member_not_found', `Member ${memberId} does not exist in space ${spaceId}`)
  }
  return row
}

/**
 * The archiving stamp (issue #23, ADR-0005): the member leaves the space's
 * active membership. The row stays — the published history keeps its
 * attribution, and the member lists show archived members separately.
 */
export async function updateMemberArchived(
  tx: Tx,
  spaceId: string,
  memberId: string,
  revision: bigint,
  now: Date,
): Promise<Member> {
  const updated = await tx
    .update(members)
    .set({ archivedAt: now, revision, updatedAt: now })
    .where(
      and(
        eq(members.spaceId, spaceId),
        eq(members.id, memberId),
        // The guard keeps a future caller that forgot the space row lock
        // from archiving loudly instead of silently.
        isNull(members.archivedAt),
      ),
    )
    .returning()
  const row = updated[0]
  if (!row) {
    throw notFound('member_not_found', `Member ${memberId} does not exist in space ${spaceId}`)
  }
  return row
}

/**
 * The restore (issue #23, ADR-0005): a new access code brings the member
 * back with everything intact. The role was never touched — only the
 * archiving stamp clears.
 */
export async function updateMemberRestored(
  tx: Tx,
  spaceId: string,
  memberId: string,
  revision: bigint,
  now: Date,
): Promise<Member> {
  const updated = await tx
    .update(members)
    .set({ archivedAt: null, revision, updatedAt: now })
    .where(
      and(
        eq(members.spaceId, spaceId),
        eq(members.id, memberId),
        // Only an archived row restores; anything else is a lost race the
        // guard turns loud.
        isNull(members.privateStatePurgedAt),
      ),
    )
    .returning()
  const row = updated[0]
  if (!row) {
    throw notFound('member_not_found', `Member ${memberId} does not exist in space ${spaceId}`)
  }
  return row
}

/**
 * The purge's stamp (issue #23): the member's drafts and gift favorites are
 * gone, and restoration is no longer offered. The stamp rides the revision
 * like every other change to a synchronised row.
 */
export async function markMemberPrivateStatePurged(
  tx: Tx,
  spaceId: string,
  memberId: string,
  revision: bigint,
  now: Date,
): Promise<Member> {
  const updated = await tx
    .update(members)
    .set({ privateStatePurgedAt: now, revision, updatedAt: now })
    .where(
      and(
        eq(members.spaceId, spaceId),
        eq(members.id, memberId),
        // Only a still-archived row purges; a restore that won the race
        // must not be stamped.
        isNull(members.privateStatePurgedAt),
      ),
    )
    .returning()
  const row = updated[0]
  if (!row) {
    throw notFound('member_not_found', `Member ${memberId} does not exist in space ${spaceId}`)
  }
  return row
}
