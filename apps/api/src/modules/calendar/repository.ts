import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import {
  type CalendarEvent,
  type CalendarEventException,
  calendarEventExceptions,
  calendarEvents,
} from './tables.ts'

/**
 * Every query on this space-owned table takes the space as its required
 * first argument (architecture.md, "Space scoping"): there is no unscoped
 * calendar access on the normal path.
 */

export interface NewCalendarEvent {
  creatorMemberId: string
  title: string
  allDay: boolean
  /** The all-day kind's zoneless date; null for a timed event. */
  date: string | null
  /** The timed kind's moments; null for an all-day event. */
  startsAt: Date | null
  endsAt: Date | null
  /** The timed kind's IANA zone; null for an all-day event. */
  timezone: string | null
  /** The series' RFC 5545 RRULE; null for a one-time event (issue #21). */
  rrule: string | null
  revision: bigint
  now: Date
}

export async function insertEvent(
  tx: Tx,
  spaceId: string,
  data: NewCalendarEvent,
): Promise<CalendarEvent> {
  const inserted = await tx
    .insert(calendarEvents)
    .values({
      spaceId,
      creatorMemberId: data.creatorMemberId,
      title: data.title,
      allDay: data.allDay,
      date: data.date,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      timezone: data.timezone,
      rrule: data.rrule,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a calendar event returned no row')
  return row
}

export async function getEventInSpace(
  executor: Executor,
  spaceId: string,
  eventId: string,
): Promise<CalendarEvent | undefined> {
  const rows = await executor
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.spaceId, spaceId), eq(calendarEvents.id, eventId)))
    .limit(1)
  return rows[0]
}

/**
 * The creator's or owner's replace of the whole event, stamped with the
 * transaction's revision. No row means the event is not in this space —
 * the use case decides what that answers.
 */
export async function updateEvent(
  tx: Tx,
  spaceId: string,
  eventId: string,
  changes: {
    title: string
    allDay: boolean
    date: string | null
    startsAt: Date | null
    endsAt: Date | null
    timezone: string | null
    rrule: string | null
  },
  revision: bigint,
  now: Date,
): Promise<CalendarEvent | undefined> {
  const updated = await tx
    .update(calendarEvents)
    .set({
      title: changes.title,
      allDay: changes.allDay,
      date: changes.date,
      startsAt: changes.startsAt,
      endsAt: changes.endsAt,
      timezone: changes.timezone,
      rrule: changes.rrule,
      revision,
      updatedAt: now,
    })
    .where(and(eq(calendarEvents.spaceId, spaceId), eq(calendarEvents.id, eventId)))
    .returning()
  return updated[0]
}

/**
 * The revision stamp an exception's change leaves on the event row
 * (issue #21): the event is what travels to the devices, exceptions
 * inside its DTO, so the stamp — not the exception row's own bookkeeping —
 * is the delivery.
 */
export async function touchEvent(
  tx: Tx,
  spaceId: string,
  eventId: string,
  revision: bigint,
  now: Date,
): Promise<CalendarEvent | undefined> {
  const updated = await tx
    .update(calendarEvents)
    .set({ revision, updatedAt: now })
    .where(and(eq(calendarEvents.spaceId, spaceId), eq(calendarEvents.id, eventId)))
    .returning()
  return updated[0]
}

/**
 * The removal (issue #20): an event leaves for good — the calendar has no
 * trash — and the tombstone beside the delete carries it out of every
 * device's copy. The row comes back so the caller knows what it removed;
 * undefined means the event is not in this space.
 */
export async function deleteEvent(
  tx: Tx,
  spaceId: string,
  eventId: string,
): Promise<CalendarEvent | undefined> {
  const deleted = await tx
    .delete(calendarEvents)
    .where(and(eq(calendarEvents.spaceId, spaceId), eq(calendarEvents.id, eventId)))
    .returning()
  return deleted[0]
}

/**
 * The space's events, creation order — the contract the tests and the
 * OpenAPI document speak; the screens read the synchronised partition and
 * sort it by their own rules.
 */
export async function listEventsInSpace(
  executor: Executor,
  spaceId: string,
): Promise<CalendarEvent[]> {
  return executor
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.spaceId, spaceId))
    .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id))
}

/**
 * The rows changed after `since` — the sync contributor's delta (issue
 * #14). Every event travels to every member (policy.ts), so the filter is
 * the space scope and the cursor alone.
 */
export async function listChangedEvents(
  tx: Tx,
  spaceId: string,
  since: bigint,
): Promise<CalendarEvent[]> {
  return tx
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.spaceId, spaceId), gt(calendarEvents.revision, since)))
    .orderBy(desc(calendarEvents.revision), desc(calendarEvents.id))
}

/*
 * The exceptions of a repeating event (issue #21). They travel inside
 * their event's DTO, so the reads here are whole-list reads beside the
 * event's own; there is no per-exception visibility to decide (policy.ts).
 */

export interface NewCalendarEventException {
  originalDate: string
  kind: 'cancelled' | 'override'
  /** The override's replacement; null throughout for a cancellation. */
  title: string | null
  allDay: boolean | null
  date: string | null
  startsAt: Date | null
  endsAt: Date | null
  timezone: string | null
  revision: bigint
  now: Date
}

/**
 * The upsert the occurrence use cases run: one exception per original
 * date (the table's unique key), the newest write winning — an edit over
 * a cancellation revives the occurrence as an override, a cancellation
 * over an edit replaces it.
 */
export async function upsertEventException(
  tx: Tx,
  spaceId: string,
  eventId: string,
  data: NewCalendarEventException,
): Promise<CalendarEventException> {
  const inserted = await tx
    .insert(calendarEventExceptions)
    .values({
      spaceId,
      eventId,
      originalDate: data.originalDate,
      kind: data.kind,
      title: data.title,
      allDay: data.allDay,
      date: data.date,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      timezone: data.timezone,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .onConflictDoUpdate({
      target: [
        calendarEventExceptions.spaceId,
        calendarEventExceptions.eventId,
        calendarEventExceptions.originalDate,
      ],
      set: {
        kind: data.kind,
        title: data.title,
        allDay: data.allDay,
        date: data.date,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        timezone: data.timezone,
        revision: data.revision,
        updatedAt: data.now,
      },
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Upserting a calendar event exception returned no row')
  return row
}

export async function deleteEventExceptions(
  tx: Tx,
  spaceId: string,
  eventId: string,
): Promise<void> {
  await tx
    .delete(calendarEventExceptions)
    .where(
      and(
        eq(calendarEventExceptions.spaceId, spaceId),
        eq(calendarEventExceptions.eventId, eventId),
      ),
    )
}

/** The given original dates' exceptions — the series edit's pruning of
 *  the exceptions the replaced rule no longer honours (issue #21). */
export async function deleteEventExceptionsFor(
  tx: Tx,
  spaceId: string,
  eventId: string,
  originalDates: readonly string[],
): Promise<void> {
  if (originalDates.length === 0) return
  await tx
    .delete(calendarEventExceptions)
    .where(
      and(
        eq(calendarEventExceptions.spaceId, spaceId),
        eq(calendarEventExceptions.eventId, eventId),
        inArray(calendarEventExceptions.originalDate, [...originalDates]),
      ),
    )
}

/** One event's exceptions, original-date order — the single read's embed. */
export async function listExceptionsForEvent(
  executor: Executor,
  spaceId: string,
  eventId: string,
): Promise<CalendarEventException[]> {
  return executor
    .select()
    .from(calendarEventExceptions)
    .where(
      and(
        eq(calendarEventExceptions.spaceId, spaceId),
        eq(calendarEventExceptions.eventId, eventId),
      ),
    )
    .orderBy(asc(calendarEventExceptions.originalDate))
}

/** Many events' exceptions at once — the listing's and sync's embed. */
export async function listExceptionsForEvents(
  executor: Executor,
  spaceId: string,
  eventIds: readonly string[],
): Promise<CalendarEventException[]> {
  if (eventIds.length === 0) return []
  return executor
    .select()
    .from(calendarEventExceptions)
    .where(
      and(
        eq(calendarEventExceptions.spaceId, spaceId),
        inArray(calendarEventExceptions.eventId, [...eventIds]),
      ),
    )
    .orderBy(asc(calendarEventExceptions.eventId), asc(calendarEventExceptions.originalDate))
}
