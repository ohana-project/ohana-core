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
 * A wish (issue #18, CONTEXT.md): something a member would like for
 * themselves, recorded in their wishlist and visible to the whole space.
 * The details and the link are optional; the link is an http(s) URL when
 * present — the contracts refuse everything else at the door, and the
 * check keeps a hand-written UPDATE from storing anything else. A wish is
 * open until its author marks it received; `received_at` carries that
 * moment, and null means open.
 */
export const wishes = pgTable(
  'wishes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // The wish's author is the only member who may edit, remove, or mark it
    // received (issue #18); the composite foreign key keeps the reference
    // inside one space (ADR-0016).
    authorMemberId: uuid('author_member_id').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    link: text('link'),
    // Set when the author marks the wish received; null while it is open.
    receivedAt: timestamp('received_at', { withTimezone: true }),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('wishes_space_id_id_key').on(table.spaceId, table.id),
    check(
      'wishes_link_is_http_url',
      sql`${table.link} is null or ${table.link} ~ '^https?://[^[:space:]]+$'`,
    ),
    // The per-member wishlist reads by author; the space-wide browse reads
    // every author's wishes in creation order.
    index('wishes_author_idx').on(table.spaceId, table.authorMemberId, table.createdAt),
    // The sync contributor's delta scans one space's rows past a revision.
    index('wishes_sync_idx').on(table.spaceId, table.revision),
    foreignKey({
      name: 'wishes_space_id_author_member_id_fk',
      columns: [table.spaceId, table.authorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type Wish = typeof wishes.$inferSelect
