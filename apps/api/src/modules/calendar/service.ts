import type { Clock } from '../../platform/clock.ts'
import type { Db, Tx } from '../../platform/db/index.ts'
import { DomainError, notFound } from '../../platform/errors.ts'
import { wallTimeToInstant } from '../../platform/timezone.ts'
import { assertTimezone, requireVisibleSectionInTx } from '../spaces/index.ts'
import { recordChanges, type TombstoneInput } from '../sync/index.ts'
import {
  CALENDAR_EVENT_SYNC_ENTITY,
  type CreateEventBody,
  type TimedEventBody,
} from './contracts.ts'
import { assertEventEditableBy } from './policy.ts'
import {
  deleteEvent,
  getEventInSpace,
  insertEvent,
  listChangedEvents,
  listEventsInSpace,
  updateEvent,
} from './repository.ts'
import type { CalendarEvent } from './tables.ts'

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
 * Adds an event to the space's calendar (issue #1, story 61): visible
 * to every member from the moment it lands. The timed kind's wall time is
 * composed into absolute instants against the zone the creator picked —
 * or the space's zone when they named none (issue #1, story 64) — inside the
 * transaction, after the section recheck has taken the space row lock and
 * handed back the space row that names that default zone. A hide that
 * commits alongside the write is still honoured, and the revision advances
 * with the row in one transaction.
 */
export async function createEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  input: CreateEventBody,
): Promise<CalendarEvent> {
  const now = deps.clock.now()
  let created: CalendarEvent | undefined
  await deps.db.transaction(async (tx) => {
    const space = await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
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
  return created
}

/**
 * One event: every member of the space may read it, so the only refusal is
 * a 404 for an event that does not exist here (architecture.md, "Errors").
 */
export async function getEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
): Promise<CalendarEvent> {
  const event = await getEventInSpace(deps.db, actor.spaceId, eventId)
  if (event === undefined) {
    throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
  }
  return event
}

/** The space's events — the HTTP contract the tests and the document speak. */
export async function listEvents(
  deps: CalendarDeps,
  actor: CalendarActor,
): Promise<CalendarEvent[]> {
  return listEventsInSpace(deps.db, actor.spaceId)
}

/**
 * The creator's or owner's edit, a replace of the whole event: the kind can
 * change, an all-day event becoming timed and back. The event is read after
 * the space lock, so the permission decision is never made from a half-done
 * change; the wall time composes against the requested zone, or the space's
 * current one when none is named — the same default the creation applies.
 */
export async function editEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
  input: CreateEventBody,
): Promise<CalendarEvent> {
  const now = deps.clock.now()
  let updated: CalendarEvent | undefined
  await deps.db.transaction(async (tx) => {
    const space = await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    const event = await requireEventInSpace(tx, actor, eventId)
    assertEventEditableBy(event, actor)
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
          updated = row
        },
      },
      now,
    )
  })
  if (updated === undefined) throw new Error('Editing a calendar event produced no row')
  return updated
}

/**
 * The removal (issue #20): the creator's or an owner's, following the
 * journal's moderation model. The calendar has no trash, so the delete
 * writes the tombstone that carries the event out of every device's copy,
 * audience everyone — the event was every member's to see, and every
 * member that saw it must see it go.
 */
export async function removeEvent(
  deps: CalendarDeps,
  actor: CalendarActor,
  eventId: string,
): Promise<void> {
  const now = deps.clock.now()
  await deps.db.transaction(async (tx) => {
    await requireVisibleSectionInTx(tx, actor.spaceId, 'calendar')
    const event = await requireEventInSpace(tx, actor, eventId)
    assertEventEditableBy(event, actor)
    const tombstone: TombstoneInput = {
      entity: CALENDAR_EVENT_SYNC_ENTITY,
      entityId: event.id,
      audience: { kind: 'all' },
    }
    await recordChanges(
      tx,
      actor.spaceId,
      {
        writes: async (writeTx) => {
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
): Promise<CalendarEvent[]> {
  return listChangedEvents(tx, actor.spaceId, since)
}

async function requireEventInSpace(
  executor: Parameters<typeof getEventInSpace>[0],
  actor: CalendarActor,
  eventId: string,
): Promise<CalendarEvent> {
  const event = await getEventInSpace(executor, actor.spaceId, eventId)
  if (event === undefined) {
    throw notFound('event_not_found', `Calendar event ${eventId} does not exist`)
  }
  return event
}

/** The row columns a create-or-edit body stands for. */
function eventColumns(
  input: CreateEventBody,
  spaceTimezone: string,
): {
  allDay: boolean
  date: string | null
  startsAt: Date | null
  endsAt: Date | null
  timezone: string | null
} {
  if (input.allDay) {
    assertRealDate(input.date)
    return { allDay: true, date: input.date, startsAt: null, endsAt: null, timezone: null }
  }
  return timedEventColumns(input, spaceTimezone)
}

function timedEventColumns(
  input: TimedEventBody,
  spaceTimezone: string,
): {
  allDay: false
  date: null
  startsAt: Date
  endsAt: Date
  timezone: string
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
      `A timed event's start does not exist on ${input.date} and the clocks' jump swallows the whole interval`,
      400,
    )
  }
  return { allDay: false, date: null, startsAt, endsAt, timezone }
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
