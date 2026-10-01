import { bigint, boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../../platform/db/uuid.ts'

export const spaces = pgTable('spaces', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  // The space's default IANA time zone; new timed events start from it.
  timezone: text('timezone').notNull().default('UTC'),
  // Section visibility (ADR-0011): one column per section, so the section
  // gate reads a plain field. Hiding keeps the sections' data; these flags
  // only gate access and navigation.
  journalVisible: boolean('journal_visible').notNull().default(true),
  calendarVisible: boolean('calendar_visible').notNull().default(true),
  wishlistVisible: boolean('wishlist_visible').notNull().default(true),
  revision: bigint('revision', { mode: 'bigint' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export type Space = typeof spaces.$inferSelect
