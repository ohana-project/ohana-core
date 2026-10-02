import { type Static, Type } from '@sinclair/typebox'
import type { CalendarEvent } from './tables.ts'

/*
 * The calendar contracts (issue #20). The DTO names the creator by id only,
 * like the journal's and wishlist's author: the space's profiles travel on
 * their own sync entity, so the client attributes events from the member
 * store it already holds. The two kinds keep their own fields on the wire —
 * an all-day event carries only its zoneless date, a timed event its
 * absolute moments and the IANA zone it keeps — so a device can never
 * mistake one kind's columns for the other's.
 */

export const EVENT_TITLE_MAX_LENGTH = 200
export const EVENT_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
export const EVENT_TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$'

/** The calendar module's entity name in the tombstone table. */
export const CALENDAR_EVENT_SYNC_ENTITY = 'calendar_event'

export const EventIdParamsSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
})

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
 * contract honest all the same.
 */
export function toEventDto(event: CalendarEvent): CalendarEventDto {
  if (event.allDay) {
    if (event.date === null) {
      throw new Error('An all-day event carries its zoneless date')
    }
    return {
      id: event.id,
      creatorId: event.creatorMemberId,
      title: event.title,
      allDay: true,
      date: event.date,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    }
  }
  if (event.startsAt === null || event.endsAt === null || event.timezone === null) {
    throw new Error('A timed event carries its moments and its zone')
  }
  return {
    id: event.id,
    creatorId: event.creatorMemberId,
    title: event.title,
    allDay: false,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
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
 * any rule of the service runs.
 */
export const AllDayEventBodySchema = Type.Object(
  {
    title: titleSchema,
    allDay: Type.Literal(true),
    date: dateSchema,
  },
  { additionalProperties: false },
)

export const TimedEventBodySchema = Type.Object(
  {
    title: titleSchema,
    allDay: Type.Literal(false),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    timezone: timezoneSchema,
  },
  { additionalProperties: false },
)

export const CreateEventBodySchema = Type.Union([
  AllDayEventBodySchema,
  TimedEventBodySchema,
])

export type CreateEventBody = Static<typeof CreateEventBodySchema>

export type AllDayEventBody = Static<typeof AllDayEventBodySchema>
export type TimedEventBody = Static<typeof TimedEventBodySchema>

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
