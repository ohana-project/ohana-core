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
    /**
     * The series' RFC 5545 RRULE, narrowed to the frequencies a family
     * calendar needs (issue #21): FREQ of DAILY, WEEKLY, MONTHLY, or
     * YEARLY, optionally UNTIL — the date form for an all-day event, the
     * end of the until date in the event's zone for a timed one. Null, the
     * event happens once. The column is read only through the recurrence
     * module's strict parse (recurrence.ts), so a rule the engine cannot
     * expand cannot reach the reads.
     */
    rrule: text('rrule'),
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
    // The stored rule is the module's own subset: one of the four
    // frequencies, optionally bounded by UNTIL in the date form an all-day
    // event keeps or the UTC date-time form a timed one keeps. (The digit
    // runs are spelled loosely here — the data guard's business is the
    // shape, the strict parse in recurrence.ts counts the digits. The
    // rule's own separator is spelled chr(59): a literal semicolon inside
    // a check would end the migration's statement.)
    check(
      'calendar_events_rrule_shape',
      sql`(${table.rrule} is null or ${table.rrule} ~ ('^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$|^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(' || chr(59) || 'UNTIL=[0-9]+(T[0-9]+Z)?)?$'))`,
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

/**
 * An exception of a repeating event (issue #21): one original occurrence
 * date changed or cancelled on its own, while the series went on. The
 * original date is the occurrence's wall date in the series' own frame —
 * the event's zone for a timed event, the zoneless calendar for an
 * all-day one — because that is the date the member points at and the
 * expansion iterates. A `cancelled` exception removes the occurrence; an
 * `override` replaces it whole (its own kind, title, and moments — a
 * single-date event, the series' pattern does not apply to it).
 *
 * The rows travel inside their event's DTO — the media module's precedent:
 * a change stamps the event row with a fresh revision (the service's
 * touch), and that stamp is the delivery. No tombstones of their own: when
 * the event goes, its exceptions cascade with it.
 */
export const calendarEventExceptions = pgTable(
  'calendar_event_exceptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    /** The original occurrence's wall date in the series' own frame. */
    originalDate: date('original_date', { mode: 'string' }).notNull(),
    /** Either the occurrence is cancelled, or it is replaced whole. */
    kind: text('kind').notNull().$type<'cancelled' | 'override'>(),
    // The override's replacement, composed like an event of its own; null
    // throughout for a cancellation.
    title: text('title'),
    allDay: boolean('all_day'),
    date: date('date', { mode: 'string' }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    timezone: text('timezone'),
    // The convention's bookkeeping, read by nothing — the delivery is the
    // parent event's stamp (the media module's precedent).
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('calendar_event_exceptions_space_id_id_key').on(table.spaceId, table.id),
    // One exception per original date: a second write is the upsert, never
    // a second row.
    unique('calendar_event_exceptions_date_key').on(
      table.spaceId,
      table.eventId,
      table.originalDate,
    ),
    // The kinds are total here too: a cancellation carries no replacement,
    // an override is an event of its own kind — its date or moments exist
    // exactly as its all-day flag asks, and a timed replacement ends after
    // it starts.
    check(
      'calendar_event_exceptions_kind_columns_match',
      sql`(${table.kind} = 'cancelled' and ${table.title} is null and ${table.allDay} is null
            and ${table.date} is null and ${table.startsAt} is null
            and ${table.endsAt} is null and ${table.timezone} is null)
        or (${table.kind} = 'override' and ${table.title} is not null and ${table.allDay} is not null
            and (${table.allDay} = (${table.date} is not null))
            and (${table.allDay} = (${table.startsAt} is null))
            and (${table.allDay} = (${table.timezone} is null))
            and (${table.allDay} or (${table.endsAt} is not null and ${table.startsAt} is not null and ${table.endsAt} > ${table.startsAt})))`,
    ),
    // The event's exceptions read whole, beside the event; this index is
    // also the space-wide scan the listing and the sync embed walk.
    index('calendar_event_exceptions_event_idx').on(table.spaceId, table.eventId),
    // The event's removal takes its exceptions with it — explicitly, in
    // the same transaction (the wishlist's model; the composite foreign
    // keys of ADR-0016 carry no cascade of their own).
    foreignKey({
      name: 'calendar_event_exceptions_space_id_event_id_fk',
      columns: [table.spaceId, table.eventId],
      foreignColumns: [calendarEvents.spaceId, calendarEvents.id],
    }),
  ],
)

export type CalendarEventException = typeof calendarEventExceptions.$inferSelect
