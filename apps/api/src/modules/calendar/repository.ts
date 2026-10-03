import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import type { Executor, Tx } from '../../platform/db/index.ts'
import {
  type CalendarEvent,
  type CalendarEventException,
  type CalendarEventReminder,
  calendarEventExceptions,
  calendarEventReminderRecipients,
  calendarEventReminders,
  calendarEvents,
  calendarRemindersSent,
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

/*
 * The event's reminder (issue #22). Like the exceptions, it travels inside
 * its event's DTO, so the reads here are beside the event's own — one
 * reminder per event, the recipients read with it.
 */

export interface NewCalendarEventReminder {
  leadMinutes: number
  everyone: boolean
  memberIds: readonly string[]
  revision: bigint
  now: Date
  /** How far the write has just scheduled: the sweep's watermark. */
  scheduledThrough: Date
}

/**
 * The reminder's replace-one upsert (the table's unique key on the event):
 * a create and an edit are the same write, and the named recipients are
 * replaced whole — the body's list is the truth, never a delta.
 */
export async function upsertEventReminder(
  tx: Tx,
  spaceId: string,
  eventId: string,
  data: NewCalendarEventReminder,
): Promise<CalendarEventReminder> {
  const inserted = await tx
    .insert(calendarEventReminders)
    .values({
      spaceId,
      eventId,
      leadMinutes: data.leadMinutes,
      everyone: data.everyone,
      scheduledThrough: data.scheduledThrough,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .onConflictDoUpdate({
      target: [calendarEventReminders.spaceId, calendarEventReminders.eventId],
      set: {
        leadMinutes: data.leadMinutes,
        everyone: data.everyone,
        scheduledThrough: data.scheduledThrough,
        revision: data.revision,
        updatedAt: data.now,
      },
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Upserting a calendar event reminder returned no row')
  await tx
    .delete(calendarEventReminderRecipients)
    .where(
      and(
        eq(calendarEventReminderRecipients.spaceId, spaceId),
        eq(calendarEventReminderRecipients.eventId, eventId),
      ),
    )
  if (!data.everyone && data.memberIds.length > 0) {
    await tx.insert(calendarEventReminderRecipients).values(
      data.memberIds.map((memberId) => ({
        spaceId,
        eventId,
        memberId,
        createdAt: data.now,
      })),
    )
  }
  return row
}

export async function deleteEventReminder(tx: Tx, spaceId: string, eventId: string): Promise<void> {
  await tx
    .delete(calendarEventReminderRecipients)
    .where(
      and(
        eq(calendarEventReminderRecipients.spaceId, spaceId),
        eq(calendarEventReminderRecipients.eventId, eventId),
      ),
    )
  await tx
    .delete(calendarEventReminders)
    .where(
      and(eq(calendarEventReminders.spaceId, spaceId), eq(calendarEventReminders.eventId, eventId)),
    )
}

/** One event's reminder with the named recipients beside it. */
export interface EventReminderWithRecipients {
  reminder: CalendarEventReminder
  memberIds: string[]
}

/** The sweep's watermark moves in the round that filled the gap, and
 *  only forward — except when it sits implausibly far ahead: a forward
 *  clock jump poisons it, and the reset must reach the database or every
 *  round would re-queue the whole horizon until real time caught up. */
export async function advanceReminderWatermark(
  tx: Tx,
  spaceId: string,
  eventId: string,
  scheduledThrough: Date,
): Promise<void> {
  await tx
    .update(calendarEventReminders)
    .set({
      scheduledThrough: sql`case when ${calendarEventReminders.scheduledThrough} > ${scheduledThrough}::timestamptz + interval '1 day'
        then ${scheduledThrough}::timestamptz
        else greatest(${calendarEventReminders.scheduledThrough}, ${scheduledThrough}::timestamptz) end`,
    })
    .where(
      and(eq(calendarEventReminders.spaceId, spaceId), eq(calendarEventReminders.eventId, eventId)),
    )
}

export async function getReminderForEvent(
  executor: Executor,
  spaceId: string,
  eventId: string,
): Promise<EventReminderWithRecipients | undefined> {
  const rows = await executor
    .select()
    .from(calendarEventReminders)
    .where(
      and(eq(calendarEventReminders.spaceId, spaceId), eq(calendarEventReminders.eventId, eventId)),
    )
    .limit(1)
  const reminder = rows[0]
  if (reminder === undefined) return undefined
  const recipients = await executor
    .select({ memberId: calendarEventReminderRecipients.memberId })
    .from(calendarEventReminderRecipients)
    .where(
      and(
        eq(calendarEventReminderRecipients.spaceId, spaceId),
        eq(calendarEventReminderRecipients.eventId, eventId),
      ),
    )
  return { reminder, memberIds: recipients.map((row) => row.memberId) }
}

/** Many events' reminders at once — the listing's and sync's embed. */
export async function listRemindersForEvents(
  executor: Executor,
  spaceId: string,
  eventIds: readonly string[],
): Promise<Map<string, EventReminderWithRecipients>> {
  const byEvent = new Map<string, EventReminderWithRecipients>()
  if (eventIds.length === 0) return byEvent
  const reminders = await executor
    .select()
    .from(calendarEventReminders)
    .where(
      and(
        eq(calendarEventReminders.spaceId, spaceId),
        inArray(calendarEventReminders.eventId, [...eventIds]),
      ),
    )
  for (const reminder of reminders) {
    byEvent.set(reminder.eventId, { reminder, memberIds: [] })
  }
  if (byEvent.size === 0) return byEvent
  const recipients = await executor
    .select({
      eventId: calendarEventReminderRecipients.eventId,
      memberId: calendarEventReminderRecipients.memberId,
    })
    .from(calendarEventReminderRecipients)
    .where(
      and(
        eq(calendarEventReminderRecipients.spaceId, spaceId),
        inArray(calendarEventReminderRecipients.eventId, [...byEvent.keys()]),
      ),
    )
  for (const recipient of recipients) {
    byEvent.get(recipient.eventId)?.memberIds.push(recipient.memberId)
  }
  return byEvent
}

/** Every space that holds at least one reminder — the sweep's discovery,
 *  one clearly named cross-space read (the journal purge sweep's
 *  precedent); each space's work re-reads its own rows. */
export async function listSpacesWithReminderEventsAcrossSpaces(db: Executor): Promise<string[]> {
  const rows = await db
    .selectDistinct({ spaceId: calendarEventReminders.spaceId })
    .from(calendarEventReminders)
  return rows.map((row) => row.spaceId)
}

/** The space's events that carry a reminder — the sweep's per-space scan. */
export async function listReminderEventsInSpace(
  executor: Executor,
  spaceId: string,
): Promise<CalendarEvent[]> {
  return executor
    .select({ event: calendarEvents })
    .from(calendarEvents)
    .innerJoin(
      calendarEventReminders,
      and(
        eq(calendarEventReminders.spaceId, calendarEvents.spaceId),
        eq(calendarEventReminders.eventId, calendarEvents.id),
      ),
    )
    .where(eq(calendarEvents.spaceId, spaceId))
    .then((rows) => rows.map((row) => row.event))
}

/*
 * The send-once bookkeeping: the claim arms the handler's idempotency. A
 * fresh claim wins; an *unsent* claim older than the takeover window
 * belongs to a crashed sender and is taken over, so a reminder never dies
 * with a process; a claim whose reminder has gone out answers every later
 * job quiet, however late it fires (issue #22: one reminder per
 * occurrence).
 */

/** A claim younger than this belongs to a sender that may still be
 *  working; older, and the sender is presumed dead. */
export const REMINDER_CLAIM_TAKEOVER_MS = 5 * 60 * 1000

/**
 * The lease a claim hands its winner: only the run holding it may turn
 * the claim into a receipt or release it, so a stalled sender can never
 * undo a successor's work.
 */
export type ReminderClaimLease = { remindedAt: Date }

/**
 * Claims the occurrence's reminder for the start it computed: the lease
 * when this run won (it sends), undefined when a live claim stands — a
 * recent sender's lease, a finished receipt for the same start, or a
 * newer receipt for a start the creator has since moved the occurrence
 * to. The conditional upsert is the whole protocol — concurrent
 * duplicates of the same job agree on one winner without a lock.
 */
export async function claimReminder(
  tx: Tx,
  spaceId: string,
  eventId: string,
  originalDate: string,
  start: Date,
  now: Date,
): Promise<ReminderClaimLease | undefined> {
  const inserted = await tx
    .insert(calendarRemindersSent)
    .values({ spaceId, eventId, originalDate, startAt: start, remindedAt: now })
    .onConflictDoUpdate({
      target: [
        calendarRemindersSent.spaceId,
        calendarRemindersSent.eventId,
        calendarRemindersSent.originalDate,
      ],
      set: { startAt: start, remindedAt: now, sentAt: null },
      // A receipt answers only for the start it names: the same start is
      // never reminded twice, an unsent lease past the takeover window is
      // a crashed sender's and is taken over, and a *different* start —
      // the occurrence was moved — is a new reminder's to send.
      where: sql`(${calendarRemindersSent.sentAt} is not null and ${calendarRemindersSent.startAt} is distinct from ${start})
        or (${calendarRemindersSent.sentAt} is null and ${calendarRemindersSent.remindedAt} <= ${new Date(now.getTime() - REMINDER_CLAIM_TAKEOVER_MS)})`,
    })
    .returning({ remindedAt: calendarRemindersSent.remindedAt })
  const row = inserted[0]
  return row ? { remindedAt: row.remindedAt } : undefined
}

/**
 * The claim becomes the receipt, for the start and by the run the lease
 * names: every other job for the occurrence and start — the duplicates
 * the design creates on purpose — answers quiet. A run whose lease was
 * taken over writes nothing.
 */
export async function markReminderSent(
  tx: Tx,
  spaceId: string,
  eventId: string,
  originalDate: string,
  lease: ReminderClaimLease,
  now: Date,
): Promise<void> {
  await tx
    .update(calendarRemindersSent)
    .set({ sentAt: now })
    .where(
      and(
        eq(calendarRemindersSent.spaceId, spaceId),
        eq(calendarRemindersSent.eventId, eventId),
        eq(calendarRemindersSent.originalDate, originalDate),
        eq(calendarRemindersSent.remindedAt, lease.remindedAt),
        // A taken-over claim is the successor's to finish, not this run's.
        sql`${calendarRemindersSent.sentAt} is null`,
      ),
    )
}

/**
 * A run that could not deliver anywhere lets the occurrence go — but only
 * its own lease: the claim row goes so the queue's retry sends from
 * scratch, while a successor's claim stands.
 */
export async function releaseReminderClaim(
  tx: Tx,
  spaceId: string,
  eventId: string,
  originalDate: string,
  lease: ReminderClaimLease,
): Promise<void> {
  await tx
    .delete(calendarRemindersSent)
    .where(
      and(
        eq(calendarRemindersSent.spaceId, spaceId),
        eq(calendarRemindersSent.eventId, eventId),
        eq(calendarRemindersSent.originalDate, originalDate),
        eq(calendarRemindersSent.remindedAt, lease.remindedAt),
        sql`${calendarRemindersSent.sentAt} is null`,
      ),
    )
}

/** One occurrence's claim, whatever state it is in — the handler's read
 *  when a claim stands and it must know whose turn it is. */
export async function getReminderClaim(
  executor: Executor,
  spaceId: string,
  eventId: string,
  originalDate: string,
): Promise<{ sentAt: Date | null; startAt: Date } | undefined> {
  const rows = await executor
    .select({ sentAt: calendarRemindersSent.sentAt, startAt: calendarRemindersSent.startAt })
    .from(calendarRemindersSent)
    .where(
      and(
        eq(calendarRemindersSent.spaceId, spaceId),
        eq(calendarRemindersSent.eventId, eventId),
        eq(calendarRemindersSent.originalDate, originalDate),
      ),
    )
    .limit(1)
  return rows[0]
}

/** The claims no pending job can ask about any more — the sweep's prune. */
export async function deleteReminderClaimsBefore(db: Executor, cutoff: Date): Promise<void> {
  await db.delete(calendarRemindersSent).where(lt(calendarRemindersSent.remindedAt, cutoff))
}

/** One event's claims — the removal's explicit cleanup, beside the event
 *  in the same transaction. */
export async function deleteReminderClaimsForEvent(
  tx: Tx,
  spaceId: string,
  eventId: string,
): Promise<void> {
  await tx
    .delete(calendarRemindersSent)
    .where(
      and(eq(calendarRemindersSent.spaceId, spaceId), eq(calendarRemindersSent.eventId, eventId)),
    )
}
