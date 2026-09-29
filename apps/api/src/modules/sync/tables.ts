import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'
import { members } from '../members/tables.ts'
import { spaces } from '../spaces/tables.ts'

export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    audience: text('audience').notNull(),
    memberId: uuid('member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sync_tombstones_space_revision_idx').on(table.spaceId, table.revision),
    foreignKey({
      name: 'sync_tombstones_member_space_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
    check('sync_tombstones_audience_allowed', sql`${table.audience} in ('all', 'member')`),
    check(
      'sync_tombstones_audience_member_consistent',
      sql`(${table.audience} = 'all' and ${table.memberId} is null) or (${table.audience} = 'member' and ${table.memberId} is not null)`,
    ),
  ],
)

export type SyncTombstone = typeof syncTombstones.$inferSelect
