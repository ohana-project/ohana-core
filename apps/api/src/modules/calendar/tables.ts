import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
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
import { members } from '../members/tables.ts'
import { spaces } from '../spaces/tables.ts'

/**
 * The reminder lead's bound (issue #22): from one minute to thirty days
 * before an occurrence. The database enforces the range beside the
 * contract; the constant is the one definition of "thirty days" both
 * spell.
 */
export const REMINDER_LEAD_MAX_MINUTES = 43_200

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
    // a check would end the migration's statement, and brace quantifiers
    // never survive the migration generator.)
    check(
      'calendar_events_rrule_shape',
      sql`(${table.rrule} is null or ${table.rrule} ~ ('^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)((' || chr(59) || ')UNTIL=[0-9]+(T[0-9]+Z)?)?$'))`,
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

/**
 * An event's reminder (issue #22): the one reminder an event carries — a
 * lead time before the occurrence and the recipients the creator chose,
 * either everyone (evaluated at send time, so members who join later are
 * in and leavers are out) or a named list. The row travels inside its
 * event's DTO — the exceptions' precedent: a change stamps the event row,
 * and that stamp is the delivery. Absent row, no reminder.
 */
export const calendarEventReminders = pgTable(
  'calendar_event_reminders',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    /** How many minutes before the occurrence the reminder is due. */
    leadMinutes: integer('lead_minutes').notNull(),
    /**
     * How far the per-occurrence jobs have been scheduled: the sweep's
     * watermark (issue #22). A round missed for any reason fills exactly
     * the gap between this and the horizon, and a create or edit — which
     * schedules the whole span itself — sets it to that horizon.
     */
    scheduledThrough: timestamp('scheduled_through', { withTimezone: true }),
    /**
     * Everyone in the space, read when the reminder sends. The named
     * alternative stands in the recipients table below.
     */
    everyone: boolean('everyone').notNull(),
    // The convention's bookkeeping, read by nothing — the delivery is the
    // parent event's stamp (the media module's precedent).
    revision: bigint('revision', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('calendar_event_reminders_space_id_id_key').on(table.spaceId, table.id),
    // One reminder per event (ADR-0006: version 1.0 has one configurable
    // reminder per event) — a second write is the replace, never a second
    // row.
    unique('calendar_event_reminders_event_key').on(table.spaceId, table.eventId),
    check(
      'calendar_event_reminders_lead_range',
      // sql.raw so the migration generator inlines the bound instead of
      // emitting a $1 placeholder no raw-SQL migration run can bind.
      sql`${table.leadMinutes} between 1 and ${sql.raw(String(REMINDER_LEAD_MAX_MINUTES))}`,
    ),
    foreignKey({
      name: 'calendar_event_reminders_space_id_event_id_fk',
      columns: [table.spaceId, table.eventId],
      foreignColumns: [calendarEvents.spaceId, calendarEvents.id],
    }),
  ],
)

export type CalendarEventReminder = typeof calendarEventReminders.$inferSelect

/**
 * The named recipients of an event's reminder (issue #22): the members the
 * creator picked one by one. Written only when the reminder is not for
 * everyone; the composite foreign keys keep every reference inside the
 * space (ADR-0016). A recipient the space later loses is filtered when the
 * reminder sends — the send-time evaluation, not this list, is the truth.
 */
export const calendarEventReminderRecipients = pgTable(
  'calendar_event_reminder_recipients',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('calendar_event_reminder_recipients_recipient_key').on(
      table.spaceId,
      table.eventId,
      table.memberId,
    ),
    foreignKey({
      name: 'calendar_event_reminder_recipients_space_id_event_id_fk',
      columns: [table.spaceId, table.eventId],
      foreignColumns: [calendarEvents.spaceId, calendarEvents.id],
    }),
    foreignKey({
      name: 'calendar_event_reminder_recipients_space_id_member_id_fk',
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }),
  ],
)

export type CalendarEventReminderRecipient = typeof calendarEventReminderRecipients.$inferSelect

/**
 * The send-once bookkeeping (issue #22): the occurrences a reminder has
 * already been claimed for. Not a synchronised table — the devices never
 * read it — and not a delivery record: the claim arms the handler's
 * idempotency, so a redelivered or duplicated job sends nothing, while a
 * crashed sender may take a stale claim over. The rows die with their
 * event, and the sweep prunes what no job can ask about any more.
 */
export const calendarRemindersSent = pgTable(
  'calendar_reminders_sent',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    /** The occurrence the reminder belonged to, by its original date. */
    originalDate: date('original_date', { mode: 'string' }).notNull(),
    /** When a run claimed the occurrence; the idempotency's lease. */
    remindedAt: timestamp('reminded_at', { withTimezone: true }).notNull(),
    /**
     * The occurrence's start the receipt answers for: a reminder that went
     * out for the 18:00 start is not one for the 20:00 the creator moved
     * it to — that one goes out too (issue #22).
     */
    startAt: timestamp('start_at', { withTimezone: true }),
    /**
     * When the reminder actually went out. Null, the claim is a live
     * sender's lease — or a crashed one's, after the takeover window — and
     * the reminder may still be sent; set, every other job for the
     * occurrence answers quiet, however late it fires.
     */
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    unique('calendar_reminders_sent_occurrence_key').on(
      table.spaceId,
      table.eventId,
      table.originalDate,
    ),
    index('calendar_reminders_sent_reminded_idx').on(table.remindedAt),
    foreignKey({
      name: 'calendar_reminders_sent_space_id_event_id_fk',
      columns: [table.spaceId, table.eventId],
      foreignColumns: [calendarEvents.spaceId, calendarEvents.id],
    }),
  ],
)

export type CalendarReminderSent = typeof calendarRemindersSent.$inferSelect
