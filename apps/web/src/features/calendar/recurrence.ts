import type {
  StoredCalendarEvent,
  StoredEventRecurrence,
} from '@/data/local-store.ts'
import {
  formatZonedTime,
  parseDateOnly,
  wallTimeToInstant,
  zonedDateKey,
} from '@/lib/calendar-dates.ts'

/*
 * The recurrence engine's client half (issue #21): the web mirror of the
 * API's `apps/api/src/modules/calendar/recurrence.ts`. The device expands
 * a repeating event's occurrences from the one row the sync response
 * carries, with the same rules the server keeps — the monthly series on
 * the 31st skips the months that have no 31st, the wall time repeats in
 * the event's zone whatever the clocks do — so the calendar answers the
 * same offline (ADR-0002, ADR-0006). The shared table of expansion cases
 * in `recurrence.test.ts` on both sides confirms the two answers stay
 * identical; api and web share no domain package (ADR-0013), so the table
 * is the contract between the two implementations.
 */

export type RecurrenceFrequency = StoredEventRecurrence['frequency']

/** The recurrence as the wire carries it — the event row's `recurrence`. */
export type Recurrence = StoredEventRecurrence

interface DateParts {
  year: number
  /** 1–12. */
  month: number
  day: number
}

const DAY_MS = 86_400_000

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseDateKey(key: string): DateParts | undefined {
  const parsed = parseDateOnly(key)
  return parsed === undefined ? undefined : parsed
}

function formatDateKey({ year, month, day }: DateParts): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`
}

/** Whole days since the epoch — the arithmetic daily and weekly walk on. */
function dayNumber({ year, month, day }: DateParts): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS)
}

function addDays(parts: DateParts, days: number): DateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function compare(a: DateParts | string, b: DateParts | string): number {
  const keyOf = (value: DateParts | string): string =>
    typeof value === 'string' ? value : formatDateKey(value)
  return keyOf(a).localeCompare(keyOf(b))
}

function maxDate(a: DateParts, b: DateParts): DateParts {
  return compare(a, b) >= 0 ? a : b
}

function minDate(a: DateParts, b: DateParts): DateParts {
  return compare(a, b) <= 0 ? a : b
}

/**
 * The wall dates the series occupies, in order, from a step into the
 * pattern on. MONTHLY and YEARLY yield only the months and years that
 * actually have the day — the RFC 5545 skip, the acceptance criteria's
 * "monthly events on the 31st skip months that have no 31st".
 */
function* candidateDates(first: DateParts, frequency: RecurrenceFrequency, skip: number): Generator<DateParts> {
  if (frequency === 'daily' || frequency === 'weekly') {
    const step = frequency === 'daily' ? 1 : 7
    for (let days = Math.max(skip, 0) * step; ; days += step) yield addDays(first, days)
  }
  // The month walk advances by whole months (twelve for a yearly series)
  // and yields only the candidates whose month actually has the day: the
  // skipped months and years produce nothing, the RFC 5545 answer.
  const monthStep = frequency === 'monthly' ? 1 : 12
  const firstMonthIndex = first.year * 12 + (first.month - 1)
  for (let index = Math.max(skip, 0) * monthStep; ; index += monthStep) {
    const monthIndex = firstMonthIndex + index
    const candidate = { year: Math.floor(monthIndex / 12), month: (monthIndex % 12) + 1, day: first.day }
    if (candidate.day <= daysInMonth(candidate.year, candidate.month)) yield candidate
  }
}

/**
 * The wall dates the series occupies within the window, both bounds
 * included, the series' own frame. A one-time event (no `recurrence`)
 * expands to nothing; a malformed key does too — a row the engine cannot
 * read must blank out, not take the screen down.
 */
export function expandOccurrenceDates(
  firstDate: string,
  recurrence: Recurrence | undefined,
  fromKey: string,
  toKey: string,
): string[] {
  if (recurrence === undefined) return []
  const first = parseDateKey(firstDate)
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  if (first === undefined || from === undefined || to === undefined) return []
  const until = recurrence.until === undefined ? undefined : parseDateKey(recurrence.until)
  if (recurrence.until !== undefined && until === undefined) return []
  // The series starts at its first occurrence: before it there is nothing,
  // and the until date is the last day an occurrence may fall on.
  const start = maxDate(first, from)
  const end = minDate(to, until ?? to)
  if (compare(start, end) > 0) return []
  // The walk fast-forwards to the window's neighbourhood; the candidate
  // generator's own skips (the short months, the non-leap years) do the
  // rest, and the bounds decide what is kept.
  const skip =
    recurrence.frequency === 'daily'
      ? dayNumber(start) - dayNumber(first)
      : recurrence.frequency === 'weekly'
        ? Math.floor((dayNumber(start) - dayNumber(first)) / 7)
        : recurrence.frequency === 'monthly'
          ? start.year * 12 + start.month - (first.year * 12 + first.month)
          : start.year - first.year
  const dates: string[] = []
  for (const candidate of candidateDates(first, recurrence.frequency, skip)) {
    const key = formatDateKey(candidate)
    if (compare(key, end) > 0) break
    if (compare(key, start) >= 0) dates.push(key)
  }
  return dates
}

/** The timed series' frame the expansion composes instants from. */
export interface TimedFrame {
  /** The event's IANA zone — where the wall time lives. */
  timezone: string
  /** The series' wall start time, `HH:MM` in the event's zone. */
  startTime: string
  /**
   * The series' wall length in minutes. Each occurrence keeps this length,
   * so a start shifted out of a spring-forward gap never meets its end.
   */
  durationMinutes: number
}

/**
 * The instants of the occurrence falling on `dateKey`: its start is the
 * series' wall time composed on that date — the DST rules apply per
 * occurrence, so the wall time repeats whatever the clocks do — and its
 * end keeps the series' wall length. The ISO strings the stored rows
 * carry.
 */
export function occurrenceInstants(
  frame: TimedFrame,
  dateKey: string,
): { startsAt: string; endsAt: string } {
  const startsAt = wallTimeToInstant(dateKey, frame.startTime, frame.timezone)
  const endsAt = new Date(startsAt.getTime() + frame.durationMinutes * 60_000)
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

/*
 * The series a stored row keeps — the row is the single source of truth:
 * the first occurrence's fields are the series' DTSTART, and a timed
 * series' frame is read back out of the stored instants (the wall time the
 * first occurrence actually reads in the event's zone).
 */

/** The series' first occurrence, its wall date in the series' own frame. */
export function seriesStartDate(event: StoredCalendarEvent): string | undefined {
  if (event.allDay) return event.date
  if (event.startsAt === undefined || event.timezone === undefined) return undefined
  return zonedDateKey(event.startsAt, event.timezone)
}

/** The row's recurrence; undefined on a one-time event. */
export function seriesRecurrence(event: StoredCalendarEvent): Recurrence | undefined {
  return event.recurrence
}

/** The timed series' frame; undefined on an all-day one. */
export function seriesTimedFrame(event: StoredCalendarEvent): TimedFrame | undefined {
  if (event.allDay || event.startsAt === undefined || event.endsAt === undefined) return undefined
  const timezone = event.timezone
  if (timezone === undefined) return undefined
  const startTime = formatZonedTime(event.startsAt, timezone)
  const endTime = formatZonedTime(event.endsAt, timezone)
  const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5))
  const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5))
  return { timezone, startTime, durationMinutes: endMinutes - startMinutes }
}

/** Whether the row repeats at all (issue #21). */
export function isRecurring(event: StoredCalendarEvent): boolean {
  return event.recurrence !== undefined
}

/**
 * One occurrence of a repeating event, as the screens read it: the series'
 * default for that date — or the override's replacement when the original
 * date carries one — under the occurrence's own identity,
 * `eventId:originalDate`. A cancelled occurrence is not here: the series
 * skips it, and so does every screen.
 */
export interface EventOccurrence {
  key: string
  eventId: string
  originalDate: string
  /** The occurrence's effective fields, stored-event shaped. */
  event: StoredCalendarEvent
}

/** The key an occurrence is known by on its series' screens and routes. */
export function occurrenceKey(eventId: string, originalDate: string): string {
  return `${eventId}:${originalDate}`
}

/**
 * The series' occurrence on `originalDate` — the whole window's expansion
 * is not needed to answer one date: the date is an occurrence exactly when
 * the window expansion would produce it, so a two-day window around it
 * asks the same question.
 */
export function occurrenceOf(
  event: StoredCalendarEvent,
  originalDate: string,
): EventOccurrence | undefined {
  const firstDate = seriesStartDate(event)
  if (firstDate === undefined) return undefined
  const around = expandOccurrenceDates(firstDate, seriesRecurrence(event), originalDate, originalDate)
  if (!around.includes(originalDate)) return undefined
  if (isCancelled(event, originalDate)) return undefined
  return buildOccurrence(event, originalDate)
}

/**
 * The series' occurrences within the wall-date window, its own frame
 * (the event's zone for a timed event, the zoneless calendar for an
 * all-day one), each with its exceptions applied.
 */
export function expandEvent(
  event: StoredCalendarEvent,
  fromKey: string,
  toKey: string,
): EventOccurrence[] {
  const firstDate = seriesStartDate(event)
  if (firstDate === undefined) return []
  return expandOccurrenceDates(firstDate, seriesRecurrence(event), fromKey, toKey)
    .filter((date) => !isCancelled(event, date))
    .map((date) => buildOccurrence(event, date))
}

/** Whether the series skips the date: an exception cancelled it. */
function isCancelled(event: StoredCalendarEvent, originalDate: string): boolean {
  return (
    event.exceptions?.some(
      (candidate) => candidate.originalDate === originalDate && candidate.kind === 'cancelled',
    ) ?? false
  )
}

function buildOccurrence(event: StoredCalendarEvent, originalDate: string): EventOccurrence {
  const key = occurrenceKey(event.id, originalDate)
  const exception = event.exceptions?.find((candidate) => candidate.originalDate === originalDate)
  const base = {
    id: key,
    creatorId: event.creatorId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }
  const effective: StoredCalendarEvent =
    exception !== undefined && exception.kind === 'override'
      ? exception.allDay
        ? { ...base, title: exception.title, allDay: true, date: exception.date }
        : {
            ...base,
            title: exception.title,
            allDay: false,
            startsAt: exception.startsAt,
            endsAt: exception.endsAt,
            timezone: exception.timezone,
          }
      : occurrenceOfSeries(event, originalDate, key)
  return { key, eventId: event.id, originalDate, event: effective }
}

/** The series' own answer for the date: the same wall time, that day. */
function occurrenceOfSeries(
  event: StoredCalendarEvent,
  originalDate: string,
  key: string,
): StoredCalendarEvent {
  if (event.allDay || event.startsAt === undefined) {
    return { id: key, creatorId: event.creatorId, title: event.title, allDay: true, date: originalDate, createdAt: event.createdAt, updatedAt: event.updatedAt }
  }
  const frame = seriesTimedFrame(event)
  if (frame === undefined) {
    return {
      id: key,
      creatorId: event.creatorId,
      title: event.title,
      allDay: true,
      date: originalDate,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }
  }
  const { startsAt, endsAt } = occurrenceInstants(frame, originalDate)
  return {
    id: key,
    creatorId: event.creatorId,
    title: event.title,
    allDay: false,
    startsAt,
    endsAt,
    timezone: event.timezone,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }
}
