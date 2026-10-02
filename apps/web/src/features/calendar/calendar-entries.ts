import type { StoredCalendarEvent, StoredMemberProfile } from '@/data/local-store.ts'
import { type DateOnly, formatDateOnly, localDateKey } from '@/lib/calendar-dates.ts'

/*
 * The calendar's read-side derivation (issue #20): pure selection over the
 * synchronised partition, so the screens answer online and offline from
 * the same code (ADR-0002). The server has already scoped every event to
 * the space — the whole visible calendar travels to every member — so
 * nothing here re-decides visibility; the only decisions are which day an
 * event falls on for this device, and what order a day's list reads in.
 */

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
  return aStart.localeCompare(bStart) || a.id.localeCompare(b.id)
}

/** The events of one day, in the day's order. */
export function eventsOnDate(events: StoredCalendarEvent[], date: DateOnly): StoredCalendarEvent[] {
  const key = formatDateOnly(date)
  return events.filter((event) => eventDateKey(event) === key).sort(byDayOrder)
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
 * while it is running, even if it started yesterday evening.
 */
export function upcomingEvents(events: StoredCalendarEvent[], now: Date): StoredCalendarEvent[] {
  const todayKey = formatDateOnly({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  })
  return events
    .filter((event) => {
      const key = eventDateKey(event)
      if (key === undefined) return false
      if (key >= todayKey) return true
      // Started before today but possibly still running: a timed event
      // stays until its end has passed.
      if (!event.allDay && event.endsAt !== undefined) {
        return Date.parse(event.endsAt) >= now.getTime()
      }
      return false
    })
    .sort(
      (a, b) => (eventDateKey(a) ?? '').localeCompare(eventDateKey(b) ?? '') || byDayOrder(a, b),
    )
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
