import type { Clock } from '../../platform/clock.ts'
import type { Db } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import type { JobSender } from '../../platform/jobs/index.ts'
import { readTrashRetentionDays } from '../admin/index.ts'
import { type ImageAccessRule, type ImageAccessTxRule, imagesOfEntries } from '../media/index.ts'
import { requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import type { CreateEntryBody, FeedQuery, JournalEntryWithImages } from './contracts.ts'
import { DEFAULT_FEED_LIMIT, JOURNAL_ENTRY_SYNC_ENTITY } from './contracts.ts'
import { JOURNAL_PURGE_JOB, type JournalPurgeJobData } from './jobs.ts'
import {
  assertEntryAuthoredBy,
  assertEntryTrashableBy,
  assertTrashedEntryRestorableBy,
  entryVisibleTo,
  purgeAtFor,
  trashedAtOf,
  trashedEntryVisibleTo,
} from './policy.ts'
import {
  getEntryInSpace,
  insertEntry,
  listChangedEntriesVisibleTo,
  listDraftsOfAuthor,
  listFeedPage,
  listTrashedEntries,
  markEntryRestored,
  markEntryTrashed,
  publishEntry,
  updateEntry,
} from './repository.ts'
import type { JournalEntry } from './tables.ts'

export interface JournalDeps {
  db: Db
  clock: Clock
  /** The jobs port: the trash use case schedules the entry's purge job. */
  jobs: JobSender
}

/**
 * The member a journal use case runs for: the space always comes from the
 * authenticated actor (architecture.md, request lifecycle). The routes pass
 * the access module's MemberActor, which satisfies this structurally — the
 * role rides along for the owner's moderation rights over published
 * entries (issue #16).
 */
export interface JournalActor {
  memberId: string
  spaceId: string
  role: 'owner' | 'regular'
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
): Promise<JournalEntryWithImages> {
  const now = deps.clock.now()
  let created: JournalEntryWithImages | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const inserted = await insertEntry(writeTx, actor.spaceId, {
            authorMemberId: actor.memberId,
            title: normaliseTitle(input.title),
            text: input.text.trim(),
            revision,
            now,
          })
          // A new entry has no photos yet; the read keeps every ordinary
          // delivery shaped the same, photos included.
          created = await attachImages(writeTx, inserted)
        },
      },
      now,
    )
  })
  if (created === undefined) throw new Error('Creating a journal entry produced no row')
  return created
}

/**
 * The entry's photos, attached to its row — the shape every ordinary
 * delivery takes, so the wire never shows a half-listed entry (the photos
 * ride inside it, issue #17).
 */
async function attachImages(
  executor: Parameters<typeof imagesOfEntries>[0],
  entry: JournalEntry,
): Promise<JournalEntryWithImages> {
  const grouped = await imagesOfEntries(executor, entry.spaceId, [entry.id])
  return { ...entry, images: grouped.get(entry.id) ?? [] }
}

async function attachImagesAll(
  executor: Parameters<typeof imagesOfEntries>[0],
  entries: JournalEntry[],
): Promise<JournalEntryWithImages[]> {
  const grouped = await imagesOfEntries(
    executor,
    entries[0]?.spaceId ?? '',
    entries.map((entry) => entry.id),
  )
  return entries.map((entry) => ({ ...entry, images: grouped.get(entry.id) ?? [] }))
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
): Promise<JournalEntryWithImages> {
  const now = deps.clock.now()
  let updated: JournalEntryWithImages | undefined
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
          updated = await attachImages(writeTx, row)
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
): Promise<JournalEntryWithImages> {
  const now = deps.clock.now()
  let published: JournalEntryWithImages | undefined
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
          published = await attachImages(writeTx, row)
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
 * unrevealed (architecture.md, "Errors"). A trashed entry answers 404 too —
 * it has left the ordinary views; the trash view is its only audience.
 * The photos ride along (issue #17) under the entry's own visibility.
 */
export async function getEntry(
  deps: JournalDeps,
  actor: JournalActor,
  entryId: string,
): Promise<JournalEntryWithImages> {
  const entry = await requireVisibleEntry(deps.db, actor, entryId)
  return attachImages(deps.db, entry)
}

/**
 * Whether this actor may see an entry's photos — the rule the media
 * module's read calls through the port the composition root wires. A
 * photo's permissions are its entry's: a draft's photos are the author's
 * alone, a published entry's belong to the space, and a trashed entry's
 * photos have left the ordinary views with it. (The section gate and the
 * in-transaction flavour below carry the section-visibility rule, ADR-0011.)
 */
export const assertEntryImageViewable: ImageAccessRule = async (executor, actor, entryId) => {
  const entry = await getEntryInSpace(executor, actor.spaceId, entryId)
  if (entry === undefined || !entryVisibleTo(entry, actor.memberId)) {
    throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
  }
}

/**
 * The upload's pre-flight: only the author attaches photos, in any state
 * (CONTEXT.md, published entry). Lock-free — it runs before a byte of the
 * upload is read; the authoritative check inside the transaction is the
 * flavour below.
 */
export const assertEntryImageEditable: ImageAccessRule = async (executor, actor, entryId) => {
  const entry = await getEntryInSpace(executor, actor.spaceId, entryId)
  if (entry === undefined || !entryVisibleTo(entry, actor.memberId)) {
    throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
  }
  assertEntryAuthoredBy(entry, actor)
}

/**
 * The write's authoritative check, inside the upload's or the removal's
 * transaction: the section recheck takes the space row lock first (ADR-0011),
 * then the same authorship rule decides under it.
 */
export const assertEntryImageEditableInTx: ImageAccessTxRule = async (tx, actor, entryId) => {
  await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
  const entry = await getEntryInSpace(tx, actor.spaceId, entryId)
  if (entry === undefined || !entryVisibleTo(entry, actor.memberId)) {
    throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
  }
  assertEntryAuthoredBy(entry, actor)
}

async function requireVisibleEntry(
  executor: Parameters<typeof getEntryInSpace>[0],
  actor: JournalActor,
  entryId: string,
): Promise<JournalEntry & { state: 'draft' | 'published' }> {
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
): Promise<{ entries: JournalEntryWithImages[]; hasMore: boolean }> {
  const before = readCursor(query)
  const limit = query.limit ?? DEFAULT_FEED_LIMIT
  const rows = await listFeedPage(deps.db, actor.spaceId, before, limit + 1)
  const withImages = await attachImagesAll(deps.db, rows.slice(0, limit))
  return {
    entries: withImages,
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
  // year outside 0001–9999, the only span the driver's ISO string
  // round-trips through PostgreSQL — and a cursor that answers either
  // would poison the query instead of naming its page.
  const at = new Date(before)
  const year = at.getUTCFullYear()
  if (Number.isNaN(at.getTime()) || year < 1 || year > 9999) {
    throw new DomainError('invalid_cursor', 'A feed cursor names a real moment', 400)
  }
  return { at, id: beforeId }
}

/**
 * The author's own drafts, newest edit first — the separate list (issue
 * #15). The rows go back raw; the route maps them onto the wire shape.
 */
export async function listDrafts(
  deps: JournalDeps,
  actor: JournalActor,
): Promise<JournalEntryWithImages[]> {
  const rows = await listDraftsOfAuthor(deps.db, actor.spaceId, actor.memberId)
  return attachImagesAll(deps.db, rows)
}

/** The sync contributor's delta: the entries this member may see, changed since the cursor. */
export async function listChangedEntriesFor(
  tx: Parameters<typeof listChangedEntriesVisibleTo>[0],
  actor: { memberId: string; spaceId: string },
  since: bigint,
): Promise<JournalEntryWithImages[]> {
  const rows = await listChangedEntriesVisibleTo(tx, actor.spaceId, actor.memberId, since)
  return attachImagesAll(tx, rows)
}

/**
 * The trash view's rows (issue #16): the trashed entries the member may
 * see, each naming its permanent-deletion date — trashedAt plus the
 * instance's retention, read here so a changed retention applies to
 * entries already in trash.
 */
export async function listTrash(
  deps: JournalDeps,
  actor: JournalActor,
): Promise<Array<{ entry: JournalEntry; purgeAt: Date }>> {
  const now = deps.clock.now()
  const [entries, retentionDays] = await Promise.all([
    listTrashedEntries(deps.db, actor.spaceId, actor.memberId),
    readTrashRetentionDays(deps.db),
  ])
  return (
    entries
      .map((entry) => ({
        entry,
        purgeAt: purgeAtFor(trashedAtOf(entry), retentionDays),
      }))
      // The window restore honours is the window the view shows: an entry
      // whose deletion date has passed leaves the list, the same rule the
      // restore use case refuses by.
      .filter((row) => row.purgeAt > now)
  )
}

/**
 * Removes the entry into trash (issue #16, ADR-0007): the author trashes
 * their own draft or published entry, an owner any published entry. The
 * row remembers the state it came from and the moment of removal, the
 * tombstone tells the audience it had — everyone for a published entry,
 * the author alone for a draft — and the entry's purge job is scheduled
 * inside the same transaction, so a rollback takes the job with the change.
 * The deletion date follows the current retention at read time, but the
 * scheduled job lands on it; the recurring sweep re-checks against the
 * retention of the moment before acting.
 */
export async function trashEntry(
  deps: JournalDeps,
  actor: JournalActor,
  entryId: string,
): Promise<{ entry: JournalEntry; purgeAt: Date }> {
  const now = deps.clock.now()
  let trashed: { entry: JournalEntry; purgeAt: Date } | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
    const entry = await requireVisibleEntry(tx, actor, entryId)
    assertEntryTrashableBy(entry, actor)
    const retentionDays = await readTrashRetentionDays(tx)
    const purgeAt = purgeAtFor(now, retentionDays)
    const tombstone: TombstoneInput =
      entry.state === 'published'
        ? { entity: JOURNAL_ENTRY_SYNC_ENTITY, entityId: entry.id, audience: { kind: 'all' } }
        : {
            entity: JOURNAL_ENTRY_SYNC_ENTITY,
            entityId: entry.id,
            audience: { kind: 'member', memberId: entry.authorMemberId },
          }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await markEntryTrashed(writeTx, actor.spaceId, entryId, now, revision)
          if (row === undefined) {
            // The defensive backstop: the row was read under the same space
            // row lock, so it cannot vanish before the UPDATE — and a
            // refusal here spends no revision.
            throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
          }
          trashed = { entry: row, purgeAt }
        },
        tombstones: [tombstone],
      },
      now,
    )
    const job: JournalPurgeJobData = { spaceId: actor.spaceId, entryId }
    await deps.jobs.sendInTx(tx, { name: JOURNAL_PURGE_JOB, data: job, startAfter: purgeAt })
  })
  if (trashed === undefined) throw new Error('Trashing a journal entry produced no row')
  return trashed
}

/**
 * The way back (issue #16, ADR-0007): the entry returns to the state it
 * was trashed from, published moment and last-edit time included. The
 * author restores their own entry, an owner any entry trashed from
 * published; a trashed draft is invisible to everyone else, so a
 * stranger's answer is 404. The window closes at the permanent-deletion
 * date the trash view shows — past it the answer is 409 `entry_purge_due`:
 * the retention of the moment decides, and the worker's sweep would have
 * the row moments later anyway. No tombstone is written — the restored
 * row carries a fresh revision, and the sync's rule that an upsert
 * outranks a tombstone of the same row delivers it back to the devices it
 * had reached before.
 */
export async function restoreTrashedEntry(
  deps: JournalDeps,
  actor: JournalActor,
  entryId: string,
): Promise<JournalEntryWithImages> {
  const now = deps.clock.now()
  let restored: JournalEntryWithImages | undefined
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
    const entry = await getEntryInSpace(tx, actor.spaceId, entryId)
    if (
      entry === undefined ||
      entry.state !== 'trashed' ||
      !trashedEntryVisibleTo(entry, actor.memberId)
    ) {
      throw notFound('entry_not_found', `Journal entry ${entryId} does not exist`)
    }
    assertTrashedEntryRestorableBy(entry, actor)
    // The window: ADR-0007 lets the entry be restored before its retention
    // expires, and the date the trash view shows is trashedAt plus the
    // retention read here, so the two can never disagree.
    const retentionDays = await readTrashRetentionDays(tx)
    if (purgeAtFor(trashedAtOf(entry), retentionDays) <= now) {
      throw new DomainError(
        'entry_purge_due',
        `Journal entry ${entryId} is due to be permanently deleted`,
        409,
      )
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await markEntryRestored(writeTx, actor.spaceId, entryId, revision)
          if (row === undefined) {
            // The defensive backstop, like publish's: unreachable under the
            // space row lock, and revision-free even then. The state can
            // only have stopped being trashed, which the read above excludes.
            throw new DomainError(
              'entry_not_trashed',
              `Journal entry ${entryId} is not in the trash`,
              409,
            )
          }
          restored = await attachImages(writeTx, row)
        },
      },
      now,
    )
  })
  if (restored === undefined) throw new Error('Restoring a journal entry produced no row')
  return restored
}

/** The schema already validates the raw title; this applies to what is stored. */
function normaliseTitle(title: string | undefined): string | null {
  const trimmed = title?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}
