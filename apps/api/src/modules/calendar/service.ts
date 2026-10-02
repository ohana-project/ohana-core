import type { Clock } from '../../platform/clock.ts'
import type { Db, Tx } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import { wallTimeToInstant } from '../../platform/timezone.ts'
import { assertTimezone, requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import {
  CALENDAR_EVENT_SYNC_ENTITY,
  type CreateEventBody,
  type OccurrenceBody,
  type RecurrenceDto,
  type TimedEventBody,
} from './contracts.ts'
import { assertEventEditableBy } from './policy.ts'
import {
  composeRrule,
  isOccurrenceDate,
  type Recurrence,
  seriesRecurrence,
  seriesStartDate,
} from './recurrence.ts'
import {
  deleteEvent,
  deleteEventExceptions,
  deleteEventExceptionsFor,
  getEventInSpace,
  insertEvent,
  listChangedEvents,
  listEventsInSpace,
  listExceptionsForEvent,
  listExceptionsForEvents,
  touchEvent,
  updateEvent,
  upsertEventException,
} from './repository.ts'
import type { CalendarEvent, CalendarEventException } from './tables.ts'

export interface CalendarDeps {
  db: Db
  clock: Clock
}

/**
 * The member a calendar use case runs for: the space always comes from the
 * authenticated actor (architecture.md, request lifecycle). The routes pass
 * the access module's MemberActor, which satisfies this structurally — the
 * role rides along for the owner's moderation rights over any event
 * (issue #20).
 */
export interface CalendarActor {
  memberId: string
  spaceId: string
  role: 'owner' | 'regular'
}

/**
 * An event and the exceptions it carries (issue #21): what the reads and
 * the sync contributor project onto the wire together — the exceptions
 * travel inside the event's DTO, so one row is all a device needs to
 * expand the series, offline included.
 */
export interface CalendarEventWithExceptions {
  event: CalendarEvent
  exceptions: CalendarEventException[]
}

/**
 * Adds an event to the space's calendar (issue #1, story 61): visible
 * to every member from the moment it lands. The timed kind's wall time is
 * composed into absolute instants against the zone the creator picked —
 * or the space's zone when they named none (issue #1, story 64) — inside the
 * transaction, after the section recheck has taken the space row lock and
 * handed back the space row that names that default zone. A hide that
 * commits alongside the write is still honoured, and the revision advances
 * with the row in one transaction. The recurrence the body names (issue
 * #21) is composed into the stored RRULE here; the until date must not sit
 * before the series' first occurrence.
 */
export async function createEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  input: CreateEventBody,
): Promise<CalendarEventWithExceptions> {
  const now = deps.clock.now()
  let created: CalendarEvent | undefined
  await deps.db.transaction(async (tx) => {
    const space = await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    assertValidRecurrence(input.recurrence, input.date)
    const columns = eventColumns(input, space.timezone)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          created = await insertEvent(writeTx, actor.spaceId, {
            creatorMemberId: actor.memberId,
            title: input.title.trim(),
            ...columns,
            revision,
            now,
          })
        },
      },
      now,
    )
  })
  if (created === undefined) throw new Error('Creating a calendar event produced no row')
  return { event: created, exceptions: [] }
}

/**
 * One event whole, exceptions included: every member of the space may read
 * it, so the only refusal is a 404 for an event that does not exist here
 * (architecture.md, "Errors").
 */
export async function getEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
): Promise<CalendarEventWithExceptions> {
  const event = await getEventInSpace(deps.db, actor.spaceId, eventId)
  if (event === undefined) {
    throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
  }
  return { event, exceptions: await listExceptionsForEvent(deps.db, actor.spaceId, eventId) }
}

/** The space's events — the HTTP contract the tests and the document speak. */
export async function listEvents(
  deps: CalendarDeps,
  actor: CalendarActor,
): Promise<CalendarEventWithExceptions[]> {
  const events = await listEventsInSpace(deps.db, actor.spaceId)
  return groupExceptions(
    events,
    await listExceptionsForEvents(
      deps.db,
      actor.spaceId,
      events.map((event) => event.id),
    ),
  )
}

/** The events and their exceptions, grouped once — the reads' and the
 *  sync contributor's shared shape. */
function groupExceptions(
  events: CalendarEvent[],
  exceptions: readonly CalendarEventException[],
): CalendarEventWithExceptions[] {
  const byEvent = new Map<string, CalendarEventException[]>()
  for (const exception of exceptions) {
    const group = byEvent.get(exception.eventId)
    if (group === undefined) byEvent.set(exception.eventId, [exception])
    else group.push(exception)
  }
  return events.map((event) => ({ event, exceptions: byEvent.get(event.id) ?? [] }))
}

/**
 * The creator's or owner's edit of the whole series (issue #21; a
 * one-time event's edit is the same replace), a replace of the whole
 * event: the kind can change, an all-day event becoming timed and back,
 * the recurrence named or dropped. Dropping it makes the event one-time —
 * a whole replace, never "keep the old rule" — and its exceptions then
 * cancel or replace occurrences that no longer exist, so they go with it.
 * A series that stays a series keeps only the exceptions it can still
 * honour: an exception is keyed by an original occurrence date, and one
 * the new rule no longer produces is deleted with the replace — it would
 * otherwise sit inert and could resurrect if a later edit moved the
 * pattern back over it. The event is read after the space lock, so
 * the permission decision is never made from a half-done change; the wall
 * time composes against the requested zone, or the space's current one
 * when none is named — the same default the creation applies.
 */
export async function editEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
  input: CreateEventBody,
): Promise<CalendarEventWithExceptions> {
  const now = deps.clock.now()
  let result: CalendarEventWithExceptions | undefined
  await deps.db.transaction(async (tx) => {
    const space = await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    const existing = await requireEventInSpace(tx, actor, eventId)
    assertEventEditableBy(existing.event, actor)
    assertValidRecurrence(input.recurrence, input.date)
    const columns = eventColumns(input, space.timezone)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          const row = await updateEvent(
            writeTx,
            actor.spaceId,
            eventId,
            { title: input.title.trim(), ...columns },
            revision,
            now,
          )
          if (row === undefined) {
            // The defensive backstop: the row was read under the same space
            // row lock, so it cannot vanish before the UPDATE — and a
            // refusal here spends no revision.
            throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
          }
          // The exceptions as the lock-handed read holds them: no writer
          // can have slipped in beside this transaction.
          const exceptions = existing.exceptions
          // The series stopped being one: its exceptions have no
          // occurrences left to describe. It stayed one: the exceptions it
          // can no longer honour — original dates the new rule never
          // produces — go with the replace, the rest keep their anchors.
          const stale = columns.rrule === null ? exceptions : staleExceptions(row, exceptions)
          if (stale.length > 0) {
            await deleteEventExceptionsFor(
              writeTx,
              actor.spaceId,
              eventId,
              stale.map((exception) => exception.originalDate),
            )
          }
          const staleDates = new Set(stale.map((exception) => exception.originalDate))
          result = {
            event: row,
            exceptions: exceptions.filter((exception) => !staleDates.has(exception.originalDate)),
          }
        },
      },
      now,
    )
  })
  if (result === undefined) throw new Error('Editing a calendar event produced no row')
  return result
}

/** The exceptions a replaced rule can no longer honour: the ones whose
 *  original date the new series never produces. */
function staleExceptions(
  row: CalendarEvent,
  exceptions: readonly CalendarEventException[],
): CalendarEventException[] {
  const recurrence = seriesRecurrence(row)
  const firstDate = seriesStartDate(row)
  if (firstDate === undefined || recurrence === undefined) return [...exceptions]
  return exceptions.filter(
    (exception) => !isOccurrenceDate(firstDate, recurrence, exception.originalDate),
  )
}

/**
 * One occurrence's replacement (issue #1, story 66): the original date
 * keeps the series from owning it any more, and an event of its own stands
 * there instead — its own kind, title, and moments, composed like any
 * event's. The exception rides inside the event's DTO; the event row is
 * stamped, and that stamp is the delivery to every device.
 */
export async function editOccurrence(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
  originalDate: string,
  input: OccurrenceBody,
): Promise<CalendarEventWithExceptions> {
  const now = deps.clock.now()
  let result: CalendarEventWithExceptions | undefined
  await deps.db.transaction(async (tx) => {
    const space = await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    const existing = await requireEventInSpace(tx, actor, eventId)
    assertEventEditableBy(existing.event, actor)
    requireSeriesOccurrence(existing.event, originalDate)
    const columns = eventColumns(input, space.timezone)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          await upsertEventException(writeTx, actor.spaceId, eventId, {
            originalDate,
            kind: 'override',
            title: input.title.trim(),
            ...columns,
            revision,
            now,
          })
          const row = await touchAfter(writeTx, actor, eventId, revision, now)
          result = {
            event: row,
            exceptions: await listExceptionsForEvent(writeTx, actor.spaceId, eventId),
          }
        },
      },
      now,
    )
  })
  if (result === undefined) throw new Error('Editing a calendar occurrence produced no row')
  return result
}

/**
 * One occurrence cancelled (issue #1, story 66): the series skips that
 * date. The exception rides inside the event's DTO; the event row is
 * stamped, and that stamp is the delivery to every device.
 */
export async function cancelOccurrence(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
  originalDate: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    const existing = await requireEventInSpace(tx, actor, eventId)
    assertEventEditableBy(existing.event, actor)
    requireSeriesOccurrence(existing.event, originalDate)
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx, revision) => {
          await upsertEventException(writeTx, actor.spaceId, eventId, {
            originalDate,
            kind: 'cancelled',
            title: null,
            allDay: null,
            date: null,
            startsAt: null,
            endsAt: null,
            timezone: null,
            revision,
            now,
          })
          await touchAfter(writeTx, actor, eventId, revision, now)
        },
      },
      now,
    )
  })
}

/**
 * The removal (issue #20): the creator's or an owner's, following the
 * journal's moderation model. The calendar has no trash, so the delete
 * writes the tombstone that carries the event out of every device's copy,
 * audience everyone — the event was every member's to see, and every
 * member that saw it must see it go. The exceptions go with the event
 * explicitly (the wishlist's model: the composite foreign keys carry no
 * cascade of their own).
 */
export async function removeEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    const existing = await requireEventInSpace(tx, actor, eventId)
    assertEventEditableBy(existing.event, actor)
    const tombstone: TombstoneInput = {
      entity: CALENDAR_EVENT_SYNC_ENTITY,
      entityId: existing.event.id,
      audience: { kind: 'all' },
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx) => {
          await deleteEventExceptions(writeTx, actor.spaceId, eventId)
          const row = await deleteEvent(writeTx, actor.spaceId, eventId)
          if (row === undefined) {
            // The defensive backstop, like the edit's: unreachable under
            // the space row lock, and revision-free even then.
            throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
          }
        },
        tombstones: [tombstone],
      },
      now,
    )
  })
}

/** The sync contributor's delta: the events changed since the cursor. */
export async function listChangedEventsFor(
  tx: Tx,
  actor: { memberId: string; spaceId: string },
  since: bigint,
): Promise<CalendarEventWithExceptions[]> {
  const events = await listChangedEvents(tx, actor.spaceId, since)
  return groupExceptions(
    events,
    await listExceptionsForEvents(
      tx,
      actor.spaceId,
      events.map((event) => event.id),
    ),
  )
}

async function requireEventInSpace(
  executor: Parameters<typeof getEventInSpace>[0],
  actor: CalendarActor,
  eventId: string,
): Promise<CalendarEventWithExceptions> {
  const event = await getEventInSpace(executor, actor.spaceId, eventId)
  if (event === undefined) {
    throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
  }
  return { event, exceptions: await listExceptionsForEvent(executor, actor.spaceId, eventId) }
}

/**
 * The occurrence routes answer only where the series actually has an
 * occurrence: the event must repeat, and the original date named must be
 * one of its dates (issue #21's acceptance criteria — exceptions are
 * stored per original occurrence date). Anything else is a date the
 * member cannot point at: a 404, like an event that is not there.
 */
function requireSeriesOccurrence(event: CalendarEvent, originalDate: string): Recurrence {
  const recurrence = seriesRecurrence(event)
  if (recurrence === undefined) {
    throw new DomainError(
      'event_not_recurring',
      `Calendar event ${event.id} does not repeat, so it has no occurrences to change`,
      400,
    )
  }
  // The original date is a date like any other the service stores: a
  // malformed or out-of-range one is a validation answer (an unbounded
  // daily series would otherwise take exceptions in any year at all).
  assertRealDate(originalDate)
  const firstDate = seriesStartDate(event)
  if (firstDate === undefined || !isOccurrenceDate(firstDate, recurrence, originalDate)) {
    throw notFound(
      'occurrence_not_found',
      `Calendar event ${event.id} has no occurrence on ${originalDate}`,
    )
  }
  return recurrence
}

/** The revision stamp the exception's change leaves on the event row. */
async function touchAfter(
  writeTx: Tx,
  actor: CalendarActor,
  eventId: string,
  revision: bigint,
  now: Date,
): Promise<CalendarEvent> {
  const row = await touchEvent(writeTx, actor.spaceId, eventId, revision, now)
  if (row === undefined) {
    // The defensive backstop: the row was read under the same space row
    // lock, so it cannot vanish before the stamp — and a refusal here
    // spends no revision.
    throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
  }
  return row
}

/** The row columns a create-or-edit body stands for. */
function eventColumns(
  input: CreateEventBody | OccurrenceBody,
  spaceTimezone: string,
): {
  allDay: boolean
  date: string | null
  startsAt: Date | null
  endsAt: Date | null
  timezone: string | null
  rrule: string | null
} {
  // An occurrence's body names no recurrence: a single date has no rule
  // of its own (issue #21).
  const recurrence = 'recurrence' in input ? input.recurrence : undefined
  if (input.allDay) {
    assertRealDate(input.date)
    return {
      allDay: true,
      date: input.date,
      startsAt: null,
      endsAt: null,
      timezone: null,
      rrule: composeSeriesRule(recurrence, { allDay: true }),
    }
  }
  return timedEventColumns(input, recurrence, spaceTimezone)
}

/** The stored rule the body's recurrence composes into, if it names one. */
function composeSeriesRule(
  recurrence: RecurrenceDto | undefined,
  kind: { allDay: boolean; timezone?: string },
): string | null {
  return recurrence === undefined ? null : composeRrule(recurrence, kind)
}

function timedEventColumns(
  input: TimedEventBody,
  recurrence: RecurrenceDto | undefined,
  spaceTimezone: string,
): {
  allDay: false
  date: null
  startsAt: Date
  endsAt: Date
  timezone: string
  rrule: string | null
} {
  assertRealDate(input.date)
  // The space's zone is the default (issue #1, story 64); a named zone must be one
  // the runtime knows, spelled canonically like the space's own.
  const timezone = input.timezone === undefined ? spaceTimezone : assertTimezone(input.timezone)
  // The wall pair is judged on the wall itself: an end that is not after
  // the start would store a non-event — refused, not silently rolled to
  // the next day.
  if (input.endTime <= input.startTime) {
    throw new DomainError(
      'event_end_before_start',
      'A timed event’s end must be after its start',
      400,
    )
  }
  const startsAt = wallTimeToInstant(input.date, input.startTime, timezone)
  const endsAt = wallTimeToInstant(input.date, input.endTime, timezone)
  if (endsAt.getTime() <= startsAt.getTime()) {
    // The wall order held but the instants inverted: the spring-forward
    // gap swallowed the whole interval. A longer event over the same
    // nonexistent start is kept from the gap's far side — the shift the
    // composition documents — but one that does not survive it would
    // store less than the member asked for, and is refused instead.
    throw new DomainError(
      'event_start_in_gap',
      `A timed event’s start does not exist on ${input.date} and the clocks’ jump swallows the whole interval`,
      400,
    )
  }
  return {
    allDay: false,
    date: null,
    startsAt,
    endsAt,
    timezone,
    rrule: composeSeriesRule(recurrence, { allDay: false, timezone }),
  }
}

/**
 * The until date is the last day an occurrence may fall on; before the
 * series' first occurrence there is no series left at all — refused, not
 * silently empty (issue #21).
 */
function assertValidRecurrence(recurrence: RecurrenceDto | undefined, firstDate: string): void {
  if (recurrence?.until === undefined) return
  assertRealDate(recurrence.until)
  if (recurrence.until < firstDate) {
    throw new DomainError(
      'invalid_recurrence_until',
      `A series’ end date (${recurrence.until}) cannot sit before its first occurrence (${firstDate})`,
      400,
    )
  }
}

/**
 * The schema's pattern admits `2026-02-30`; this refuses it, and every
 * other string the calendar format cannot name, so an impossible date is a
 * validation answer instead of a database error (the `date` column would
 * refuse it with a 500). The round-trip is the test: the runtime rolls an
 * over-range day forward instead of refusing it, so the parsed moment must
 * read back as the very date it was given. The year is bounded to what a
 * family plans in — outside it the runtime's two-digit year readings turn
 * `0026` into `1926`, and a half-typed year is a refusal, not a garbage
 * instant two millennia from the intended day.
 */
const MIN_EVENT_YEAR = 1900
const MAX_EVENT_YEAR = 2200

function assertRealDate(date: string): void {
  const parsed = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new DomainError('invalid_event_date', `“${date}” is not a calendar date`, 400)
  }
  const year = Number(date.slice(0, 4))
  if (year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR) {
    throw new DomainError(
      'invalid_event_date',
      `“${date}” is outside the supported range ${MIN_EVENT_YEAR}–${MAX_EVENT_YEAR}`,
      400,
    )
  }
}
