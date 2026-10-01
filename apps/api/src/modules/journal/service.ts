import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import { requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges } from '../sync/index.ts'
import type { CreateEntryBody, FeedQuery } from './contracts.ts'
import { DEFAULT_FEED_LIMIT } from './contracts.ts'
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
          const row = await updateEntry(
            writeTx,
            actor.spaceId,
            entryId,
            { title: normaliseTitle(input.title), text: input.text.trim() },
            revision,
            now,
          )
          if (row === undefined) {
            // The defensive backstop: the row was read under the same space
            // row lock, so it cannot vanish before the UPDATE — and a
            // refusal here spends no revision.
            throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
          }
          updated = row
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
 * return to draft (issue #15). The state is refused before anything is
 * written — the entry was read under the space row lock, so the decision
 * is never made from a half-done change, and a refused publish spends no
 * revision. The UPDATE's condition is a defensive backstop: under the
 * space row lock it cannot fire, and if it ever did, it would throw inside
 * the transaction and spend no revision.
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
    if (entry.state !== 'draft') {
      throw new DomainError(
        'entry_already_published',
        `Journal entry ${entryId} is already published`,
        409,
      )
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await publishEntry(writeTx, actor.spaceId, entryId, now, revision, now)
          if (row === undefined) {
            // The docstring's backstop: unreachable under the space row
            // lock, and revision-free even then.
            throw new DomainError(
              'entry_already_published',
              `Journal entry ${entryId} is already published`,
              409,
            )
          }
          published = row
        },
      },
      now,
    )
  })
  if (published === undefined) throw new Error('Publishing a journal entry produced no row')
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
 * The rows go back raw; the route maps them onto the wire shape.
 */
export async function listFeed(
  deps: JournalDeps,
  actor: JournalActor,
  query: FeedQuery,
): Promise<{ entries: JournalEntry[]; hasMore: boolean }> {
  const before = readCursor(query)
  const limit = query.limit ?? DEFAULT_FEED_LIMIT
  const rows = await listFeedPage(deps.db, actor.spaceId, before, limit + 1)
  return {
    entries: rows.slice(0, limit),
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
  // The date-time format is wide enough to admit moments the server cannot
  // faithfully name — a leap second the Date constructor cannot read, a
  // year before the timestamp type's honest range — and a cursor that
  // answers either would poison the query instead of naming its page.
  const at = new Date(before)
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() < 1) {
    throw new DomainError('invalid_cursor', 'A feed cursor names a real moment', 400)
  }
  return { at, id: beforeId }
}

/**
 * The author's own drafts, newest edit first — the separate list (issue
 * #15). The rows go back raw; the route maps them onto the wire shape.
 */
export async function listDrafts(deps: JournalDeps, actor: JournalActor): Promise<JournalEntry[]> {
  return listDraftsOfAuthor(deps.db, actor.spaceId, actor.memberId)
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
