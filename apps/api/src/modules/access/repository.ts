import { and, desc, eq, gt, lt, lte } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { type AccessCode, accessCodes, type MemberSession, memberSessions } from './tables.ts'

export interface NewAccessCode {
  spaceId: string
  memberId: string
  issuerAdministratorId?: string
  issuerMemberId?: string
  codeHash: string
  now: Date
  expiresAt: Date
}

export async function insertAccessCode(tx: Tx, data: NewAccessCode): Promise<AccessCode> {
  const inserted = await tx
    .insert(accessCodes)
    .values({
      spaceId: data.spaceId,
      memberId: data.memberId,
      issuerAdministratorId: data.issuerAdministratorId,
      issuerMemberId: data.issuerMemberId,
      codeHash: data.codeHash,
      status: 'issued',
      createdAt: data.now,
      expiresAt: data.expiresAt,
      statusChangedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting an access code returned no row')
  return row
}

/**
 * Redeems atomically: the status flip is a compare-and-set, so of two
 * concurrent redemptions exactly one wins and the loser observes the row
 * as already used.
 */
export async function redeemAccessCodeByHashAcrossSpaces(
  tx: Tx,
  codeHash: string,
  now: Date,
): Promise<AccessCode | undefined> {
  const updated = await tx
    .update(accessCodes)
    .set({ status: 'redeemed', statusChangedAt: now })
    .where(
      and(
        eq(accessCodes.codeHash, codeHash),
        eq(accessCodes.status, 'issued'),
        gt(accessCodes.expiresAt, now),
      ),
    )
    .returning()
  return updated[0]
}

export async function findAccessCodeByHashAcrossSpaces(
  executor: Executor,
  codeHash: string,
): Promise<AccessCode | undefined> {
  const rows = await executor
    .select()
    .from(accessCodes)
    .where(eq(accessCodes.codeHash, codeHash))
    .limit(1)
  return rows[0]
}

export async function getAccessCodeRow(
  executor: Executor,
  spaceId: string,
  codeId: string,
): Promise<AccessCode | undefined> {
  const rows = await executor
    .select()
    .from(accessCodes)
    .where(and(eq(accessCodes.spaceId, spaceId), eq(accessCodes.id, codeId)))
    .limit(1)
  return rows[0]
}

/** Marks an issued-but-expired code as expired, materialising its status. */
export async function expireAccessCodeRow(
  tx: Tx,
  spaceId: string,
  codeId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(accessCodes)
    .set({ status: 'expired', statusChangedAt: now })
    .where(
      and(
        eq(accessCodes.spaceId, spaceId),
        eq(accessCodes.id, codeId),
        eq(accessCodes.status, 'issued'),
      ),
    )
}

export async function revokeAccessCodeRow(
  tx: Tx,
  spaceId: string,
  codeId: string,
  now: Date,
): Promise<AccessCode | undefined> {
  const updated = await tx
    .update(accessCodes)
    .set({ status: 'revoked', statusChangedAt: now })
    .where(
      and(
        eq(accessCodes.id, codeId),
        eq(accessCodes.spaceId, spaceId),
        eq(accessCodes.status, 'issued'),
        gt(accessCodes.expiresAt, now),
      ),
    )
    .returning()
  return updated[0]
}

/**
 * The write-path status sweep for one member: issued codes past their
 * expiry become expired; still-valid unused ones become replaced. A new
 * issuance runs it so that an "issued" row never survives its replacement.
 */
export async function sweepMemberCodesForIssue(
  tx: Tx,
  spaceId: string,
  memberId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(accessCodes)
    .set({ status: 'expired', statusChangedAt: now })
    .where(
      and(
        eq(accessCodes.spaceId, spaceId),
        eq(accessCodes.memberId, memberId),
        eq(accessCodes.status, 'issued'),
        lte(accessCodes.expiresAt, now),
      ),
    )
  await tx
    .update(accessCodes)
    .set({ status: 'replaced', statusChangedAt: now })
    .where(
      and(
        eq(accessCodes.spaceId, spaceId),
        eq(accessCodes.memberId, memberId),
        eq(accessCodes.status, 'issued'),
      ),
    )
}

export async function listAccessCodesInSpace(
  executor: Executor,
  spaceId: string,
): Promise<AccessCode[]> {
  return executor
    .select()
    .from(accessCodes)
    .where(eq(accessCodes.spaceId, spaceId))
    .orderBy(desc(accessCodes.createdAt), desc(accessCodes.id))
}

export interface NewMemberSession {
  spaceId: string
  memberId: string
  tokenHash: string
  now: Date
  expiresAt: Date
}

export async function insertMemberSession(tx: Tx, data: NewMemberSession): Promise<void> {
  await tx.insert(memberSessions).values({
    spaceId: data.spaceId,
    memberId: data.memberId,
    tokenHash: data.tokenHash,
    createdAt: data.now,
    expiresAt: data.expiresAt,
  })
}

export async function findMemberSessionByTokenHashAcrossSpaces(
  executor: Executor,
  tokenHash: string,
  now: Date,
): Promise<MemberSession | undefined> {
  const rows = await executor
    .select()
    .from(memberSessions)
    .where(and(eq(memberSessions.tokenHash, tokenHash), gt(memberSessions.expiresAt, now)))
    .limit(1)
  return rows[0]
}

export async function deleteMemberSessionByTokenHashAcrossSpaces(
  tx: Tx,
  memberId: string,
  tokenHash: string,
): Promise<void> {
  await tx
    .delete(memberSessions)
    .where(and(eq(memberSessions.memberId, memberId), eq(memberSessions.tokenHash, tokenHash)))
}

/** Opportunistic hygiene on sign-in: expired sessions of every member go. */
export async function deleteExpiredMemberSessionsAcrossSpaces(
  executor: Executor,
  now: Date,
): Promise<void> {
  await executor.delete(memberSessions).where(lt(memberSessions.expiresAt, now))
}
