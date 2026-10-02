import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
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
 * A calendar event (issue #20, CONTEXT.md): a planned activity or
 * significant date shared in the space's calendar and visible to every
 * member. The event is one of two kinds, and the columns keep them apart:
 *
 * - **All-day** — a calendar date and no time at all. The date is a
 *   zoneless `date` column, so a birthday stays on its day whatever zone a
 *   device reads it from.
 * - **Timed** — absolute start and end instants (timestamptz) plus the
 *   IANA zone the event keeps, taken from the space's zone when the
 *   creator names none. The instants fix the moment; the zone remembers
 *   where the wall time came from, which is the indication the screens
 *   show beside the device's local time and what a recurrence (issue #21)
 *   will need to expand the series.
 *
 * The creator is the member who can edit and delete the event — owners
 * moderate beside them, the journal's model (issue #16); the composite
 * foreign keys keep every reference inside one space (ADR-0016).
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    creatorMemberId: uuid('creator_member_id').notNull(),
    title: text('title').notNull(),
    allDay: boolean('all_day').notNull(),
    // The all-day kind's zoneless calendar date; null for a timed event.
    date: date('date', { mode: 'string' }),
    // The timed kind's absolute moments; null for an all-day event.
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // The timed kind's IANA zone; null for an all-day event.
    timezone: text('timezone'),
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('calendar_events_space_id_id_key').on(table.spaceId, table.id),
    // The kinds are total: the date exists exactly when the event is
    // all-day, the moments exactly when it is timed, and a timed event ends
    // after it starts.
    check(
      'calendar_events_all_day_columns_match',
      sql`(${table.allDay} = (${table.date} is not null))
        and (${table.allDay} = (${table.startsAt} is null))
        and (${table.allDay} = (${table.timezone} is null))`,
    ),
    check(
      'calendar_events_timed_end_after_start',
      sql`${table.allDay} or (${table.endsAt} is not null and ${table.startsAt} is not null and ${table.endsAt} > ${table.startsAt})`,
    ),
    // The month and agenda screens read the whole space's events in one
    // listing; this index is also the sync contributor's delta scan.
    index('calendar_events_sync_idx').on(table.spaceId, table.revision),
    foreignKey({
      name: 'calendar_events_space_id_creator_member_id_fk',
      columns: [table.spaceId, table.creatorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type CalendarEvent = typeof calendarEvents.$inferSelect
