import type { Locale } from '@ohana/i18n'
import { useTranslation } from 'react-i18next'
import type { StoredCalendarEvent } from '@/data/local-store.ts'
import {
  formatDayLong,
  formatLocalTime,
  formatZonedTime,
  parseDateOnly,
  zoneDiffersFromDevice,
  zoneLabel,
} from '@/lib/calendar-dates.ts'

/*
 * The time a calendar event shows (issue #20, the acceptance criteria): a
 * timed event shows in the device's local time, with the zone it keeps
 * named beside it when the device is in another zone — the origin of the
 * wall time the creator picked, «18:00 · Москва (UTC+3)». An all-day event
 * never shows a time at all: its date is the whole truth, wherever it is
 * viewed.
 */

export interface EventTimeParts {
  primary: string
  secondary?: string
}

/**
 * The one-line summary the lists show, and the detail's two lines. Takes
 * the translator and locale explicitly, so the derivation stays a pure
 * function the screens call from render.
 */
export function eventTimeParts(
  event: StoredCalendarEvent,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: Locale,
): EventTimeParts {
  if (event.allDay) {
    const date =
      event.date === undefined
        ? ''
        : formatDayLong(parseDateOnly(event.date) ?? { year: 0, month: 1, day: 1 }, locale)
    return { primary: t('calendar.allDayLine', { date }) }
  }
  if (event.startsAt === undefined) {
    return { primary: t('calendar.unspecifiedTime') }
  }
  const at = new Date(event.startsAt)
  const start = formatLocalTime(event.startsAt)
  const end = event.endsAt === undefined ? undefined : formatLocalTime(event.endsAt)
  const local = end === undefined ? start : t('calendar.timeRange', { start, end })
  const zone = event.timezone
  if (zone === undefined) {
    return { primary: local }
  }
  if (!zoneDiffersFromDevice(zone, at)) {
    return { primary: local, secondary: zoneLabel(zone, at) }
  }
  const zoneStart = formatZonedTime(event.startsAt, zone)
  const zoneEnd = event.endsAt === undefined ? undefined : formatZonedTime(event.endsAt, zone)
  const zoneRange =
    zoneEnd === undefined ? zoneStart : t('calendar.timeRange', { start: zoneStart, end: zoneEnd })
  return {
    primary: local,
    secondary: t('calendar.originZoneLine', { time: zoneRange, zone: zoneLabel(zone, at) }),
  }
}

/** The time line a list row shows: the local time first, the origin beside it. */
export function EventTimeLine({
  event,
  className,
}: {
  event: StoredCalendarEvent
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const { primary, secondary } = eventTimeParts(event, t, i18n.language as Locale)
  return (
    <span className={className}>
      {secondary === undefined ? primary : `${primary} · ${secondary}`}
    </span>
  )
}

/**
 * The length of a timed event, «3 ч 30 мин»; undefined when it cannot be
 * one. Takes the translator like `eventTimeParts`.
 */
export function eventDuration(
  event: StoredCalendarEvent,
  t: (key: string, values?: Record<string, unknown>) => string,
): string | undefined {
  if (event.allDay || event.startsAt === undefined || event.endsAt === undefined) return undefined
  const minutes = Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60000)
  if (minutes <= 0) return undefined
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return t('calendar.durationMinutes', { count: rest })
  if (rest === 0) return t('calendar.durationHours', { count: hours })
  return t('calendar.durationHoursMinutes', { hours, minutes: rest })
}
