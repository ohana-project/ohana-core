import { and, asc, desc, eq, gt } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import { type CalendarEvent, calendarEvents } from './tables.ts'

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
      revision,
      updatedAt: now,
    })
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
