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
 * The states a journal entry takes (ADR-0007): a new entry starts as a draft
 * only its author sees, publishing moves it to the space's shared feed, and
 * removal moves it to trash — recoverable until its permanent deletion. A
 * published entry never returns to draft (CONTEXT.md, draft); restore
 * returns the entry to the state it was trashed from.
 */
export const entryStates = ['draft', 'published', 'trashed'] as const

export const trashedFromStates = ['draft', 'published'] as const

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
    // The state the entry was trashed from — set when it is trashed, cleared
    // when it is restored. Null while the entry is not trashed.
    trashedFromState: text('trashed_from_state').$type<(typeof trashedFromStates)[number]>(),
    // Set once, when the draft is published; the feed orders on it. A trashed
    // entry keeps it — restore returns the entry as it was, published moment
    // included.
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // Set when the entry is trashed; the retention clock and the trash list
    // order on it. Null while the entry is not trashed.
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('journal_entries_space_id_id_key').on(table.spaceId, table.id),
    check(
      'journal_entries_state_allowed',
      sql`${table.state} in ('draft', 'published', 'trashed')`,
    ),
    check(
      'journal_entries_trashed_from_state_allowed',
      sql`${table.trashedFromState} in ('draft', 'published')`,
    ),
    // A published entry carries the moment it was shared; a draft has none.
    // A trashed entry matches the state it came from.
    check(
      'journal_entries_published_at_matches_state',
      sql`(${table.state} = 'published' and ${table.publishedAt} is not null)
        or (${table.state} = 'draft' and ${table.publishedAt} is null)
        or (${table.state} = 'trashed'
            and ${table.trashedFromState} is not null
            and ${table.trashedAt} is not null
            and ((${table.trashedFromState} = 'published' and ${table.publishedAt} is not null)
              or (${table.trashedFromState} = 'draft' and ${table.publishedAt} is null)))`,
    ),
    // The trash columns exist exactly when the state says so.
    check(
      'journal_entries_trash_columns_match_state',
      sql`(${table.state} = 'trashed') = (${table.trashedAt} is not null)
        and (${table.state} = 'trashed') = (${table.trashedFromState} is not null)`,
    ),
    // The shared feed pages through published entries newest first.
    index('journal_entries_feed_idx').on(table.spaceId, table.state, table.publishedAt, table.id),
    // The author's drafts list reads by author; the sync's author-or-published
    // filter combines both.
    index('journal_entries_author_idx').on(table.spaceId, table.authorMemberId),
    // The sync contributor's delta scans one space's rows past a revision.
    index('journal_entries_sync_idx').on(table.spaceId, table.revision),
    // The trash list reads one space's trashed rows, newest removal first.
    index('journal_entries_trash_idx').on(table.spaceId, table.state, table.trashedAt),
    // The purge job's sweep asks across spaces for rows whose retention has
    // run out — a clearly named maintenance query (architecture.md, "Space
    // scoping"), the access module's *AcrossSpaces precedent.
    index('journal_entries_purge_idx').on(table.state, table.trashedAt),
    foreignKey({
      name: 'journal_entries_space_id_author_member_id_fk',
      columns: [table.spaceId, table.authorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type JournalEntry = typeof journalEntries.$inferSelect
