import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import { requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges } from '../sync/index.ts'
import type { CreateEntryBody, FeedQuery, JournalEntryDto, JournalFeedDto } from './contracts.ts'
import { DEFAULT_FEED_LIMIT, toEntryDto } from './contracts.ts'
import { assertEntryAuthoredBy, entryVisibleTo } from './policy.ts'
import {
  getEntryInSpace,
  insertEntry,
  listChangedEntriesVisibleTo,
  listDraftsOfAuthor,
  listFeedPage,
  publishEntry,
  updateEntry,
} from './repository.ts'
import type { JournalEntry } from './tables.ts'

export interface JournalDeps {
  db: Db
  clock: Clock
}

/**
 * The member a journal use case runs for: the space always comes from the
 * authenticated actor (architecture.md, request lifecycle). The routes pass
 * the access module's MemberActor, which satisfies this structurally.
 */
export interface JournalActor {
  memberId: string
  spaceId: string
}

/**
 * Writes a new draft (issue #15): the entry starts visible to its author
 * alone. The use case takes the space row lock through the section
 * recheck, so a hide that commits alongside the write is still honoured,
 * and the revision advances with the row in one transaction.
 */
export async function createDraft(
  deps: JournalDeps,
  actor: JournalActor,
  input: CreateEntryBody,
): Promise<JournalEntry> {
  const now = deps.clock.now()
  let created: JournalEntry | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertEntry(writeTx, actor.spaceId, {
            authorMemberId: actor.memberId,
            title: normaliseTitle(input.title),
            text: input.text.trim(),
            revision,
            now,
          })
        },
      },
      now,
    )
  })
  if (created === undefined) throw new Error('Creating a journal entry produced no row')
  return created
}

/**
 * The author's edit, in any state (CONTEXT.md, published entry). The entry
 * is read after the space lock, so the author decision is never made from
 * a half-done change; an entry the actor may not even see answers 404.
 */
export async function updateEntryText(
  deps: JournalDeps,
  actor: JournalActor,
  entryId: string,
  input: CreateEntryBody,
): Promise<JournalEntry> {
  const now = deps.clock.now()
  let updated: JournalEntry | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
    const entry = await requireVisibleEntry(tx, actor, entryId)
    assertEntryAuthoredBy(entry, actor)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          updated = await updateEntry(
            writeTx,
            actor.spaceId,
            entryId,
            { title: normaliseTitle(input.title), text: input.text.trim() },
            revision,
            now,
          )
        },
      },
      now,
    )
  })
  if (updated === undefined) throw new Error('Updating a journal entry produced no row')
  return updated
}

/**
 * Publishes the author's draft: the shared feed gains it, and it can never
 * return to draft (issue #15). The UPDATE's state condition is the guard —
 * under the space lock a racing publish has already committed, and the
 * guard turns the second one away with a conflict.
 */
export async function publishDraft(
  deps: JournalDeps,
  actor: JournalActor,
  entryId: string,
): Promise<JournalEntry> {
  const now = deps.clock.now()
  let published: JournalEntry | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
    const entry = await requireVisibleEntry(tx, actor, entryId)
    assertEntryAuthoredBy(entry, actor)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          published = await publishEntry(writeTx, actor.spaceId, entryId, now, revision, now)
        },
      },
      now,
    )
  })
  if (published === undefined) {
    throw new DomainError(
      'entry_already_published',
      `Journal entry ${entryId} is already published`,
      409,
    )
  }
  return published
}

/**
 * One entry, the way the requesting member may see it: their own draft or
 * any published entry; a stranger's draft answers 404, its existence
 * unrevealed (architecture.md, "Errors").
 */
export async function getEntry(
  deps: JournalDeps,
  actor: JournalActor,
  entryId: string,
): Promise<JournalEntry> {
  return requireVisibleEntry(deps.db, actor, entryId)
}

async function requireVisibleEntry(
  executor: Parameters<typeof getEntryInSpace>[0],
  actor: JournalActor,
  entryId: string,
): Promise<JournalEntry> {
  const entry = await getEntryInSpace(executor, actor.spaceId, entryId)
  if (entry === undefined || !entryVisibleTo(entry, actor.memberId)) {
    throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
  }
  return entry
}

/**
 * The shared feed: every published entry of the space, newest first,
 * keyset-paginated (issue #15). Drafts never appear here, whoever asks.
 */
export async function listFeed(
  deps: JournalDeps,
  actor: JournalActor,
  query: FeedQuery,
): Promise<JournalFeedDto> {
  const before = readCursor(query)
  const limit = query.limit ?? DEFAULT_FEED_LIMIT
  const rows = await listFeedPage(deps.db, actor.spaceId, before, limit + 1)
  const page = rows.slice(0, limit)
  return {
    entries: page.map(toEntryDto),
    hasMore: rows.length > limit,
  }
}

function readCursor(query: FeedQuery): { at: Date; id: string } | undefined {
  const { before, beforeId } = query
  if (before === undefined && beforeId === undefined) return undefined
  if (before === undefined || beforeId === undefined) {
    throw new DomainError(
      'invalid_cursor',
      'A feed cursor names both the published time and the entry id',
      400,
    )
  }
  return { at: new Date(before), id: beforeId }
}

/** The author's own drafts, newest edit first — the separate list (issue #15). */
export async function listDrafts(
  deps: JournalDeps,
  actor: JournalActor,
): Promise<JournalEntryDto[]> {
  const rows = await listDraftsOfAuthor(deps.db, actor.spaceId, actor.memberId)
  return rows.map(toEntryDto)
}

/** The sync contributor's delta: the entries this member may see, changed since the cursor. */
export async function listChangedEntriesFor(
  tx: Parameters<typeof listChangedEntriesVisibleTo>[0],
  actor: JournalActor,
  since: bigint,
): Promise<JournalEntry[]> {
  return listChangedEntriesVisibleTo(tx, actor.spaceId, actor.memberId, since)
}

/** The schema already validates the raw title; this applies to what is stored. */
function normaliseTitle(title: string | undefined): string | null {
  const trimmed = title?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}
