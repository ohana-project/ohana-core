import { sql } from 'drizzle-orm'
import type { Executor } from '../../platform/db/index.ts'
import { members } from './tables.ts'

/*
 * Administrative queries across spaces (ADR-0005). They are unscoped by
 * nature, so they live apart from the space-scoped access path and say so
 * in their name and file.
 */

/** Counts members per space across the whole installation, in one grouped query. */
export async function countMembersPerSpaceAcrossInstallation(
  executor: Executor,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ spaceId: members.spaceId, count: sql<number>`count(*)::int` })
    .from(members)
    .groupBy(members.spaceId)
  return new Map(rows.map((row) => [row.spaceId, row.count]))
}
