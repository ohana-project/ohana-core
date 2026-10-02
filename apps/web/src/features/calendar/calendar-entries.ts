import type { StoredCalendarEvent, StoredMemberProfile } from '@/data/local-store.ts'
import { formatDateOnly, localDateKey, shiftDateKey } from '@/lib/calendar-dates.ts'
import { expandEvent, isRecurring } from './recurrence.ts'

/*
 * The calendar's read-side derivation (issues #20 and #21): pure selection
 * over the synchronised partition, so the screens answer online and offline
 * from the same code (ADR-0002). The server has already scoped every event
 * to the space — the whole visible calendar travels to every member — so
 * nothing here re-decides visibility; the only decisions are which day an
 * event falls on for this device, what order a day's list reads in, and —
 * for a repeating event — which of its occurrences fall in the window a
 * screen draws.
 */

/**
 * One row a screen draws: a one-time event as the partition holds it, or
 * one occurrence of a repeating event — the series' answer for a date (or
 * an override's replacement), carrying the series it belongs to and the
 * original date it stands for. The occurrence's `id` is the occurrence's
 * own key, `eventId:originalDate`; the series link goes by `seriesId` and
 * `originalDate`.
 */
export interface CalendarOccurrence extends StoredCalendarEvent {
  seriesId?: string
  originalDate?: string
}

/**
 * The partition's events for a window of the series' own wall dates: a
 * one-time event passes through whole (its single date needs no window),
 * a repeating event becomes the occurrences the window holds, cancelled
 * ones skipped. The window is the series' frame — the event's zone for a
 * timed event, the zoneless calendar for an all-day one — not the device's;
 * the bucketing below is where the device's day takes over.
 */
export function calendarOccurrences(
  events: StoredCalendarEvent[],
  fromKey: string,
  toKey: string,
): CalendarOccurrence[] {
  const occurrences: CalendarOccurrence[] = []
  for (const event of events) {
    if (!isRecurring(event)) {
      occurrences.push(event)
      continue
    }
    for (const occurrence of expandEvent(event, fromKey, toKey)) {
      occurrences.push({
        ...occurrence.event,
        seriesId: occurrence.eventId,
        originalDate: occurrence.originalDate,
      })
    }
  }
  return occurrences
}

/** How far ahead the agenda looks (issue #21): a repeating series is
 *  unbounded, so the agenda asks for a season, not for ever. */
export const AGENDA_WINDOW_DAYS = 60

/**
 * Where an occurrence row leads: its series' event screen at the
 * occurrence's original date — a one-time event's own screen. One helper
 * for every list that renders one, so the link cannot drift back to the
 * occurrence's composite id, which is no event's address.
 */
export function occurrenceLink(occurrence: CalendarOccurrence): {
  params: { eventId: string }
  search: { date?: string }
} {
  return {
    params: { eventId: occurrence.seriesId ?? occurrence.id },
    search: occurrence.originalDate === undefined ? {} : { date: occurrence.originalDate },
  }
}

/** The device-local day an event sits on: an all-day event its own
 *  zoneless date, a timed event the local day its start falls on
 *  (issue #1, stories 62–63). */
export function eventDateKey(event: StoredCalendarEvent): string | undefined {
  if (event.allDay) return event.date
  return event.startsAt === undefined ? undefined : localDateKey(event.startsAt)
}

/** A day's order: the all-day events first (they hold the whole day),
 *  then the timed ones by their start, the id breaking same-moment ties. */
function byDayOrder(a: StoredCalendarEvent, b: StoredCalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  const aStart = a.startsAt ?? ''
  const bStart = b.startsAt ?? ''
  // Plain codepoint order: fixed-width ISO strings and ids sort themselves.
  return aStart < bStart ? -1 : aStart > bStart ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * One pass over the partition: the events bucketed by their device-local
 * day, each bucket in the day's order — the month grid's 42 lookups are
 * reads from this map, not 42 filters.
 */
export function eventsByDate(events: StoredCalendarEvent[]): Map<string, StoredCalendarEvent[]> {
  const buckets = new Map<string, StoredCalendarEvent[]>()
  for (const event of events) {
    const key = eventDateKey(event)
    if (key === undefined) continue
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [event])
    else bucket.push(event)
  }
  for (const bucket of buckets.values()) bucket.sort(byDayOrder)
  return buckets
}

/** The event by its id, or undefined when the partition does not hold it. */
export function eventById(
  events: StoredCalendarEvent[],
  eventId: string,
): StoredCalendarEvent | undefined {
  return events.find((event) => event.id === eventId)
}

/**
 * The upcoming events from `now`, agenda order: day by day, and within a
 * day the day's own order (the all-day events at its front, then the timed
 * ones by their start). The past is not the agenda's business — an event
 * stays while its day has not begun to pass, and a timed one still shows
 * while it is running, even if it started yesterday evening. A repeating
 * event joins its occurrences for the season ahead (issue #21): the
 * unbounded rule asks for a window, the one-time events answer as always.
 */
export function upcomingEvents(events: StoredCalendarEvent[], now: Date): CalendarOccurrence[] {
  const todayKey = formatDateOnly({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  })
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + AGENDA_WINDOW_DAYS)
  const toKey = formatDateOnly({
    year: horizon.getFullYear(),
    month: horizon.getMonth() + 1,
    day: horizon.getDate(),
  })
  // The expansion window reaches a day past each end in the series' frame,
  // so an occurrence a zone shift lands on the device's today is not lost
  // to the wall-date bounds — the local keys below decide.
  const expanded = calendarOccurrences(events, shiftDateKey(todayKey, -1), shiftDateKey(toKey, 1))
  return expanded
    .filter((occurrence) => {
      const key = eventDateKey(occurrence)
      if (key === undefined) return false
      if (key >= todayKey && key <= toKey) return true
      // Started before today but possibly still running: a timed event
      // stays until its end has passed. The still-running rule reaches
      // into the past alone — never past the season's far edge, which is
      // the repeating series' bound.
      if (key < todayKey) {
        return (
          !occurrence.allDay &&
          occurrence.endsAt !== undefined &&
          Date.parse(occurrence.endsAt) >= now.getTime()
        )
      }
      // Beyond the window's far edge only a one-time event is still the
      // agenda's — and only the series' rows carry the bound: an
      // occurrence's own fields name no rule.
      return occurrence.seriesId === undefined
    })
    .sort((a, b) => byKeyOrder(a, b) || byDayOrder(a, b))
}

/** The agenda's order: the device-local day first, the day's own order under it. */
function byKeyOrder(a: StoredCalendarEvent, b: StoredCalendarEvent): number {
  const aKey = eventDateKey(a) ?? ''
  const bKey = eventDateKey(b) ?? ''
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

/**
 * Whether the actor may edit or delete an event: the creator, or an owner
 * (issue #20, the journal's moderation model). The role comes from the
 * synchronised profiles — the actor's own, by id.
 */
export function canEditEvent(
  event: StoredCalendarEvent,
  memberId: string | undefined,
  profiles: StoredMemberProfile[],
): boolean {
  if (memberId === undefined) return false
  if (event.creatorId === memberId) return true
  return profiles.find((profile) => profile.id === memberId)?.role === 'owner'
}
