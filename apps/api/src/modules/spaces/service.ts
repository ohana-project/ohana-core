import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import {
  getSpaceById,
  getSpaceForUpdate,
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

/**
 * Returns the IANA spelling Intl resolves for `zone`, or undefined for
 * unknown zones and raw offsets. Link aliases keep the spelling sent when
 * Intl does not canonicalise them (for example Asia/Calcutta); they remain
 * valid IANA names even though the web picker lists only primary ones.
 */
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
    insertSpace(tx, { name: data.name.trim(), timezone, now: deps.clock.now() }),
  )
}

export async function listSpaces(
  deps: SpacesDeps,
  countMembers: SpaceMemberCounter,
): Promise<SpaceWithMemberCount[]> {
  const [rows, counts] = await Promise.all([listSpaceRows(deps.db), countMembers(deps.db)])
  return rows.map((space) => ({ ...space, memberCount: counts.get(space.id) ?? 0 }))
}

/** The same read inside a caller's transaction, for multi-step use cases. */
export async function getSpaceInTx(executor: Executor, spaceId: string): Promise<Space> {
  const space = await getSpaceById(executor, spaceId)
  if (space === undefined) {
    throw new DomainError('space_not_found', `Space ${spaceId} does not exist`, 404)
  }
  return space
}

export async function getSpace(deps: SpacesDeps, spaceId: string): Promise<Space> {
  return getSpaceInTx(deps.db, spaceId)
}

/**
 * Takes the space row lock inside a transaction. A use case that must read
 * before deciding to write starts here: the space lock is the first lock
 * every writer takes, so the revision bookkeeping serialises them and no
 * lock order can invert into a deadlock (architecture.md, "Revision
 * bookkeeping").
 */
export async function lockSpace(tx: Tx, spaceId: string): Promise<void> {
  await getSpaceForUpdateOrThrow(tx, spaceId)
}

async function getSpaceForUpdateOrThrow(tx: Tx, spaceId: string): Promise<Space> {
  const space = await getSpaceForUpdate(tx, spaceId)
  if (space === undefined) {
    throw new DomainError('space_not_found', `Space ${spaceId} does not exist`, 404)
  }
  return space
}

/**
 * Renames the space or changes its time zone; the revision advances with
 * the change in one statement. A patch that changes nothing is answered
 * from the stored row so it does not spend a revision and force a resync.
 * The read and the write share one transaction under the space row lock,
 * so the no-op decision can never be made from a half-done state.
 */
export async function updateSpace(
  deps: SpacesDeps,
  spaceId: string,
  changes: SpaceChanges,
): Promise<Space> {
  const timezone = changes.timezone !== undefined ? assertTimezone(changes.timezone) : undefined
  const name = changes.name?.trim()
  return deps.db.transaction(async (tx) => {
    const current = await getSpaceForUpdateOrThrow(tx, spaceId)
    const effective: SpaceChanges = {}
    if (name !== undefined && name !== current.name) effective.name = name
    if (timezone !== undefined && timezone !== current.timezone) effective.timezone = timezone
    if (Object.keys(effective).length === 0) return current
    return updateSpaceRow(tx, spaceId, effective, deps.clock.now())
  })
}

export async function advanceSpaceRevision(tx: Tx, spaceId: string, now: Date): Promise<bigint> {
  return incrementSpaceRevision(tx, spaceId, now)
}
