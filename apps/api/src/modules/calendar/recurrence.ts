import { wallTimeToInstant, zoneWallTime } from '../../platform/timezone.ts'

/*
 * The recurrence engine (issue #21): the one place that knows how a series
 * unfolds. The stored rule is an RFC 5545 RRULE narrowed to what a family
 * calendar needs — the DAILY, WEEKLY, MONTHLY, and YEARLY frequencies with
 * an optional UNTIL end date — and every other RRULE feature is refused,
 * on the write path by the contracts and here on the read path by a strict
 * parse. The expansion walks wall dates in the series' own frame (the
 * event's zone for a timed event, the zoneless calendar for an all-day
 * one), which is what makes RFC 5545's answers fall out: a monthly series
 * on the 31st skips the months that have no 31st, a yearly series on
 * February 29 repeats only in leap years.
 *
 * The web client keeps a mirror of this module
 * (`apps/web/src/features/calendar/recurrence.ts`) so occurrences display
 * offline with the same rules (ADR-0006); the shared table of expansion
 * cases in `recurrence.test.ts` on both sides confirms the two answers
 * stay identical. Api and web share no domain package (ADR-0013), so the
 * table is the contract between the two implementations.
 */

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]

/** The recurrence the wire carries and the row's RRULE encodes (issue #21). */
export interface Recurrence {
  frequency: RecurrenceFrequency
  /**
   * The last wall date an occurrence may fall on, the date itself included.
   * Absent, the series is unbounded. (RFC 5545's UNTIL bounds the
   * occurrence; the date form is what the member picks and what an all-day
   * row stores, and a timed row encodes it as the end of that day in the
   * event's zone, so both spellings keep the same wall-date meaning.)
   */
  until?: string
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (match === null) return undefined
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return undefined
  // The calendar's own test: a month that has no such day (2026-02-30)
  // rolls over in the UTC reading and must not pass.
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (probe.getUTCMonth() !== parts.month - 1 || probe.getUTCDate() !== parts.day) return undefined
  return parts
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
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/**
 * The wall dates the series occupies, in order, from a step into the
 * pattern on. MONTHLY and YEARLY yield only the months and years that
 * actually have the day — the RFC 5545 skip (the acceptance criteria's
 * "monthly events on the 31st skip months that have no 31st").
 */
function* candidateDates(
  first: DateParts,
  frequency: RecurrenceFrequency,
  skip: number,
): Generator<DateParts> {
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
    const candidate = {
      year: Math.floor(monthIndex / 12),
      month: (monthIndex % 12) + 1,
      day: first.day,
    }
    if (candidate.day <= daysInMonth(candidate.year, candidate.month)) yield candidate
  }
}

/**
 * The wall dates the series occupies within the window, both bounds
 * included, the series' own frame. A one-time event (`recurrence` of
 * undefined) expands to nothing; a malformed key does too — a row the
 * engine cannot read must blank out, not take the read down.
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
 * Whether `dateKey` is one of the series' occurrences: on the pattern,
 * inside the series' span, and no later than the until date. This is the
 * gate an exception passes through — an exception is stored per *original
 * occurrence date* (the acceptance criteria), and a date the series never
 * produces has no occurrence to override or cancel.
 */
export function isOccurrenceDate(
  firstDate: string,
  recurrence: Recurrence,
  dateKey: string,
): boolean {
  const first = parseDateKey(firstDate)
  const date = parseDateKey(dateKey)
  if (first === undefined || date === undefined) return false
  if (recurrence.until !== undefined) {
    const until = parseDateKey(recurrence.until)
    if (until === undefined || compare(date, until) > 0) return false
  }
  if (compare(date, first) < 0) return false
  switch (recurrence.frequency) {
    case 'daily':
      return true
    case 'weekly':
      return (dayNumber(date) - dayNumber(first)) % 7 === 0
    case 'monthly':
      return date.day === first.day && first.day <= daysInMonth(date.year, date.month)
    case 'yearly':
      return (
        date.month === first.month &&
        date.day === first.day &&
        first.day <= daysInMonth(date.year, date.month)
      )
  }
}

/**
 * The RFC 5545 RRULE the row stores, composed from the structured
 * recurrence the member picked. The two kinds encode UNTIL in the form
 * RFC 5545 gives their DTSTART: an all-day event's DTSTART is a date, so
 * UNTIL is a date (`FREQ=…;UNTIL=20270630`); a timed event's is a
 * date-time in a zone, so UNTIL is a UTC date-time — the last minute of
 * the until date in the event's zone, which keeps every occurrence whose
 * wall date is the until date and none whose wall date is later.
 */
export function composeRrule(
  recurrence: Recurrence,
  kind: { allDay: boolean; timezone?: string },
): string {
  let rrule = `FREQ=${recurrence.frequency.toUpperCase()}`
  if (recurrence.until !== undefined) {
    if (kind.allDay) {
      rrule += `;UNTIL=${recurrence.until.replaceAll('-', '')}`
    } else {
      if (kind.timezone === undefined) throw new Error('A timed series composes UNTIL in its zone')
      const cutoff = wallTimeToInstant(recurrence.until, '23:59', kind.timezone)
      rrule += `;UNTIL=${cutoff
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '')}`
    }
  }
  return rrule
}

const RRULE_PATTERN = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;UNTIL=(\d{8}(T\d{6}Z)?)?)?$/

/**
 * The strict read of the stored subset: anything RFC 5545 allows beyond
 * the four frequencies and the optional UNTIL — an INTERVAL, a BYDAY, a
 * COUNT, another frequency — throws here, so a rule the engine cannot
 * expand can never enter the reads (the acceptance criteria's "any other
 * RRULE feature is rejected"). Rows are written only through
 * `composeRrule`, so a throw on this path is a corrupted row, not a
 * member's mistake.
 */
export function parseRrule(
  rrule: string,
  kind: { allDay: boolean; timezone?: string },
): Recurrence {
  const match = RRULE_PATTERN.exec(rrule)
  const frequencyPart = match?.[1]
  const untilEncoded = match?.[3]
  if (frequencyPart === undefined)
    throw new Error(`“${rrule}” is not a recurrence rule this calendar stores`)
  const frequency = frequencyPart.toLowerCase() as RecurrenceFrequency
  if (untilEncoded === undefined) return { frequency }
  let until: string
  if (untilEncoded.length === 8) {
    if (!kind.allDay) throw new Error(`“${rrule}” bounds a timed series with a date-form UNTIL`)
    until = `${untilEncoded.slice(0, 4)}-${untilEncoded.slice(4, 6)}-${untilEncoded.slice(6, 8)}`
  } else {
    if (kind.allDay) throw new Error(`“${rrule}” bounds an all-day series with a date-time UNTIL`)
    if (kind.timezone === undefined) throw new Error('A timed series parses UNTIL in its zone')
    const instant = new Date(
      `${untilEncoded.slice(0, 4)}-${untilEncoded.slice(4, 6)}-${untilEncoded.slice(6, 8)}T${untilEncoded.slice(9, 11)}:${untilEncoded.slice(11, 13)}:${untilEncoded.slice(13, 15)}Z`,
    )
    if (Number.isNaN(instant.getTime())) throw new Error(`“${rrule}” carries an unreadable UNTIL`)
    until = zoneWallTime(instant, kind.timezone).date
  }
  return { frequency, until }
}

/**
 * The instants of the occurrence falling on `dateKey`: its start is the
 * series' wall time composed on that date — the DST rules apply per
 * occurrence, so the wall time repeats whatever the clocks do — and its
 * end keeps the series' wall length.
 */
export function occurrenceInstants(
  frame: TimedFrame,
  dateKey: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = wallTimeToInstant(dateKey, frame.startTime, frame.timezone)
  const endsAt = new Date(startsAt.getTime() + frame.durationMinutes * 60_000)
  return { startsAt, endsAt }
}

/*
 * The series a stored row keeps. The row is the single source of truth:
 * the first occurrence's columns are the series' DTSTART, and a timed
 * series' frame is read back out of the stored instants — the wall time
 * the first occurrence actually reads in the event's zone, which a
 * spring-forward gap may have shifted (the composition's documented
 * convention) — so expansion, membership, and the wire's recurrence all
 * answer from the same place.
 */

export interface SeriesColumns {
  allDay: boolean
  date: string | null
  startsAt: Date | null
  endsAt: Date | null
  timezone: string | null
  rrule: string | null
}

/** The series' first occurrence, its wall date in the series' own frame. */
export function seriesStartDate(event: SeriesColumns): string | undefined {
  if (event.allDay) return event.date ?? undefined
  if (event.startsAt === null || event.timezone === null) return undefined
  return zoneWallTime(event.startsAt, event.timezone).date
}

/** The row's recurrence; undefined on a one-time event. */
export function seriesRecurrence(event: SeriesColumns): Recurrence | undefined {
  if (event.rrule === null) return undefined
  return parseRrule(event.rrule, { allDay: event.allDay, timezone: event.timezone ?? undefined })
}

/** The timed series' frame; undefined on an all-day one. */
export function seriesTimedFrame(event: SeriesColumns): TimedFrame | undefined {
  if (event.allDay || event.startsAt === null || event.endsAt === null || event.timezone === null) {
    return undefined
  }
  const start = zoneWallTime(event.startsAt, event.timezone)
  const end = zoneWallTime(event.endsAt, event.timezone)
  const startMinutes = Number(start.time.slice(0, 2)) * 60 + Number(start.time.slice(3, 5))
  const endMinutes = Number(end.time.slice(0, 2)) * 60 + Number(end.time.slice(3, 5))
  return {
    timezone: event.timezone,
    startTime: start.time,
    durationMinutes: endMinutes - startMinutes,
  }
}
