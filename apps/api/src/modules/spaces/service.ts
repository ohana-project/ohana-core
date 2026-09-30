import type { Clock } from '../../platform/clock.ts'
import type { Db, Tx } from '../../platform/db/index.ts'
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
 * The port the composition root fills with the members module's
 * administrative count: the spaces module never imports members (it sits
 * below it in the dependency order).
 */
export type SpaceMemberCounter = (db: Db) => Promise<Map<string, number>>

/** Any IANA time zone name accepted by Intl is a valid space time zone. */
export function canonicalTimezone(zone: string): string | undefined {
  // Intl also accepts raw offsets on some runtimes; a space zone is an
  // IANA name, so offsets are rejected before the lookup.
  if (/^[+-]/.test(zone)) return undefined
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function assertTimezone(timezone: string): string {
  const canonical = canonicalTimezone(timezone)
  if (canonical === undefined) {
    throw new DomainError('invalid_timezone', `“${timezone}” is not an IANA time zone`, 400)
  }
  return canonical
}

export async function createSpace(
  deps: SpacesDeps,
  data: { name: string; timezone?: string },
): Promise<Space> {
  const timezone = assertTimezone(data.timezone ?? 'UTC')
  return deps.db.transaction((tx) =>
    insertSpace(tx, { name: data.name, timezone, now: deps.clock.now() }),
  )
}

export async function listSpaces(
  deps: SpacesDeps,
  countMembers: SpaceMemberCounter,
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

/**
 * Renames the space or changes its time zone; the revision advances with
 * the change in one statement. A patch that changes nothing is answered
 * from the stored row so it does not spend a revision and force a resync.
 */
export async function updateSpace(
  deps: SpacesDeps,
  spaceId: string,
  changes: SpaceChanges,
): Promise<Space> {
  const timezone = changes.timezone !== undefined ? assertTimezone(changes.timezone) : undefined
  const current = await getSpace(deps, spaceId)
  const effective: SpaceChanges = {}
  if (changes.name !== undefined && changes.name !== current.name) effective.name = changes.name
  if (timezone !== undefined && timezone !== current.timezone) effective.timezone = timezone
  if (Object.keys(effective).length === 0) return current
  return deps.db.transaction((tx) => updateSpaceRow(tx, spaceId, effective, deps.clock.now()))
}

export async function advanceSpaceRevision(tx: Tx, spaceId: string, now: Date): Promise<bigint> {
  return incrementSpaceRevision(tx, spaceId, now)
}
