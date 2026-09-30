import { asc, eq, sql } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { notFound } from '../../platform/errors.ts'
import { type Space, spaces } from './tables.ts'

export interface NewSpace {
  name: string
  timezone: string
  now: Date
}

export async function insertSpace(tx: Tx, data: NewSpace): Promise<Space> {
  const inserted = await tx
    .insert(spaces)
    .values({
      name: data.name,
      timezone: data.timezone,
      revision: 0n,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a space returned no row')
  return row
}

export async function getSpaceById(executor: Executor, id: string): Promise<Space | undefined> {
  const rows = await executor.select().from(spaces).where(eq(spaces.id, id)).limit(1)
  return rows[0]
}

/**
 * Locking read for read-decide-write use cases inside one transaction. The
 * weaker NO KEY UPDATE strength suffices: the row's UUID key never changes,
 * and the stronger lock would block the FOR KEY SHARE locks that foreign-key
 * checks take in unrelated transactions.
 */
export async function getSpaceForUpdate(tx: Tx, id: string): Promise<Space | undefined> {
  const rows = await tx.select().from(spaces).where(eq(spaces.id, id)).limit(1).for('no key update')
  return rows[0]
}

/** Administrative listing across spaces (ADR-0005): oldest first, id as a stable tiebreaker. */
export async function listSpaces(executor: Executor): Promise<Space[]> {
  return executor.select().from(spaces).orderBy(asc(spaces.createdAt), asc(spaces.id))
}

export interface SpaceChanges {
  name?: string
  timezone?: string
}

/**
 * Renames the space or changes its time zone and advances the revision in
 * the same statement, so observers never see the new values on the old
 * revision.
 */
export async function updateSpace(
  tx: Tx,
  spaceId: string,
  changes: SpaceChanges,
  now: Date,
): Promise<Space> {
  const updated = await tx
    .update(spaces)
    .set({ ...changes, revision: sql`${spaces.revision} + 1`, updatedAt: now })
    .where(eq(spaces.id, spaceId))
    .returning()
  const row = updated[0]
  if (!row) throw notFound('space_not_found', `Space ${spaceId} does not exist`)
  return row
}

export async function incrementSpaceRevision(tx: Tx, spaceId: string, now: Date): Promise<bigint> {
  const rows = await tx
    .update(spaces)
    .set({ revision: sql`${spaces.revision} + 1`, updatedAt: now })
    .where(eq(spaces.id, spaceId))
    .returning({ revision: spaces.revision })
  const row = rows[0]
  if (!row) throw notFound('space_not_found', `Space ${spaceId} does not exist`)
  return row.revision
}
