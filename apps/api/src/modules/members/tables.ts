import { sql } from 'drizzle-orm'
import { bigint, check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'
import { spaces } from '../spaces/tables.ts'

export const memberRoles = ['owner', 'regular'] as const

export const members = pgTable(
  'members',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull(),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('members_space_id_id_key').on(table.spaceId, table.id),
    check('members_role_allowed', sql`${table.role} in ('owner', 'regular')`),
  ],
)

export type Member = typeof members.$inferSelect
