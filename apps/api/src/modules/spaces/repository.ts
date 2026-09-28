import { eq, sql } from 'drizzle-orm'
import type { Executor } from '../../platform/db/index.ts'
import { notFound } from '../../platform/errors.ts'
import { type Space, spaces } from './tables.ts'

export interface NewSpace {
  name: string
  now: Date
}

export async function insertSpace(executor: Executor, data: NewSpace): Promise<Space> {
  const inserted = await executor
    .insert(spaces)
    .values({ name: data.name, createdAt: data.now, updatedAt: data.now })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a space returned no row')
  return row
}

export async function getSpaceById(executor: Executor, id: string): Promise<Space | undefined> {
  const rows = await executor.select().from(spaces).where(eq(spaces.id, id)).limit(1)
  return rows[0]
}

export async function incrementSpaceRevision(
  executor: Executor,
  spaceId: string,
  now: Date,
): Promise<bigint> {
  const rows = await executor
    .update(spaces)
    .set({ revision: sql`${spaces.revision} + 1`, updatedAt: now })
    .where(eq(spaces.id, spaceId))
    .returning({ revision: spaces.revision })
  const row = rows[0]
  if (!row) throw notFound('space_not_found', `Space ${spaceId} does not exist`)
  return row.revision
}
