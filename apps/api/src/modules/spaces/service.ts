import type { Clock } from '../../platform/clock.ts'
import type { Db, Executor, Tx } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import {
  assertSectionVisible,
  SECTION_IDS,
  type SectionId,
  type SpaceSections,
  sectionVisibility,
} from './policy.ts'
import {
  getSpaceById,
  getSpaceForUpdate,
  incrementSpaceRevision,
  insertSpace,
  listSpaces as listSpaceRows,
  type SpaceChanges as SpaceRowChanges,
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

async function getSpaceOrThrow(executor: Executor, spaceId: string): Promise<Space> {
  const space = await getSpaceById(executor, spaceId)
  if (space === undefined) {
    throw new DomainError('space_not_found', `Space ${spaceId} does not exist`, 404)
  }
  return space
}

export async function getSpace(deps: SpacesDeps, spaceId: string): Promise<Space> {
  return getSpaceOrThrow(deps.db, spaceId)
}

/** The same read inside a caller's transaction, for multi-step use cases. */
export async function getSpaceInTx(tx: Tx, spaceId: string): Promise<Space> {
  return getSpaceOrThrow(tx, spaceId)
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

/** What a caller may change about the space, in domain terms. */
export interface SpaceChanges {
  name?: string
  timezone?: string
  /** Only the sections named here are touched (ADR-0011). */
  sections?: Partial<SpaceSections>
}

/** Translates the domain change set onto the space row's columns; unchanged values are dropped. */
function toRowChanges(changes: SpaceChanges, current: Space): SpaceRowChanges {
  const row: SpaceRowChanges = {}
  if (changes.name !== undefined && changes.name !== current.name) row.name = changes.name
  if (changes.timezone !== undefined && changes.timezone !== current.timezone) {
    row.timezone = changes.timezone
  }
  const visibility = sectionVisibility(current)
  for (const section of SECTION_IDS) {
    const next = changes.sections?.[section]
    if (next !== undefined && next !== visibility[section]) {
      row[`${section}Visible` as `${SectionId}Visible`] = next
    }
  }
  return row
}

/**
 * Renames the space, changes its time zone, or toggles section visibility;
 * the revision advances with the changes in one statement. A patch that
 * changes nothing is answered from the stored row so it does not spend a
 * revision and force a resync. The read and the write share one transaction
 * under the space row lock, so the no-op decision can never be made from a
 * half-done state.
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
    const candidate: SpaceChanges = { name, timezone, sections: changes.sections }
    const effective = toRowChanges(candidate, current)
    if (Object.values(effective).every((value) => value === undefined)) return current
    return updateSpaceRow(tx, spaceId, effective, deps.clock.now())
  })
}

export async function advanceSpaceRevision(tx: Tx, spaceId: string, now: Date): Promise<bigint> {
  return incrementSpaceRevision(tx, spaceId, now)
}

/**
 * Throws 404 `section_hidden` unless the space shows the section; a
 * lock-free read. Module-internal: only the section gate calls it, with
 * the pool (deps.db). Section modules get requireVisibleSectionInTx from
 * index.ts.
 */
export async function requireVisibleSection(
  executor: Executor,
  spaceId: string,
  section: SectionId,
): Promise<Space> {
  const space = await getSpaceOrThrow(executor, spaceId)
  assertSectionVisible(space, section)
  return space
}

/**
 * The same check for a section module's write use case: it takes the space
 * row lock and only then decides, so a hide that commits alongside the
 * write is still honoured. Call it first inside the use case's
 * transaction, before any write (architecture.md, "Revision bookkeeping").
 */
export async function requireVisibleSectionInTx(
  tx: Tx,
  spaceId: string,
  section: SectionId,
): Promise<Space> {
  const space = await getSpaceForUpdateOrThrow(tx, spaceId)
  assertSectionVisible(space, section)
  return space
}
