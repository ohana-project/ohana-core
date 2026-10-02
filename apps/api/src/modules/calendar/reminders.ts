import { wallTimeToInstant } from '../../platform/timezone.ts'
import {
  expandOccurrenceDates,
  isOccurrenceDate,
  occurrenceInstants,
  seriesRecurrence,
  seriesStartDate,
  seriesTimedFrame,
} from './recurrence.ts'
import type { CalendarEvent, CalendarEventException, CalendarEventReminder } from './tables.ts'

/*
 * The reminder side of the recurrence engine (issue #22): the one place
 * that turns an event, its reminder config, and the current exceptions
 * into the moments a reminder is due. The service's scheduling and the
 * worker's sending handler both answer from here, so an edit reschedules
 * a series' reminders by changing state alone — the jobs that are still
 * pending re-read the event when they fire and answer for what the event
 * has become.
 *
 * An all-day occurrence has no instant of its own; its reminder anchors
 * to the morning of the occurrence's wall date in the space's zone — the
 * zone the family lives in, the same default the timed kind composes
 * from. The lead then moves the moment as the creator asked.
 */

/** How far ahead per-event reminder jobs are scheduled. A recurring
 *  event's horizon is extended by the worker's sweep before it runs out. */
export const REMINDER_HORIZON_DAYS = 62

/** The bound beyond which a due-but-unsent reminder is dropped: the worker
 *  was down longer than that, and a day-late "soon" is noise, not a
 *  reminder (ADR-0006: exact display time is not guaranteed). */
export const REMINDER_STALE_LIMIT_MS = 24 * 60 * 60 * 1000

/** The wall time an all-day occurrence's reminder anchors to. */
export const ALL_DAY_REMINDER_WALL_TIME = '09:00'

/** How far before a scheduling window the candidate walk looks: the
 *  contract's longest lead, so an occurrence whose wall date sits just
 *  outside the window can still have its reminder land inside it. */
const LEAD_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1000

/**
 * The instant the reminder for the occurrence named by `originalDate` is
 * due, computed from the event's *current* state: an override replaces the
 * occurrence whole and moves its reminder with it, a cancellation removes
 * the reminder with the occurrence, and a date the edited series no longer
 * produces has no occurrence to remind about. Undefined — nothing is due.
 */
export function reminderInstantFor(
  event: CalendarEvent,
  exception: CalendarEventException | undefined,
  originalDate: string,
  spaceTimezone: string,
): Date | undefined {
  if (exception?.kind === 'cancelled') return undefined
  if (event.rrule === null) {
    // A one-time event's only occurrence is its own wall date, read in the
    // event's own frame — the all-day kind's zoneless calendar, the timed
    // kind's zone (the timed row's `date` column is null by design).
    if (seriesStartDate(event) !== originalDate) return undefined
    return startInstantOf(event.allDay, event.date, event.startsAt, spaceTimezone)
  }
  const recurrence = seriesRecurrence(event)
  const firstDate = seriesStartDate(event)
  if (recurrence === undefined || firstDate === undefined) return undefined
  if (!isOccurrenceDate(firstDate, recurrence, originalDate)) return undefined
  if (exception !== undefined) {
    // The override stands as an event of its own on that date; its kind is
    // its own too, and the all-day kind's anchor is the space's zone.
    return startInstantOf(
      exception.allDay === true,
      exception.date,
      exception.startsAt,
      spaceTimezone,
    )
  }
  if (event.allDay) return morningInstant(originalDate, spaceTimezone)
  const frame = seriesTimedFrame(event)
  if (frame === undefined) return undefined
  return occurrenceInstants(frame, originalDate).startsAt
}

/** The start instant the occurrence's own kind names; the all-day kind
 *  anchors to the space's morning. */
function startInstantOf(
  allDay: boolean,
  date: string | null,
  startsAt: Date | null,
  spaceTimezone: string,
): Date | undefined {
  if (allDay) return date === null ? undefined : morningInstant(date, spaceTimezone)
  return startsAt ?? undefined
}

function morningInstant(dateKey: string, timezone: string): Date {
  return wallTimeToInstant(dateKey, ALL_DAY_REMINDER_WALL_TIME, timezone)
}

/**
 * The reminder jobs an event's current state schedules: the occurrences
 * whose reminder falls inside `[from, to]`, each with the moment its job
 * should first run. Overrides move their occurrence's reminder wherever
 * the replacement stands — their anchors ride along no matter where the
 * series' own walk lands them.
 */
export function reminderJobsBetween(
  event: CalendarEvent,
  exceptions: readonly CalendarEventException[],
  reminder: CalendarEventReminder,
  spaceTimezone: string,
  from: Date,
  to: Date,
): Array<{ originalDate: string; sendAt: Date }> {
  const jobs: Array<{ originalDate: string; sendAt: Date }> = []
  const byDate = new Map(exceptions.map((exception) => [exception.originalDate, exception]))
  for (const originalDate of candidateDates(event, exceptions, from, to)) {
    const start = reminderInstantFor(event, byDate.get(originalDate), originalDate, spaceTimezone)
    if (start === undefined) continue
    const sendAt = new Date(start.getTime() - reminder.leadMinutes * 60_000)
    if (sendAt.getTime() < from.getTime() || sendAt.getTime() > to.getTime()) continue
    jobs.push({ originalDate, sendAt })
  }
  return jobs
}

/**
 * The original dates worth asking about in the window: a one-time event's
 * own date; a series' occurrences, expanded a longest lead's lookback
 * before the window's start; and every override's anchor, because an
 * override may have moved its occurrence far from where the pattern put
 * it while keeping the original date as its key.
 */
function candidateDates(
  event: CalendarEvent,
  exceptions: readonly CalendarEventException[],
  from: Date,
  to: Date,
): string[] {
  if (event.rrule === null) {
    const firstDate = seriesStartDate(event)
    return firstDate !== undefined ? [firstDate] : []
  }
  const recurrence = seriesRecurrence(event)
  const firstDate = seriesStartDate(event)
  if (recurrence === undefined || firstDate === undefined) return []
  // The window keys are wall dates in the zoneless calendar frame — bounds
  // for the walk only; every real instant is composed in its own kind's
  // frame further up.
  const toKey = to.toISOString().slice(0, 10)
  const fromKey = new Date(from.getTime() - LEAD_LOOKBACK_MS).toISOString().slice(0, 10)
  const dates = expandOccurrenceDates(firstDate, recurrence, fromKey, toKey)
  for (const exception of exceptions) {
    if (!dates.includes(exception.originalDate)) dates.push(exception.originalDate)
  }
  return dates
}
