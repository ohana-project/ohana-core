import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'
import { members } from '../members/tables.ts'
import { spaces } from '../spaces/tables.ts'

/**
 * The states a journal entry takes in version 1.0 up to the trash ticket:
 * a new entry starts as a draft only its author sees, and publishing moves
 * it to the space's shared feed. A published entry never returns to draft
 * (CONTEXT.md, draft).
 */
export const entryStates = ['draft', 'published'] as const

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The entry's author is the only member who may edit it, in any state
    // (CONTEXT.md, published entry); the composite foreign key keeps the
    // reference inside one space (ADR-0016).
    authorMemberId: uuid('author_member_id').notNull(),
    title: text('title'),
    text: text('text').notNull(),
    state: text('state').notNull().$type<(typeof entryStates)[number]>(),
    // Set once, when the draft is published; the feed orders on it.
    publishedAt: timestamp('published_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('journal_entries_space_id_id_key').on(table.spaceId, table.id),
    check('journal_entries_state_allowed', sql`${table.state} in ('draft', 'published')`),
    // A published entry carries the moment it was shared; a draft has none.
    check(
      'journal_entries_published_at_matches_state',
      sql`(${table.state} = 'published' and ${table.publishedAt} is not null)
        or (${table.state} = 'draft' and ${table.publishedAt} is null)`,
    ),
    // The shared feed pages through published entries newest first.
    index('journal_entries_feed_idx').on(table.spaceId, table.state, table.publishedAt, table.id),
    // The author's drafts list reads by author; the sync's author-or-published
    // filter combines both.
    index('journal_entries_author_idx').on(table.spaceId, table.authorMemberId),
    foreignKey({
      name: 'journal_entries_space_id_author_member_id_fk',
      columns: [table.spaceId, table.authorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type JournalEntry = typeof journalEntries.$inferSelect
