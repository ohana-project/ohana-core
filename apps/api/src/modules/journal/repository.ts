import { and, desc, eq, gt, lt, or } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { entryVisibleToSql } from './policy.ts'
import { type JournalEntry, journalEntries } from './tables.ts'

export interface NewJournalEntry {
  authorMemberId: string
  title: string | null
  text: string
  revision: bigint
  now: Date
}

/**
 * Every query on this space-owned table takes the space as its required
 * first argument (architecture, "Space scoping"): there is no unscoped
 * journal access on the normal path.
 */
export async function insertEntry(
  tx: Tx,
  spaceId: string,
  data: NewJournalEntry,
): Promise<JournalEntry> {
  const inserted = await tx
    .insert(journalEntries)
    .values({
      spaceId,
      authorMemberId: data.authorMemberId,
      title: data.title,
      text: data.text,
      // A new entry always starts as a draft (issue #15): publishing is a
      // use case of its own, and only it stamps publishedAt.
      state: 'draft',
      publishedAt: null,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a journal entry returned no row')
  return row
}

export async function getEntryInSpace(
  executor: Executor,
  spaceId: string,
  entryId: string,
): Promise<JournalEntry | undefined> {
  const rows = await executor
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.spaceId, spaceId), eq(journalEntries.id, entryId)))
    .limit(1)
  return rows[0]
}

/**
 * The author's replace of the title-and-text pair, stamped with the
 * transaction's revision. No row means the entry is not in this space —
 * the use case decides what that answers, as its sibling publishEntry does.
 */
export async function updateEntry(
  tx: Tx,
  spaceId: string,
  entryId: string,
  changes: { title: string | null; text: string },
  revision: bigint,
  now: Date,
): Promise<JournalEntry | undefined> {
  const updated = await tx
    .update(journalEntries)
    .set({
      title: changes.title,
      text: changes.text,
      revision,
      updatedAt: now,
    })
    .where(and(eq(journalEntries.spaceId, spaceId), eq(journalEntries.id, entryId)))
    .returning()
  return updated[0]
}

/**
 * The one-way transition draft → published (CONTEXT.md, draft): the
 * condition in the UPDATE is the state guard, so an entry that is already
 * published returns no row and the use case refuses.
 */
export async function publishEntry(
  tx: Tx,
  spaceId: string,
  entryId: string,
  publishedAt: Date,
  revision: bigint,
  now: Date,
): Promise<JournalEntry | undefined> {
  const updated = await tx
    .update(journalEntries)
    .set({ state: 'published', publishedAt, revision, updatedAt: now })
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.id, entryId),
        eq(journalEntries.state, 'draft'),
      ),
    )
    .returning()
  return updated[0]
}

/**
 * One page of the shared feed, newest first, strictly before the cursor —
 * the keyset pair (publishedAt, id) keeps pages stable while entries are
 * published mid-scroll. `limit` rows come back; the use case asks for one
 * extra to learn whether a next page exists.
 */
export async function listFeedPage(
  executor: Executor,
  spaceId: string,
  before: { at: Date; id: string } | undefined,
  limit: number,
): Promise<JournalEntry[]> {
  return executor
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.state, 'published'),
        before === undefined
          ? undefined
          : or(
              lt(journalEntries.publishedAt, before.at),
              and(eq(journalEntries.publishedAt, before.at), lt(journalEntries.id, before.id)),
            ),
      ),
    )
    .orderBy(desc(journalEntries.publishedAt), desc(journalEntries.id))
    .limit(limit)
}

/** The author's drafts, newest edit first — the separate list only they see. */
export async function listDraftsOfAuthor(
  executor: Executor,
  spaceId: string,
  authorMemberId: string,
): Promise<JournalEntry[]> {
  return executor
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.authorMemberId, authorMemberId),
        eq(journalEntries.state, 'draft'),
      ),
    )
    .orderBy(desc(journalEntries.updatedAt), desc(journalEntries.id))
}

/**
 * The rows changed after `since` that the requesting member may see — the
 * sync contributor's delta (issue #14). The visibility filter is the
 * ordinary read's rule (policy.ts): published entries to everyone, drafts
 * to their author alone, so another member's draft never leaves the server.
 */
export async function listChangedEntriesVisibleTo(
  tx: Tx,
  spaceId: string,
  memberId: string,
  since: bigint,
): Promise<JournalEntry[]> {
  return tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        gt(journalEntries.revision, since),
        entryVisibleToSql(memberId),
      ),
    )
    .orderBy(desc(journalEntries.revision), desc(journalEntries.id))
}
