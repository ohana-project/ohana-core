import { isNull, sql } from 'drizzle-orm'
import type { Executor } from '../../platform/db/index.ts'
import { members } from './tables.ts'

/*
 * Administrative queries across spaces (ADR-0005). They are unscoped by
 * nature, so they live apart from the space-scoped access path and say so
 * in their name and file.
 */

/**
 * Counts the active members per space across the whole installation, in one
 * grouped query. Archived members are out of the space (issue #23), so
 * they do not count toward it.
 */
export async function countMembersPerSpaceAcrossInstallation(
  executor: Executor,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ spaceId: members.spaceId, count: sql<number>`count(*)::int` })
    .from(members)
    .where(isNull(members.archivedAt))
    .groupBy(members.spaceId)
  return new Map(rows.map((row) => [row.spaceId, row.count]))
}
