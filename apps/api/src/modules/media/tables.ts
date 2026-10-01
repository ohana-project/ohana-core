import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'
// The composite foreign keys of ADR-0016 are the one allowed cross-module
// table reference (architecture.md, dependency rules): a photo belongs to
// exactly one entry of exactly one space.
import { journalEntries } from '../journal/tables.ts'
import { members } from '../members/tables.ts'
import { spaces } from '../spaces/tables.ts'

/**
 * The states an uploaded photo takes (issue #17): the row is created the
 * moment the original is safely in storage, the worker moves it to ready
 * when the derivatives exist, and failed when the original could not be
 * decoded even after the queue's retries.
 */
export const imageStates = ['processing', 'ready', 'failed'] as const

/**
 * The photos of one journal entry (issue #17, ADR-0008). The original is
 * stored byte-for-byte in object storage and never altered; this row only
 * names it — its size, hash, and content type — and describes the
 * derivatives the worker produces beside it. The photos are delivered to
 * clients inside their entry's DTO (contracts.ts of the journal), so the
 * row carries a revision but has no tombstone entity of its own: when the
 * entry goes, its photos go with it — the storage objects are deleted by
 * the purge handler after the rows are gone.
 */
export const entryImages = pgTable(
  'entry_images',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    entryId: uuid('entry_id').notNull(),
    // The author of the entry — the only member who may attach or remove
    // photos (CONTEXT.md, published entry); the composite foreign key keeps
    // the reference inside one space (ADR-0016).
    uploaderMemberId: uuid('uploader_member_id').notNull(),
    // The original exactly as uploaded: these columns describe it, the
    // object in storage is never rewritten (ADR-0008).
    originalBytes: integer('original_bytes').notNull(),
    originalSha256: text('original_sha256').notNull(),
    originalContentType: text('original_content_type').notNull(),
    state: text('state').notNull().$type<(typeof imageStates)[number]>(),
    // The feed derivative's pixel size, so screens can lay the photo strip
    // out before its bytes arrive. Null until the worker has run.
    width: integer('width'),
    height: integer('height'),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('entry_images_space_id_id_key').on(table.spaceId, table.id),
    check('entry_images_state_allowed', sql`${table.state} in ('processing', 'ready', 'failed')`),
    check('entry_images_original_bytes_positive', sql`${table.originalBytes} > 0`),
    // A ready row carries the feed derivative's size; the other states have
    // nothing measured yet.
    check(
      'entry_images_size_matches_state',
      sql`(${table.state} = 'ready') = (${table.width} is not null and ${table.height} is not null)`,
    ),
    // An entry's photo list reads whole; the purge sweep asks nothing here —
    // the photos go with the entry's own purge.
    index('entry_images_entry_idx').on(table.spaceId, table.entryId, table.createdAt),
    // The sync contributor's delta scans one space's rows past a revision —
    // the images ride their entry, whose revision they share.
    index('entry_images_sync_idx').on(table.spaceId, table.revision),
    foreignKey({
      name: 'entry_images_space_id_entry_id_fk',
      columns: [table.spaceId, table.entryId],
      foreignColumns: [journalEntries.spaceId, journalEntries.id],
    })
      // The photos go where their entry goes: the purge deletes the entry
      // row, and the photo rows leave with it — the storage objects are
      // the purge handler's own cleanup, after the commit.
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'entry_images_space_id_uploader_member_id_fk',
      columns: [table.spaceId, table.uploaderMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type EntryImage = typeof entryImages.$inferSelect
