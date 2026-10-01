import { and, desc, eq, gt, inArray, lt, lte, or, sql } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { entryVisibleToSql, trashedEntryVisibleToSql } from './policy.ts'
import { type JournalEntry, journalEntries, trashedFromStates } from './tables.ts'

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
 * to their author alone, trashed rows to nobody — another member's draft
 * never leaves the server, and a trashed row left the very views the trash
 * transaction's tombstones name (issue #16).
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

/**
 * The one-way removal into trash (ADR-0007): the row keeps its text, its
 * published moment, its last-edit time, and the state it came from, so
 * restore can put it back exactly as it was. The condition in the UPDATE
 * is the state guard — an entry already trashed returns no row and the
 * use case refuses.
 */
export async function markEntryTrashed(
  tx: Tx,
  spaceId: string,
  entryId: string,
  trashedAt: Date,
  revision: bigint,
): Promise<JournalEntry | undefined> {
  const updated = await tx
    .update(journalEntries)
    .set({
      state: 'trashed',
      // The state guard above admits only draft and published, so the
      // remembered state is the row's state as the UPDATE reads it.
      trashedFromState: sql`${journalEntries.state}`,
      trashedAt,
      revision,
    })
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.id, entryId),
        inArray(journalEntries.state, [...trashedFromStates]),
      ),
    )
    .returning()
  return updated[0]
}

/**
 * The way back out of trash: the entry returns to the state it was trashed
 * from, published moment and last-edit time included — the revision alone
 * carries the change to sync. The condition is the state guard — a row
 * that is not trashed returns none and the use case refuses.
 */
export async function markEntryRestored(
  tx: Tx,
  spaceId: string,
  entryId: string,
  revision: bigint,
): Promise<JournalEntry | undefined> {
  const updated = await tx
    .update(journalEntries)
    .set({
      state: sql`${journalEntries.trashedFromState}`,
      trashedFromState: null,
      trashedAt: null,
      revision,
    })
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.id, entryId),
        eq(journalEntries.state, 'trashed'),
      ),
    )
    .returning()
  return updated[0]
}

/**
 * The trash view's rows (issue #16): the space's trashed entries the
 * requesting member may see — the trash view's own rule (policy.ts, in
 * its SQL dialect here). Newest removal first.
 */
export async function listTrashedEntries(
  executor: Executor,
  spaceId: string,
  memberId: string,
): Promise<JournalEntry[]> {
  return executor
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.state, 'trashed'),
        trashedEntryVisibleToSql(memberId),
      ),
    )
    .orderBy(desc(journalEntries.trashedAt), desc(journalEntries.id))
}

/**
 * The purge sweep's discovery read across every space: the spaces holding
 * trashed rows whose retention has run out. Only the space ids come back —
 * each purge re-reads its rows under the space row lock. Cross-space by
 * design and named for it, like the access module's session sweep
 * (architecture.md, "Space scoping").
 */
export async function listSpacesWithPurgeableEntriesAcrossSpaces(
  executor: Executor,
  purgedBefore: Date,
): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ spaceId: journalEntries.spaceId })
    .from(journalEntries)
    .where(and(eq(journalEntries.state, 'trashed'), lte(journalEntries.trashedAt, purgedBefore)))
  return rows.map((row) => row.spaceId)
}

/**
 * The same read scoped to one space, inside the purge transaction: the
 * rows it re-checks under the space row lock are the rows it deletes.
 */
export async function listPurgeableEntriesInSpace(
  tx: Tx,
  spaceId: string,
  purgedBefore: Date,
): Promise<JournalEntry[]> {
  return tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        eq(journalEntries.state, 'trashed'),
        lte(journalEntries.trashedAt, purgedBefore),
      ),
    )
}

/**
 * The purge's write: the rows go for good. The tombstones the caller
 * writes beside it carry the revision, so the delete itself needs none.
 * The state guard keeps a row that stopped being trashed (a restore that
 * raced ahead) untouched — under the space row lock the caller holds, it
 * cannot fire anyway.
 */
export async function deleteTrashedEntriesInSpace(
  tx: Tx,
  spaceId: string,
  entryIds: readonly string[],
): Promise<JournalEntry[]> {
  if (entryIds.length === 0) return []
  return tx
    .delete(journalEntries)
    .where(
      and(
        eq(journalEntries.spaceId, spaceId),
        inArray(journalEntries.id, [...entryIds]),
        eq(journalEntries.state, 'trashed'),
      ),
    )
    .returning()
}
