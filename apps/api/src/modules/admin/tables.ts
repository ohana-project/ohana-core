import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'

/**
 * The instance administrator (ADR-0005). Not a space-owned table: there is
 * exactly one row per installation, which the `singleton` unique index and
 * its CHECK enforce, so concurrent first starts cannot create two
 * administrators.
 */
export const administrators = pgTable(
  'administrators',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    singleton: boolean('singleton').notNull().default(true),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('administrators_singleton_key').on(table.singleton),
    check('administrators_singleton_true', sql`${table.singleton}`),
  ],
)

/**
 * Administrative sessions, one per signed-in device. Only the SHA-256 hash
 * of the cookie token is stored. Sessions are installation-wide and are
 * separate from member sessions (ADR-0005).
 */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    administratorId: uuid('administrator_id')
      .notNull()
      .references(() => administrators.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('admin_sessions_token_hash_key').on(table.tokenHash),
    index('admin_sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export type Administrator = typeof administrators.$inferSelect
export type AdminSession = typeof adminSessions.$inferSelect
