import { and, asc, eq, gt, sql } from 'drizzle-orm'
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

export async function countOwnersInSpace(executor: Executor, spaceId: string): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(members)
    .where(and(eq(members.spaceId, spaceId), eq(members.role, 'owner')))
  return rows[0]?.count ?? 0
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
