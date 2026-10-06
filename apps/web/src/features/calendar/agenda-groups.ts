import type { DateOnly } from '@/lib/calendar-dates.ts'
import type { CalendarOccurrence } from './calendar-entries.ts'
import { eventDateKey } from './calendar-entries.ts'

/*
 * The agenda's grouping (docs/design/screens/calendar.html, issue #73):
 * «Сегодня» is always present — the prototype gives it a muted row when
 * the day holds nothing —, «Завтра» joins when it has events, and the
 * rest are month groups with the prototype's trailing rules. A pure pass
 * over the upcoming list, so the screen only renders what this returns;
 * `upcomingEvents` already hands the rows over in day order, and the
 * month buckets keep that order inside themselves.
 */

export type AgendaGroupKind = 'today' | 'tomorrow' | 'month'

export interface AgendaGroup {
  kind: AgendaGroupKind
  /** The group's date: the day itself for today and tomorrow, any day of
   *  the month for a month group — the label reads the day or the month
   *  from it. */
  date: DateOnly
  events: CalendarOccurrence[]
}

/** The day key of a `DateOnly`, matching `eventDateKey`'s form. */
function dayKey({ year, month, day }: DateOnly): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`
}

function parseKey(key: string): DateOnly {
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    day: Number(key.slice(8, 10)),
  }
}

/**
 * The upcoming rows grouped for the agenda: today (always), tomorrow
 * (when it holds events), then the months in the order their days come.
 * An event still running from yesterday has no group of its own — its
 * month bucket keeps it, ahead of the month's future days.
 */
export function agendaGroups(upcoming: CalendarOccurrence[], today: DateOnly): AgendaGroup[] {
  const todayKey = dayKey(today)
  const tomorrow = new Date(today.year, today.month - 1, today.day + 1)
  const tomorrowDate: DateOnly = {
    year: tomorrow.getFullYear(),
    month: tomorrow.getMonth() + 1,
    day: tomorrow.getDate(),
  }
  const tomorrowKey = dayKey(tomorrowDate)

  const todayEvents: CalendarOccurrence[] = []
  const tomorrowEvents: CalendarOccurrence[] = []
  const months = new Map<string, { date: DateOnly; events: CalendarOccurrence[] }>()
  for (const event of upcoming) {
    const key = eventDateKey(event)
    if (key === undefined) continue
    if (key === todayKey) {
      todayEvents.push(event)
      continue
    }
    if (key === tomorrowKey) {
      tomorrowEvents.push(event)
      continue
    }
    // The month bucket keeps the list's day order; the bucket's date is
    // the first day seen, which names the month for the label.
    const monthKey = key.slice(0, 7)
    const bucket = months.get(monthKey)
    if (bucket === undefined) months.set(monthKey, { date: parseKey(key), events: [event] })
    else bucket.events.push(event)
  }

  const groups: AgendaGroup[] = [{ kind: 'today', date: today, events: todayEvents }]
  if (tomorrowEvents.length > 0) {
    groups.push({ kind: 'tomorrow', date: tomorrowDate, events: tomorrowEvents })
  }
  for (const bucket of months.values()) {
    groups.push({ kind: 'month', date: bucket.date, events: bucket.events })
  }
  return groups
}
