import { type Static, Type } from '@sinclair/typebox'
import { parseRrule } from './recurrence.ts'
import type { CalendarEvent, CalendarEventException } from './tables.ts'

/*
 * The calendar contracts (issues #20 and #21). The DTO names the creator by
 * id only, like the journal's and wishlist's author: the space's profiles
 * travel on their own sync entity, so the client attributes events from the
 * member store it already holds. The two kinds keep their own fields on the
 * wire — an all-day event carries only its zoneless date, a timed event its
 * absolute moments and the IANA zone it keeps — so a device can never
 * mistake one kind's columns for the other's.
 *
 * A repeating event (issue #21) carries its recurrence — the frequency and
 * the optional until date the member picked — and the exceptions it has
 * accumulated, each keyed by the original occurrence date it overrides or
 * cancels. The exceptions ride inside the event's DTO (the media module's
 * precedent: a change stamps the event row, and that stamp is the
 * delivery), so a device expands the series from one row, offline
 * included.
 */

export const EVENT_TITLE_MAX_LENGTH = 200
export const EVENT_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
export const EVENT_TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$'

/** The calendar module's entity name in the tombstone table. */
export const CALENDAR_EVENT_SYNC_ENTITY = 'calendar_event'

export const EventIdParamsSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
})

/** The occurrence routes name the original wall date they act on. */
export const OccurrenceParamsSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  originalDate: Type.String({ pattern: EVENT_DATE_PATTERN }),
})

/**
 * The recurrence the wire carries: one of the four frequencies and the
 * optional until date. There is no RRULE text on the wire — the stored
 * rule is composed from this shape alone, so an INTERVAL, a BYDAY, a
 * COUNT, or any other RRULE feature the member's client might send is
 * refused here before any rule of the service runs (the acceptance
 * criteria's "any other RRULE feature is rejected").
 */
export const RecurrenceSchema = Type.Object(
  {
    frequency: Type.Union([
      Type.Literal('daily'),
      Type.Literal('weekly'),
      Type.Literal('monthly'),
      Type.Literal('yearly'),
    ]),
    until: Type.Optional(Type.String({ pattern: EVENT_DATE_PATTERN })),
  },
  { additionalProperties: false },
)

export type RecurrenceDto = Static<typeof RecurrenceSchema>

/** An original occurrence cancelled on its own: the series skips it. */
export const CancelledExceptionDtoSchema = Type.Object(
  {
    originalDate: Type.String({ pattern: EVENT_DATE_PATTERN }),
    kind: Type.Literal('cancelled'),
  },
  { additionalProperties: false },
)

export type CancelledExceptionDto = Static<typeof CancelledExceptionDtoSchema>

/**
 * An original occurrence replaced whole — an event of its own kind on that
 * date, the series' pattern not applied to it. The shape is the event's
 * own, so a screen renders it by the same rules.
 */
export const AllDayOverrideDtoSchema = Type.Object(
  {
    originalDate: Type.String({ pattern: EVENT_DATE_PATTERN }),
    kind: Type.Literal('override'),
    title: Type.String(),
    allDay: Type.Literal(true),
    date: Type.String({ pattern: EVENT_DATE_PATTERN }),
  },
  { additionalProperties: false },
)

export const TimedOverrideDtoSchema = Type.Object(
  {
    originalDate: Type.String({ pattern: EVENT_DATE_PATTERN }),
    kind: Type.Literal('override'),
    title: Type.String(),
    allDay: Type.Literal(false),
    startsAt: Type.String({ format: 'date-time' }),
    endsAt: Type.String({ format: 'date-time' }),
    timezone: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

export const OverrideExceptionDtoSchema = Type.Union([
  AllDayOverrideDtoSchema,
  TimedOverrideDtoSchema,
])

export type OverrideExceptionDto = Static<typeof OverrideExceptionDtoSchema>

export const EventExceptionDtoSchema = Type.Union([
  CancelledExceptionDtoSchema,
  AllDayOverrideDtoSchema,
  TimedOverrideDtoSchema,
])

export type EventExceptionDto = Static<typeof EventExceptionDtoSchema>

export const CalendarEventDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    creatorId: Type.String({ format: 'uuid' }),
    title: Type.String(),
    allDay: Type.Boolean(),
    // The all-day kind: the zoneless calendar date, `YYYY-MM-DD`.
    date: Type.Optional(Type.String({ pattern: EVENT_DATE_PATTERN })),
    // The timed kind: absolute moments plus the IANA zone the event keeps.
    startsAt: Type.Optional(Type.String({ format: 'date-time' })),
    endsAt: Type.Optional(Type.String({ format: 'date-time' })),
    timezone: Type.Optional(Type.String({ minLength: 1 })),
    // The series (issue #21): absent on a one-time event, the recurrence
    // and its exceptions ride along on a repeating one.
    recurrence: Type.Optional(RecurrenceSchema),
    exceptions: Type.Optional(Type.Array(EventExceptionDtoSchema)),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type CalendarEventDto = Static<typeof CalendarEventDtoSchema>

/**
 * Projects the event row onto the wire shape the reads and sync share.
 * Each kind carries only its own columns: an all-day event's date is the
 * whole truth about when it happens, a timed event's moments and zone are
 * its — the device-local reading is the viewer's business, not the wire's.
 * A row whose columns do not match its kind is a programming error the
 * database's checks refuse to store; refusing loudly here keeps the wire
 * contract honest all the same. The stored RRULE is parsed strictly (the
 * recurrence module), so the recurrence on the wire is what the row can
 * honestly expand to.
 */
export function toEventDto(
  event: CalendarEvent,
  exceptions: readonly CalendarEventException[] = [],
): CalendarEventDto {
  const base = {
    id: event.id,
    creatorId: event.creatorMemberId,
    title: event.title,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  }
  const dto: CalendarEventDto = event.allDay ? dtoOfAllDay(event, base) : dtoOfTimed(event, base)
  if (event.rrule !== null) {
    dto.recurrence = parseRrule(event.rrule, {
      allDay: event.allDay,
      timezone: event.timezone ?? undefined,
    })
  }
  if (exceptions.length > 0) {
    dto.exceptions = exceptions.map(toExceptionDto)
  }
  return dto
}

function dtoOfAllDay(
  event: CalendarEvent,
  base: { id: string; creatorId: string; title: string; createdAt: string; updatedAt: string },
): CalendarEventDto {
  if (event.date === null) {
    throw new Error('An all-day event carries its zoneless date')
  }
  return { ...base, allDay: true, date: event.date }
}

function dtoOfTimed(
  event: CalendarEvent,
  base: { id: string; creatorId: string; title: string; createdAt: string; updatedAt: string },
): CalendarEventDto {
  if (event.startsAt === null || event.endsAt === null || event.timezone === null) {
    throw new Error('A timed event carries its moments and its zone')
  }
  return {
    ...base,
    allDay: false,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
  }
}

function toExceptionDto(exception: CalendarEventException): EventExceptionDto {
  const originalDate = exception.originalDate
  if (exception.kind === 'cancelled') {
    return { originalDate, kind: 'cancelled' }
  }
  const title = exception.title
  const allDay = exception.allDay
  if (title === null || allDay === null) {
    throw new Error('An override carries its replacement whole')
  }
  if (allDay) {
    const date = exception.date
    if (date === null) throw new Error('An all-day override carries its zoneless date')
    return { originalDate, kind: 'override', title, allDay: true, date }
  }
  const startsAt = exception.startsAt
  const endsAt = exception.endsAt
  const timezone = exception.timezone
  if (startsAt === null || endsAt === null || timezone === null) {
    throw new Error('A timed override carries its moments and its zone')
  }
  return {
    originalDate,
    kind: 'override',
    title,
    allDay: false,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timezone,
  }
}

/**
 * PostgreSQL refuses NUL inside text, so the contracts refuse it at the
 * door: a payload that slips through would turn the write into a 500
 * instead of a validation answer.
 */
const titleSchema = Type.String({
  minLength: 1,
  maxLength: EVENT_TITLE_MAX_LENGTH,
  pattern: '^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$',
})

const dateSchema = Type.String({ pattern: EVENT_DATE_PATTERN })

const timeSchema = Type.String({ pattern: EVENT_TIME_PATTERN })

// The zone's shape is the service's business (an IANA name is validated
// against the runtime's zone database, not a pattern); the wire only
// refuses the empty string here.
const timezoneSchema = Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))

/**
 * The create and edit bodies are a union on the kind (an edit is a replace,
 * the wishlist's PUT precedent): an all-day event names its date and no
 * time at all, a timed event its date, start and end times, and the zone —
 * whose absence is the space's zone, applied by the service. The schema's
 * discrimination answers a mixed payload with `validation_failed` before
 * any rule of the service runs. A series body may name the recurrence
 * (issue #21); its absence on an edit makes the event one-time — a whole
 * replace, never "keep the old rule".
 */
const allDayEventProperties = {
  title: titleSchema,
  allDay: Type.Literal(true),
  date: dateSchema,
}

const timedEventProperties = {
  title: titleSchema,
  allDay: Type.Literal(false),
  date: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  timezone: timezoneSchema,
}

export const AllDayEventBodySchema = Type.Object(allDayEventProperties, {
  additionalProperties: false,
})

export const TimedEventBodySchema = Type.Object(timedEventProperties, {
  additionalProperties: false,
})

export type AllDayEventBody = Static<typeof AllDayEventBodySchema>
export type TimedEventBody = Static<typeof TimedEventBodySchema>

/** A single occurrence's replacement: one date, no recurrence of its own. */
export const OccurrenceBodySchema = Type.Union([AllDayEventBodySchema, TimedEventBodySchema])

export type OccurrenceBody = Static<typeof OccurrenceBodySchema>

const recurrenceProperty = { recurrence: Type.Optional(RecurrenceSchema) }

export const AllDaySeriesBodySchema = Type.Object(
  { ...allDayEventProperties, ...recurrenceProperty },
  { additionalProperties: false },
)

export const TimedSeriesBodySchema = Type.Object(
  { ...timedEventProperties, ...recurrenceProperty },
  { additionalProperties: false },
)

export const CreateEventBodySchema = Type.Union([AllDaySeriesBodySchema, TimedSeriesBodySchema])

export type CreateEventBody = Static<typeof CreateEventBodySchema>

export type AllDaySeriesBody = Static<typeof AllDaySeriesBodySchema>
export type TimedSeriesBody = Static<typeof TimedSeriesBodySchema>

export const UpdateEventBodySchema = CreateEventBodySchema

export type UpdateEventBody = Static<typeof UpdateEventBodySchema>

export const EventListDtoSchema = Type.Object(
  { events: Type.Array(CalendarEventDtoSchema) },
  { additionalProperties: false },
)

export type EventListDto = Static<typeof EventListDtoSchema>

/** The event's change in the sync response (issue #14, ADR-0014). */
export const CalendarEventSyncChangeSchema = Type.Object(
  { entity: Type.Literal('calendar_event'), event: CalendarEventDtoSchema },
  { additionalProperties: false },
)
