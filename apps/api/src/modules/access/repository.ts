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

/**
 * The member's newest code, of any status. Used as the fallback when no
 * live code exists, so the owner's member card can still show what became
 * of the last invitation. The status change — not creation — is what makes
 * a row the current answer, and creation order is unreliable under
 * concurrent issuance; the id breaks the ties left by rows whose status
 * changed in the same instant.
 */
export async function getLatestAccessCodeForMember(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<AccessCode | undefined> {
  const rows = await executor
    .select()
    .from(accessCodes)
    .where(and(eq(accessCodes.spaceId, spaceId), eq(accessCodes.memberId, memberId)))
    .orderBy(desc(accessCodes.statusChangedAt), desc(accessCodes.id))
    .limit(1)
  return rows[0]
}

/**
 * The member's live code: the one issued row the database's partial unique
 * index (`access_codes_one_live_per_member_idx`) caps at one. Creation
 * order says nothing about which row is live under concurrent issuance, so
 * the status — not the timestamp — is what picks the row.
 */
export async function getLiveAccessCodeForMember(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<AccessCode | undefined> {
  const rows = await executor
    .select()
    .from(accessCodes)
    .where(
      and(
        eq(accessCodes.spaceId, spaceId),
        eq(accessCodes.memberId, memberId),
        eq(accessCodes.status, 'issued'),
      ),
    )
    .limit(1)
  return rows[0]
}

/**
 * Revokes the member's live code in one member-scoped compare-and-set
 * (issue #12). The partial unique index guarantees at most one issued row,
 * so the single UPDATE either revokes it or finds nothing outstanding —
 * no read-before-write, no space row lock (architecture.md, "Data
 * access"). An issued-past-expiry code does not match and materialises its
 * expiry in the caller's follow-up write.
 */
export async function revokeLiveAccessCodeForMember(
  tx: Tx,
  spaceId: string,
  memberId: string,
  now: Date,
): Promise<AccessCode | undefined> {
  const updated = await tx
    .update(accessCodes)
    .set({ status: 'revoked', statusChangedAt: now })
    .where(
      and(
        eq(accessCodes.spaceId, spaceId),
        eq(accessCodes.memberId, memberId),
        eq(accessCodes.status, 'issued'),
        gt(accessCodes.expiresAt, now),
      ),
    )
    .returning()
  return updated[0]
}

export interface NewMemberSession {
  spaceId: string
  memberId: string
  tokenHash: string
  browser: string
  platform: string
  now: Date
  expiresAt: Date
}

export async function insertMemberSession(tx: Tx, data: NewMemberSession): Promise<void> {
  await tx.insert(memberSessions).values({
    spaceId: data.spaceId,
    memberId: data.memberId,
    tokenHash: data.tokenHash,
    browser: data.browser,
    platform: data.platform,
    createdAt: data.now,
    lastUsedAt: data.now,
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

/**
 * Stamps last-used time, at most once per throttle interval: one
 * compare-and-set on the row, so the request path stays free of extra
 * writes while the session list shows a fresh "last used".
 */
export async function touchMemberSessionByTokenHashAcrossSpaces(
  executor: Executor,
  tokenHash: string,
  staleBefore: Date,
  now: Date,
): Promise<void> {
  await executor
    .update(memberSessions)
    .set({ lastUsedAt: now })
    .where(and(eq(memberSessions.tokenHash, tokenHash), lt(memberSessions.lastUsedAt, staleBefore)))
}

/** A member's live sessions for the device review, last used first. */
export async function listLiveMemberSessionsForMember(
  executor: Executor,
  spaceId: string,
  memberId: string,
  now: Date,
): Promise<MemberSession[]> {
  return executor
    .select()
    .from(memberSessions)
    .where(
      and(
        eq(memberSessions.spaceId, spaceId),
        eq(memberSessions.memberId, memberId),
        gt(memberSessions.expiresAt, now),
      ),
    )
    .orderBy(desc(memberSessions.lastUsedAt), desc(memberSessions.id))
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

/**
 * Revokes one of the member's own sessions by id, reporting whether a row
 * was actually deleted. The delete is scoped to the space and member the
 * actor authenticated as, so a session id of another member or space
 * deletes nothing.
 */
export async function deleteMemberSessionById(
  tx: Tx,
  spaceId: string,
  memberId: string,
  sessionId: string,
): Promise<boolean> {
  const deleted = await tx
    .delete(memberSessions)
    .where(
      and(
        eq(memberSessions.spaceId, spaceId),
        eq(memberSessions.memberId, memberId),
        eq(memberSessions.id, sessionId),
      ),
    )
    .returning({ id: memberSessions.id })
  return deleted.length > 0
}

/** Opportunistic hygiene on sign-in: expired sessions of every member go. */
export async function deleteExpiredMemberSessionsAcrossSpaces(
  executor: Executor,
  now: Date,
): Promise<void> {
  await executor.delete(memberSessions).where(lt(memberSessions.expiresAt, now))
}

/**
 * Disconnects every device of one member: all of the member's sessions in
 * the space go, and no other member's. Sessions are not synchronised data,
 * so the caller spends no revision (architecture.md, Data access).
 */
export async function deleteMemberSessionsForMember(
  tx: Tx,
  spaceId: string,
  memberId: string,
): Promise<number> {
  const deleted = await tx
    .delete(memberSessions)
    .where(and(eq(memberSessions.spaceId, spaceId), eq(memberSessions.memberId, memberId)))
    .returning({ id: memberSessions.id })
  return deleted.length
}
