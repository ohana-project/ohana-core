import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import {
  getSpaceById,
  incrementSpaceRevision,
  insertSpace,
  listSpaces as listSpaceRows,
  type SpaceChanges,
  updateSpace as updateSpaceRow,
} from './repository.ts'
import type { Space } from './tables.ts'

export interface SpacesDeps {
  db: Db
  clock: Clock
}

export type SpaceWithMemberCount = Space & { memberCount: number }

/**
 * The member counts arrive through the members module's public surface: the
 * spaces module never reaches into another module's tables (architecture
 * dependency rules).
 */
export type MemberCounter = (executor: Executor) => Promise<Map<string, number>>

/** Any IANA time zone name accepted by Intl is a valid space time zone. */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function assertTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new DomainError('invalid_timezone', `“${timezone}” is not an IANA time zone`, 400)
  }
}

export async function createSpace(
  deps: SpacesDeps,
  data: { name: string; timezone?: string },
): Promise<Space> {
  const timezone = data.timezone ?? 'UTC'
  assertTimezone(timezone)
  return deps.db.transaction((tx) =>
    insertSpace(tx, { name: data.name, timezone, now: deps.clock.now() }),
  )
}

export async function listSpaces(
  deps: SpacesDeps,
  countMembers: MemberCounter,
): Promise<SpaceWithMemberCount[]> {
  const [rows, counts] = await Promise.all([listSpaceRows(deps.db), countMembers(deps.db)])
  return rows.map((space) => ({ ...space, memberCount: counts.get(space.id) ?? 0 }))
}

export async function getSpace(deps: SpacesDeps, spaceId: string): Promise<Space> {
  const space = await getSpaceById(deps.db, spaceId)
  if (space === undefined) {
    throw new DomainError('space_not_found', `Space ${spaceId} does not exist`, 404)
  }
  return space
}

export async function updateSpace(
  deps: SpacesDeps,
  spaceId: string,
  changes: SpaceChanges,
): Promise<Space> {
  if (changes.timezone !== undefined) assertTimezone(changes.timezone)
  return deps.db.transaction((tx) => updateSpaceRow(tx, spaceId, changes, deps.clock.now()))
}

export async function advanceSpaceRevision(tx: Tx, spaceId: string, now: Date): Promise<bigint> {
  return incrementSpaceRevision(tx, spaceId, now)
}
