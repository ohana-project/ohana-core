import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { type Administrator, type AdminSession, administrators, adminSessions } from './tables.ts'

export interface NewAdministrator {
  passwordHash: string
  now: Date
}

/** Creates the one administrator; returns undefined when one already exists. */
export async function insertAdministratorIfAbsent(
  tx: Tx,
  data: NewAdministrator,
): Promise<Administrator | undefined> {
  const inserted = await tx
    .insert(administrators)
    .values({ passwordHash: data.passwordHash, createdAt: data.now, updatedAt: data.now })
    .onConflictDoNothing({ target: administrators.singleton })
    .returning()
  return inserted[0]
}

export async function getAdministrator(executor: Executor): Promise<Administrator | undefined> {
  const rows = await executor.select().from(administrators).limit(1)
  return rows[0]
}

export async function updateAdministratorPassword(
  tx: Tx,
  administratorId: string,
  passwordHash: string,
  now: Date,
): Promise<Administrator> {
  const updated = await tx
    .update(administrators)
    .set({ passwordHash, updatedAt: now })
    .where(eq(administrators.id, administratorId))
    .returning()
  const row = updated[0]
  if (!row) throw new Error(`Administrator ${administratorId} does not exist`)
  return row
}

export interface NewAdminSession {
  administratorId: string
  tokenHash: string
  now: Date
  expiresAt: Date
}

export async function insertAdminSession(tx: Tx, data: NewAdminSession): Promise<AdminSession> {
  const inserted = await tx
    .insert(adminSessions)
    .values({
      administratorId: data.administratorId,
      tokenHash: data.tokenHash,
      createdAt: data.now,
      expiresAt: data.expiresAt,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting an administrative session returned no row')
  return row
}

export async function getAdminSessionByTokenHash(
  executor: Executor,
  tokenHash: string,
  now: Date,
): Promise<AdminSession | undefined> {
  const rows = await executor
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, tokenHash), gt(adminSessions.expiresAt, now)))
    .limit(1)
  return rows[0]
}

export async function deleteAdminSessionByTokenHash(tx: Tx, tokenHash: string): Promise<number> {
  const deleted = await tx
    .delete(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash))
    .returning({ id: adminSessions.id })
  return deleted.length
}

export async function deleteAdminSessionsForAdministrator(
  tx: Tx,
  administratorId: string,
): Promise<void> {
  await tx.delete(adminSessions).where(eq(adminSessions.administratorId, administratorId))
}

export async function deleteExpiredAdminSessions(executor: Executor, now: Date): Promise<void> {
  await executor.delete(adminSessions).where(lt(adminSessions.expiresAt, now))
}

export async function countAdministrators(executor: Executor): Promise<number> {
  const rows = await executor.select({ count: sql<number>`count(*)::int` }).from(administrators)
  return rows[0]?.count ?? 0
}
